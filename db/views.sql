-- =====================================================================
-- Analytical and agent-facing views over the DSR schema.
--
-- Two audiences:
--   v_*        dashboard / management reporting
--   agent_*    the shape the service and client agents should query, so an agent
--              never has to know which of five booking tabs a row came from
--
-- Everything the workbook computes with a pivot table is rebuilt here, so the
-- numbers cannot drift from the rows they are derived from.
-- =====================================================================

SET search_path = dsr, public;

-- Rebuild from scratch every time. CREATE OR REPLACE cannot rename or drop a
-- column, so editing a view's shape would otherwise fail against a live database.
DO $$
DECLARE v record;
BEGIN
    FOR v IN
        SELECT table_name FROM information_schema.views WHERE table_schema = 'dsr'
    LOOP
        EXECUTE format('DROP VIEW IF EXISTS dsr.%I CASCADE', v.table_name);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------

-- One row per physical car, fully labelled. The base for everything stock related.
CREATE OR REPLACE VIEW v_stock AS
SELECT v.vehicle_id,
       v.chassis_number,
       v.commission_no,
       m.name              AS model,
       m.family            AS model_family,
       dv.name             AS variant,
       dv.transmission,
       c.name              AS colour,
       v.long_model_text,
       v.model_year,
       v.obd,
       v.stock_status,
       v.billing_date,
       v.stock_received_date,
       v.stock_aging_days,
       v.nadcon_retail_date,
       CASE
           WHEN v.stock_aging_days IS NULL     THEN 'unknown'
           WHEN v.stock_aging_days <= 30       THEN '0-30'
           WHEN v.stock_aging_days <= 60       THEN '31-60'
           WHEN v.stock_aging_days <= 90       THEN '61-90'
           WHEN v.stock_aging_days <= 180      THEN '91-180'
           ELSE '180+'
       END                 AS ageing_bucket
FROM vehicle v
LEFT JOIN dim_model   m  ON m.model_id   = v.model_id
LEFT JOIN dim_variant dv ON dv.variant_id = v.variant_id
LEFT JOIN dim_colour  c  ON c.colour_id  = v.colour_id;

-- What can actually be sold today, and how long it has been sitting.
-- This is the view the client agent should answer availability questions from.
CREATE OR REPLACE VIEW v_stock_availability AS
SELECT model,
       model_family,
       variant,
       transmission,
       colour,
       count(*)                                              AS free_units,
       min(stock_aging_days)                                 AS freshest_days,
       max(stock_aging_days)                                 AS oldest_days,
       min(nadcon_retail_date)                               AS earliest_retail_deadline
FROM v_stock
WHERE stock_status = 'FREESTOCK'
GROUP BY model, model_family, variant, transmission, colour;

-- Rebuild of the Free Stock tab, in long form so it can be pivoted any way round.
CREATE OR REPLACE VIEW v_free_stock_by_colour AS
SELECT model,
       variant,
       colour,
       count(*) FILTER (WHERE stock_status = 'FREESTOCK') AS free_units,
       count(*) FILTER (WHERE stock_status = 'ALLOTED')   AS allotted_units,
       count(*)                                           AS total_units
FROM v_stock
WHERE stock_status IN ('FREESTOCK', 'ALLOTED')
GROUP BY model, variant, colour;

-- Ageing profile. Stock over 90 days is the number the manager is asked about,
-- because it drives the interest cost the dealership carries.
CREATE OR REPLACE VIEW v_stock_ageing AS
SELECT model,
       ageing_bucket,
       count(*)                          AS units,
       round(avg(stock_aging_days), 1)   AS avg_days,
       max(stock_aging_days)             AS max_days
FROM v_stock
WHERE stock_status IN ('FREESTOCK', 'ALLOTED')
GROUP BY model, ageing_bucket;

-- Rebuild of the VW Report tab: stock and order book side by side per model.
--
-- Rolled up to model FAMILY, not model name, on purpose. The stock tabs
-- distinguish the Taigun facelift ("Taigun (FL)") but the booking tabs write
-- plain "TAIGUN" for both, so a name-level view puts 35 free Taiguns against 0
-- Taigun bookings and 21 bookings against 3 cars. Family makes supply and demand
-- comparable; v_stock still carries the exact model for ordering.
CREATE OR REPLACE VIEW v_model_position AS
WITH families AS (
    SELECT DISTINCT family FROM dim_model
),
stock AS (
    SELECT m.family,
           count(*) FILTER (WHERE v.stock_status = 'FREESTOCK')                    AS free_stock,
           count(*) FILTER (WHERE v.stock_status = 'ALLOTED')                      AS allotted_stock,
           count(*) FILTER (WHERE v.stock_status IN ('FREESTOCK','ALLOTED'))       AS total_stock,
           count(*) FILTER (WHERE v.stock_status = 'FREESTOCK'
                              AND v.stock_aging_days > 90)                         AS free_over_90_days
    FROM vehicle v JOIN dim_model m ON m.model_id = v.model_id
    GROUP BY m.family
),
orders AS (
    SELECT m.family,
           count(*)                                                        AS bookings,
           count(*) FILTER (WHERE b.fulfilment_status = 'NO_STOCK')        AS backorders
    FROM booking b JOIN dim_model m ON m.model_id = b.model_id
    WHERE b.is_current_period
    GROUP BY m.family
),
retails AS (
    SELECT m.family, count(*) AS registered
    FROM registration r
    JOIN vehicle v   ON v.vehicle_id = r.vehicle_id
    JOIN dim_model m ON m.model_id   = v.model_id
    WHERE r.status = 'REGISTERED'
    GROUP BY m.family
)
SELECT f.family                                AS model,
       COALESCE(s.free_stock, 0)               AS free_stock,
       COALESCE(s.allotted_stock, 0)           AS allotted_stock,
       COALESCE(s.total_stock, 0)              AS total_stock,
       COALESCE(s.free_over_90_days, 0)        AS free_over_90_days,
       COALESCE(o.bookings, 0)                 AS bookings_this_period,
       COALESCE(o.backorders, 0)               AS backorders_this_period,
       COALESCE(r.registered, 0)               AS registered
FROM families f
LEFT JOIN stock   s ON s.family = f.family
LEFT JOIN orders  o ON o.family = f.family
LEFT JOIN retails r ON r.family = f.family
-- Families the dealership holds a car or an order against. Golf and Tiguan R-Line
-- are in the workbook's model list but had neither in August; carrying them
-- through would put empty rows on every chart.
WHERE COALESCE(s.total_stock, 0) > 0 OR COALESCE(o.bookings, 0) > 0;

-- ---------------------------------------------------------------------
-- Demand and the order book
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW v_bookings AS
SELECT b.booking_id,
       b.booking_date,
       b.source_sheet,
       b.is_current_period,
       s.name              AS source,
       s.channel           AS source_channel,
       co.display_name     AS consultant,
       t.name              AS team,
       b.customer_name,
       b.mobile,
       m.name              AS model,
       m.family            AS model_family,
       dv.name             AS variant,
       c.name              AS colour,
       b.fulfilment_status,
       b.car_origin,
       b.crm_entry_done,
       b.booking_amount,
       b.ageing_days,
       v.chassis_number    AS allotted_chassis
FROM booking b
LEFT JOIN dim_lead_source s  ON s.source_id     = b.source_id
LEFT JOIN dim_consultant  co ON co.consultant_id = b.consultant_id
LEFT JOIN dim_team        t  ON t.team_id       = b.team_id
LEFT JOIN dim_model       m  ON m.model_id      = b.model_id
LEFT JOIN dim_variant     dv ON dv.variant_id   = b.variant_id
LEFT JOIN dim_colour      c  ON c.colour_id     = b.colour_id
LEFT JOIN vehicle         v  ON v.vehicle_id    = b.vehicle_id;

-- One row per real customer order.
--
-- v_bookings keeps every tab's version of a row, which is right for audit and
-- wrong for anything operational: an order written on both Live Booking and
-- Pending Booking would be chased twice and counted twice. Dedupe on customer +
-- model FAMILY + variant, because the tabs disagree on whether a facelift Taigun
-- is "TAIGUN" or "TAIGUN (FL)" and that is the same car to the customer.
CREATE OR REPLACE VIEW v_order_book AS
SELECT DISTINCT ON (upper(b.customer_name), b.model_family, b.variant) b.*
FROM v_bookings b
ORDER BY upper(b.customer_name), b.model_family, b.variant,
         -- August book first, then the consolidated order book, then the
         -- working lists the floor keeps.
         array_position(ARRAY['Current Month Booking',
                              'Booking & Alloted',
                              'Live Booking',
                              'Pending Booking',
                              'Golf & Tiguan R Line Booking'], b.source_sheet);

-- Orders taken with nothing to allot against them. Ordered by how long the
-- customer has been waiting, which is the queue the supply chase works down.
CREATE OR REPLACE VIEW v_backorders AS
SELECT b.booking_id,
       b.booking_date,
       (CURRENT_DATE - b.booking_date) AS days_waiting,
       b.customer_name,
       b.mobile,
       b.consultant,
       b.model,
       b.model_family,
       b.variant,
       b.colour,
       b.source,
       b.source_sheet,
       b.is_current_period,
       -- Can this order be filled from what is on the ground right now? Matched
       -- on family so free facelift stock counts against a plain Taigun order.
       (SELECT count(*) FROM v_stock st
         WHERE st.stock_status = 'FREESTOCK'
           AND st.model_family = b.model_family
           AND st.variant      = b.variant
           AND (st.colour = b.colour OR b.colour IS NULL)) AS matching_free_units
FROM v_order_book b
WHERE b.fulfilment_status = 'NO_STOCK';

-- Enquiry volume by channel for the current period.
-- Grouped by channel, not by the individual source row.
--
-- The source column in the CRM export sometimes holds a salesperson's name
-- instead of a channel, so the chart listed CRM, WALKIN, TELE and DIGITAL
-- beside ADITYA KUMAR and DIVYA SHREE - categories and people in one ranking,
-- which is not a thing you can read. Those rows are classified REFERRAL now
-- (a lead credited to a named individual is a referral from them) and this
-- groups on the channel, so the chart is six categories rather than twelve
-- entries of two different kinds.
--
-- The individual names are not lost - they are still in dim_lead_source.name
-- against every lead, for anyone who needs to know which consultant brought
-- what. They are simply not a category.
--
-- is_paid_media is aggregated with bool_or: a channel counts as paid if any
-- source within it is, which today is only DIGITAL.
CREATE OR REPLACE VIEW v_leads_sourcewise AS
SELECT s.channel::text                                               AS source,
       s.channel,
       bool_or(s.is_paid_media)                                      AS is_paid_media,
       count(*)                                                      AS leads,
       count(*) FILTER (WHERE l.qualified_stage = 'Qualified')        AS qualified,
       round(100.0 * count(*) FILTER (WHERE l.qualified_stage = 'Qualified')
             / NULLIF(count(*), 0), 1)                               AS qualified_pct
FROM lead l
JOIN dim_lead_source s USING (source_id)
WHERE l.is_current_period
GROUP BY s.channel;

-- Model demand vs supply: what people ask for against what is in stock.
-- Family level, for the same reason as v_model_position.
CREATE OR REPLACE VIEW v_model_demand AS
SELECT p.model,
       COALESCE(e.enquiries, 0) AS enquiries,
       p.bookings_this_period   AS bookings,
       p.free_stock,
       round(100.0 * p.bookings_this_period
             / NULLIF(e.enquiries, 0), 1) AS enquiry_to_booking_pct
FROM v_model_position p
LEFT JOIN (
    SELECT m.family, count(*) AS enquiries
    FROM lead l JOIN dim_model m ON m.model_id = l.model_id
    WHERE l.is_current_period
    GROUP BY m.family
) e ON e.family = p.model;

-- ---------------------------------------------------------------------
-- Consultant performance
-- ---------------------------------------------------------------------

-- Targets live on a consultant's primary-channel row; achievement is split across
-- that row and their "& Others" row. So targets are taken from the primary row and
-- achievement is summed across both. Percentages are recomputed here rather than
-- read from the sheet, where they surface as #DIV/0!.
--
-- Achievement is COUNTED FROM THE FACT TABLES, not read from the workbook, so a
-- booking entered through the dashboard moves the leaderboard immediately. This
-- is safe because the two agree exactly on load: every consultant's workbook
-- booking_achieved and retail_achieved matches their row count in booking and
-- registration, to the unit.
--
-- Enquiries and test drives are the exception and are baseline + live:
--   * the August lead export carries no consultant, so 367 of 367 leads are
--     unattributed and only the scorecard knows the per-person split;
--   * the test-drive tab was never refreshed (see v_data_quality).
-- So for those two, the workbook figure is the baseline and only MANUAL rows -
-- the ones entered since - are added on top. Nothing is double counted.
CREATE OR REPLACE VIEW v_consultant_scorecard AS
WITH rolled AS (
    SELECT sc.period_id,
           sc.consultant_id,
           sc.row_label,
           sc.row_kind,
           max(sc.leads_target)   FILTER (WHERE sc.is_primary_channel) AS leads_target,
           sum(sc.total_leads)                                          AS total_leads,
           sum(sc.leads_qualified)                                      AS leads_qualified,
           max(sc.td_target)      FILTER (WHERE sc.is_primary_channel) AS td_target,
           sum(sc.td_achieved)                                          AS td_achieved,
           max(sc.booking_target) FILTER (WHERE sc.is_primary_channel) AS booking_target,
           sum(sc.booking_achieved)                                     AS booking_achieved,
           max(sc.retail_target)  FILTER (WHERE sc.is_primary_channel) AS retail_target,
           sum(sc.retail_achieved)                                      AS retail_achieved,
           max(sc.finance_target)   FILTER (WHERE sc.is_primary_channel) AS finance_target,
           max(sc.finance_achieved) FILTER (WHERE sc.is_primary_channel) AS finance_achieved,
           max(sc.insurance_target)   FILTER (WHERE sc.is_primary_channel) AS insurance_target,
           max(sc.insurance_achieved) FILTER (WHERE sc.is_primary_channel) AS insurance_achieved,
           max(sc.cancelled) FILTER (WHERE sc.is_primary_channel)       AS cancelled,
           max(sc.allotted)  FILTER (WHERE sc.is_primary_channel)       AS allotted,
           max(sc.coverage)  FILTER (WHERE sc.is_primary_channel)       AS coverage
    FROM target_consultant_scorecard sc
    GROUP BY sc.period_id, sc.consultant_id, sc.row_label, sc.row_kind
),
-- Live achievement per consultant, straight off the facts.
per_consultant AS (
    SELECT c.consultant_id,
           (SELECT count(*) FROM booking b
             WHERE b.consultant_id = c.consultant_id AND b.is_current_period)   AS bookings,
           (SELECT count(*) FROM registration rg
             WHERE rg.consultant_id = c.consultant_id
               AND rg.status = 'REGISTERED')                                     AS retails,
           (SELECT count(*) FROM lead l
             WHERE l.consultant_id = c.consultant_id
               AND l.is_current_period AND l.origin = 'MANUAL')                  AS leads_added,
           (SELECT count(*) FROM lead l
             WHERE l.consultant_id = c.consultant_id
               AND l.is_current_period AND l.origin = 'MANUAL'
               AND l.qualified_stage = 'Qualified')                              AS qualified_added,
           (SELECT count(*) FROM test_drive td
             WHERE td.consultant_id = c.consultant_id AND td.origin = 'MANUAL')  AS tds_added
    FROM dim_consultant c
),
-- The same, aggregated for the roll-up rows. A TEAM_TOTAL row names its manager
-- in the label ("Field Team (Tele & Digital) - Nethra"), which is the only link
-- the workbook gives between a roll-up row and its members.
per_rollup AS (
    SELECT r.row_label,
           sum(pc.bookings)        AS bookings,
           sum(pc.retails)         AS retails,
           sum(pc.leads_added)     AS leads_added,
           sum(pc.qualified_added) AS qualified_added,
           sum(pc.tds_added)       AS tds_added
    FROM rolled r
    JOIN dim_consultant c
      ON r.row_kind = 'GRAND_TOTAL'
      OR (r.row_kind = 'TEAM_TOTAL'
          AND upper(r.row_label) LIKE '%' || upper(COALESCE(
                (SELECT name FROM dim_team dt WHERE dt.team_id = c.team_id), '~none~')) || '%')
    JOIN per_consultant pc ON pc.consultant_id = c.consultant_id
    WHERE r.row_kind IN ('TEAM_TOTAL', 'GRAND_TOTAL')
    GROUP BY r.row_label
),
live AS (
    SELECT r.*,
           COALESCE(pc.bookings,        ru.bookings)        AS live_bookings,
           COALESCE(pc.retails,         ru.retails)         AS live_retails,
           COALESCE(pc.leads_added,     ru.leads_added,     0) AS leads_added,
           COALESCE(pc.qualified_added, ru.qualified_added, 0) AS qualified_added,
           COALESCE(pc.tds_added,       ru.tds_added,       0) AS tds_added
    FROM rolled r
    LEFT JOIN per_consultant pc ON pc.consultant_id = r.consultant_id
    LEFT JOIN per_rollup     ru ON ru.row_label     = r.row_label
                               AND r.row_kind IN ('TEAM_TOTAL', 'GRAND_TOTAL')
)
SELECT p.label                                   AS period,
       r.row_kind,
       COALESCE(co.display_name, r.row_label)    AS consultant,
       t.name                                    AS team,
       co.primary_channel,
       r.leads_target,
       COALESCE(r.total_leads, 0)     + r.leads_added     AS total_leads,
       COALESCE(r.leads_qualified, 0) + r.qualified_added AS leads_qualified,
       r.td_target,
       COALESCE(r.td_achieved, 0)     + r.tds_added       AS td_achieved,
       r.booking_target,
       COALESCE(r.live_bookings, r.booking_achieved)      AS booking_achieved,
       r.retail_target,
       COALESCE(r.live_retails,  r.retail_achieved)       AS retail_achieved,
       r.finance_target, r.finance_achieved,
       r.insurance_target, r.insurance_achieved,
       r.cancelled, r.allotted, r.coverage,
       round(100.0 * (COALESCE(r.total_leads, 0) + r.leads_added)
             / NULLIF(r.leads_target, 0), 1)              AS leads_vs_target_pct,
       round(100.0 * (COALESCE(r.td_achieved, 0) + r.tds_added)
             / NULLIF(COALESCE(r.total_leads, 0) + r.leads_added, 0), 1) AS td_conv_pct,
       round(100.0 * COALESCE(r.live_bookings, r.booking_achieved)
             / NULLIF(COALESCE(r.total_leads, 0) + r.leads_added, 0), 1) AS booking_conv_pct,
       round(100.0 * COALESCE(r.live_bookings, r.booking_achieved)
             / NULLIF(r.booking_target, 0), 1)            AS booking_vs_target_pct,
       round(100.0 * COALESCE(r.live_retails, r.retail_achieved)
             / NULLIF(r.retail_target, 0), 1)             AS retail_vs_target_pct
FROM live r
JOIN dim_period p ON p.period_id = r.period_id AND p.is_active
LEFT JOIN dim_consultant co ON co.consultant_id = r.consultant_id
LEFT JOIN dim_team t        ON t.team_id = co.team_id;

-- Ranked view of the people actually on the floor, worst gap first, which is how
-- the morning review is run.
CREATE OR REPLACE VIEW v_consultant_leaderboard AS
SELECT consultant, team, primary_channel,
       total_leads, td_achieved,
       booking_target, booking_achieved,
       COALESCE(booking_achieved, 0) - COALESCE(booking_target, 0) AS booking_gap,
       booking_vs_target_pct,
       retail_target, retail_achieved,
       retail_vs_target_pct,
       booking_conv_pct
FROM v_consultant_scorecard
WHERE row_kind = 'CONSULTANT'
  -- The tab carries placeholder rows for channels that are not people (a
  -- co-dealer contact, the workshop desk) with every column blank. Anyone with
  -- neither a target nor a single enquiry against them is one of those.
  AND (COALESCE(booking_target, 0) > 0
    OR COALESCE(booking_achieved, 0) > 0
    OR COALESCE(total_leads, 0) > 0)
ORDER BY booking_gap ASC, booking_achieved DESC;

-- Week-by-week commitment tracking, as management reviews it.
CREATE OR REPLACE VIEW v_booking_commitments AS
SELECT p.label AS period,
       bc.consultant_label,
       bc.window_label,
       bc.committed,
       bc.achieved,
       COALESCE(bc.achieved, 0) - COALESCE(bc.committed, 0) AS variance
FROM target_booking_commitment bc
JOIN dim_period p ON p.period_id = bc.period_id
WHERE p.is_active;

-- ---------------------------------------------------------------------
-- Funnel and headline numbers
-- ---------------------------------------------------------------------

-- Enquiry -> qualified -> test drive -> booking -> retail.
--
-- Enquiries, bookings and retails are counted from the fact tables, so entering
-- one moves the funnel at once.
--
-- Test drives cannot be: the TD tab in this workbook was never refreshed and
-- still holds a November 2024 export (see v_data_quality), so the scorecard's
-- TD ACH column is the only current figure. It is used as the baseline, plus any
-- test drive entered since - MANUAL rows only, so the stale tab is not counted.
CREATE OR REPLACE VIEW v_sales_funnel AS
SELECT p.label AS period,
       (SELECT count(*) FROM lead
         WHERE is_current_period)                                       AS enquiries,
       (SELECT count(*) FROM lead
         WHERE is_current_period AND qualified_stage = 'Qualified')      AS qualified,
       (SELECT COALESCE(sum(td_achieved), 0) FROM target_consultant_scorecard
         WHERE row_kind = 'GRAND_TOTAL')
       + (SELECT count(*) FROM test_drive
           WHERE origin = 'MANUAL'
             AND (td_date IS NULL
                  OR td_date BETWEEN p.period_start AND p.period_end))   AS test_drives,
       (SELECT count(*) FROM booking
         WHERE is_current_period)                                        AS bookings,
       (SELECT count(*) FROM registration
         WHERE status = 'REGISTERED')                                    AS retails
FROM dim_period p
-- Exactly one row: the month the dashboard is reporting on.
WHERE p.is_active;

CREATE OR REPLACE VIEW v_daily_kpi AS
SELECT f.period,
       f.enquiries,
       f.qualified,
       f.test_drives,
       f.bookings,
       f.retails,
       round(100.0 * f.bookings / NULLIF(f.enquiries, 0), 1)          AS enquiry_to_booking_pct,
       round(100.0 * f.retails  / NULLIF(f.bookings, 0), 1)           AS booking_to_retail_pct,
       (SELECT count(*) FROM vehicle WHERE stock_status = 'FREESTOCK') AS free_stock,
       (SELECT count(*) FROM vehicle WHERE stock_status = 'ALLOTED')   AS allotted_stock,
       (SELECT count(*) FROM vehicle
         WHERE stock_status IN ('FREESTOCK','ALLOTED')
           AND stock_aging_days > 90)                                  AS stock_over_90_days,
       (SELECT count(*) FROM booking
         WHERE is_current_period AND fulfilment_status = 'NO_STOCK')   AS backorders,
       (SELECT count(*) FROM booking
         WHERE is_current_period AND crm_entry_done IS FALSE)          AS bookings_missing_crm_entry,
       (SELECT sum(booking_amount) FROM booking WHERE is_current_period) AS booking_amount_collected,
       (SELECT round(avg(tat_days), 1) FROM allotment)                 AS avg_allotment_tat_days
FROM v_sales_funnel f;

-- Attachment mix on retailed cars: finance, insurance, extended warranty, SVP.
-- These carry most of the dealership's margin, so they are scored separately.
CREATE OR REPLACE VIEW v_attachment_rates AS
SELECT count(*)                                                        AS registrations,
       count(*) FILTER (WHERE finance_type IS NOT NULL
                          AND finance_type <> 'FULL CASH')             AS financed,
       count(*) FILTER (WHERE has_insurance)                            AS insured,
       count(*) FILTER (WHERE has_extended_warranty)                    AS extended_warranty,
       count(*) FILTER (WHERE has_service_value_package)                AS service_value_package,
       count(*) FILTER (WHERE is_corporate)                             AS corporate,
       round(100.0 * count(*) FILTER (WHERE finance_type IS NOT NULL
                          AND finance_type <> 'FULL CASH')
             / NULLIF(count(*), 0), 1)                                  AS finance_pct,
       round(100.0 * count(*) FILTER (WHERE has_insurance)
             / NULLIF(count(*), 0), 1)                                  AS insurance_pct
FROM registration
WHERE status = 'REGISTERED';

-- How long a completed deal takes to clear the back office.
CREATE OR REPLACE VIEW v_folder_tat AS
SELECT r.registration_id,
       r.customer_name,
       co.display_name                                    AS consultant,
       r.registration_no,
       r.folder_lined_up_on,
       r.folder_given_to_accounts_on,
       r.registration_date,
       r.delivery_date,
       (r.folder_given_to_accounts_on - r.folder_lined_up_on) AS days_to_accounts,
       (r.registration_date - r.booking_date)                 AS booking_to_registration_days
FROM registration r
LEFT JOIN dim_consultant co ON co.consultant_id = r.consultant_id
WHERE r.status = 'REGISTERED';

-- ---------------------------------------------------------------------
-- Agent-facing views
--
-- The agents should read these and nothing else. They hide the five-overlapping-
-- booking-tabs problem and the two lead populations behind stable column names.
-- ---------------------------------------------------------------------

-- CLIENT AGENT: "do you have a Candy White Virtus GT Line AT?"
CREATE OR REPLACE VIEW agent_vehicle_availability AS
SELECT model,
       model_family,
       variant,
       transmission,
       colour,
       free_units,
       CASE WHEN free_units > 0 THEN 'available' ELSE 'unavailable' END AS availability,
       freshest_days AS newest_stock_age_days
FROM v_stock_availability
WHERE free_units > 0;

-- CLIENT AGENT: "where is my car?" - one row per customer order, with whatever
-- fulfilment progress exists. Matched on name because the booking tabs record a
-- mobile number only sporadically.
--
-- Deduplicated on purpose. The same order is written on up to three of the
-- booking tabs, and joining allotments and registrations by customer name can
-- multiply rows again. A customer asking after their car must get one row per
-- car, so each join is collapsed to its best single match first.
CREATE OR REPLACE VIEW agent_order_status AS
WITH one_allotment AS (
    SELECT DISTINCT ON (booking_id) booking_id, allotted_date, tat_days
    FROM allotment WHERE booking_id IS NOT NULL
    ORDER BY booking_id, allotted_date DESC NULLS LAST
),
one_registration AS (
    SELECT DISTINCT ON (upper(customer_name))
           customer_name, status, invoice_date, registration_date,
           registration_no, delivery_date
    FROM registration
    ORDER BY upper(customer_name), registration_date DESC NULLS LAST, registration_id
)
SELECT b.booking_id,
       b.customer_name,
       b.mobile,
       b.booking_date,
       b.model,
       b.variant,
       b.colour,
       b.consultant,
       b.fulfilment_status,
       b.allotted_chassis,
       a.allotted_date,
       r.invoice_date,
       r.registration_date,
       r.registration_no,
       r.delivery_date,
       CASE
           WHEN r.delivery_date     IS NOT NULL THEN 'delivered'
           -- The August workbook leaves registration_date blank on every row,
           -- so the Reg Report status is what actually carries this stage.
           WHEN r.registration_date IS NOT NULL
             OR r.status = 'REGISTERED'          THEN 'registered'
           WHEN r.invoice_date      IS NOT NULL THEN 'invoiced'
           WHEN b.fulfilment_status = 'RETAILED' THEN 'retailed'
           WHEN a.allotted_date     IS NOT NULL THEN 'car allotted'
           WHEN b.fulfilment_status = 'ALLOTED'  THEN 'car allotted'
           WHEN b.fulfilment_status = 'NO_STOCK' THEN 'awaiting stock'
           WHEN b.fulfilment_status = 'CANCELLED' THEN 'cancelled'
           ELSE 'booked'
       END AS stage
FROM v_order_book b
LEFT JOIN one_allotment    a ON a.booking_id = b.booking_id
LEFT JOIN one_registration r ON upper(r.customer_name) = upper(b.customer_name);

-- SERVICE / INTERNAL AGENT: everything needed to answer "how are we doing?"
CREATE OR REPLACE VIEW agent_dealership_snapshot AS
SELECT k.period,
       k.enquiries, k.qualified, k.test_drives, k.bookings, k.retails,
       k.enquiry_to_booking_pct, k.booking_to_retail_pct,
       k.free_stock, k.allotted_stock, k.stock_over_90_days, k.backorders,
       k.bookings_missing_crm_entry, k.booking_amount_collected,
       (SELECT booking_target   FROM v_consultant_scorecard WHERE row_kind = 'GRAND_TOTAL') AS booking_target,
       (SELECT retail_target    FROM v_consultant_scorecard WHERE row_kind = 'GRAND_TOTAL') AS retail_target,
       (SELECT leads_target     FROM v_consultant_scorecard WHERE row_kind = 'GRAND_TOTAL') AS enquiry_target
FROM v_daily_kpi k;

-- ---------------------------------------------------------------------
-- Data quality
--
-- The workbook is maintained by hand and its tabs are refreshed at different
-- times, so they disagree with each other. Rather than quietly picking a winner,
-- every disagreement found during the load is surfaced here.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW v_data_quality AS
WITH checks AS (
    SELECT 'Test drive tab is stale'::text AS issue,
           'The TD tab holds a November 2024 export, not August 2026 activity. '
           || 'Funnel views take test drives from the scorecard instead.'::text AS detail,
           (SELECT count(*)::text FROM test_drive
             WHERE td_date < (SELECT period_start FROM dim_period
                               WHERE is_active LIMIT 1)) AS affected_rows,
           'high'::text AS severity
    UNION ALL
    SELECT 'Comparision tab disagrees with the base tabs',
           'Comparision reports 350 enquiries / 37 bookings / 20 retails; the '
           || 'underlying tabs hold '
           || (SELECT count(*) FROM lead WHERE is_current_period)::text || ' / '
           || (SELECT count(*) FROM booking WHERE is_current_period)::text || ' / '
           || (SELECT count(*) FROM registration WHERE status = 'REGISTERED')::text || '.',
           '3', 'medium'
    UNION ALL
    SELECT 'Daily Tracker holds two conflicting target blocks',
           'The upper block sets a different enquiry target for the same consultant '
           || 'than the lower block. Views read BLOCK_2 (full roster).',
           (SELECT count(DISTINCT consultant_label)::text FROM target_daily_tracker
             WHERE consultant_label IN (
                 SELECT consultant_label FROM target_daily_tracker
                 GROUP BY consultant_label HAVING count(DISTINCT block_label) > 1)),
           'medium'
    UNION ALL
    SELECT 'August lead export is missing consultant and status columns',
           'The Leads tab exported only date, name, source and model of interest, so '
           || 'per-consultant enquiry counts must come from the scorecard.',
           (SELECT count(*)::text FROM lead
             WHERE is_current_period AND consultant_id IS NULL),
           'medium'
    UNION ALL
    SELECT 'Bookings not entered in the CRM',
           'Bookings on the August tab with ZOHO ENTRY = NO. These will not appear in '
           || 'VW-side reporting until they are punched.',
           (SELECT count(*)::text FROM booking
             WHERE is_current_period AND crm_entry_done IS FALSE),
           'high'
    UNION ALL
    SELECT 'Allotments with no chassis on the source tab',
           'The Alloted tab has no chassis column; rows were matched to stock on '
           || 'model text and ageing. Unmatched rows have no vehicle link.',
           (SELECT count(*)::text FROM allotment WHERE vehicle_id IS NULL),
           'low'
    UNION ALL
    SELECT 'Registration report stops at accounts',
           'On the Reg Report tab the columns from FOLDER SENT TO HO rightwards - '
           || 'invoice date, registration date, registration number, VOIW id and '
           || 'delivery date - are blank on every row, so the fulfilment stage has '
           || 'to be read from the status column instead.',
           (SELECT count(*)::text FROM registration
             WHERE registration_date IS NULL AND invoice_date IS NULL),
           'medium'
    UNION ALL
    SELECT 'Stock past its NADCON retail deadline',
           'Units whose VW retail deadline has already passed while still unsold.',
           (SELECT count(*)::text FROM vehicle
             WHERE stock_status = 'FREESTOCK'
               AND nadcon_retail_date < CURRENT_DATE),
           'high'
)
SELECT * FROM checks WHERE affected_rows IS NOT NULL AND affected_rows <> '0';
