-- =====================================================================
-- Change notification.
--
-- Every write to a fact or target table announces itself on the `dsr_change`
-- channel. The API holds one connection LISTENing on that channel and fans the
-- events out to every open dashboard over server-sent events.
--
-- The point of doing it in the database rather than in the API is that the
-- database sees ALL writes. A row inserted by the dashboard, by the bulk loader,
-- by tools/sql.py, or by some future agent writing directly all reach the same
-- trigger, so no dashboard can drift out of date because a write took a
-- different path in.
--
-- Re-runnable: every trigger is dropped and recreated.
-- =====================================================================

SET search_path = dsr, public;

CREATE OR REPLACE FUNCTION notify_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    payload json;
    row_id  text;
BEGIN
    -- TRUNCATE is statement-level: there is no NEW/OLD row to report.
    IF TG_OP = 'TRUNCATE' THEN
        payload := json_build_object('table', TG_TABLE_NAME, 'op', TG_OP);
    ELSE
        -- to_jsonb(...)->>0 pulls the primary key out without the function
        -- needing to know each table's key column name.
        BEGIN
            row_id := CASE WHEN TG_OP = 'DELETE'
                           THEN to_jsonb(OLD) ->> (TG_ARGV[0])
                           ELSE to_jsonb(NEW) ->> (TG_ARGV[0]) END;
        EXCEPTION WHEN others THEN
            row_id := NULL;
        END;
        payload := json_build_object('table', TG_TABLE_NAME,
                                     'op', TG_OP,
                                     'id', row_id);
    END IF;

    -- pg_notify payloads are capped at 8000 bytes; this one is a few dozen.
    -- Notifications are delivered on COMMIT, so a listener never sees a change
    -- that later rolled back.
    PERFORM pg_notify('dsr_change', payload::text);
    RETURN NULL;                      -- AFTER trigger: return value is ignored
END $$;

COMMENT ON FUNCTION notify_change() IS
  'Announces a row change on the dsr_change channel. Takes the table''s primary
   key column name as its single trigger argument.';

-- Watched tables and their primary key column.
DO $$
DECLARE
    spec record;
BEGIN
    FOR spec IN
        SELECT * FROM (VALUES
            ('vehicle',                     'vehicle_id'),
            ('lead',                        'lead_id'),
            ('test_drive',                  'test_drive_id'),
            ('booking',                     'booking_id'),
            ('allotment',                   'allotment_id'),
            ('registration',                'registration_id'),
            ('target_consultant_scorecard', 'scorecard_id'),
            ('target_channel_funnel',       'id'),
            ('target_booking_commitment',   'id'),
            ('target_daily_tracker',        'id')
        ) AS t(tbl, pk)
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON dsr.%I',
                       spec.tbl || '_notify', spec.tbl);
        EXECUTE format(
            'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON dsr.%I '
            'FOR EACH ROW EXECUTE FUNCTION dsr.notify_change(%L)',
            spec.tbl || '_notify', spec.tbl, spec.pk);

        -- One extra statement-level trigger so a workbook reload, which
        -- truncates, also tells the dashboards to refetch.
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON dsr.%I',
                       spec.tbl || '_notify_truncate', spec.tbl);
        EXECUTE format(
            'CREATE TRIGGER %I AFTER TRUNCATE ON dsr.%I '
            'FOR EACH STATEMENT EXECUTE FUNCTION dsr.notify_change(%L)',
            spec.tbl || '_notify_truncate', spec.tbl, spec.pk);
    END LOOP;
END $$;


-- ---------------------------------------------------------------------
-- Make an enquiry written straight into Supabase show up on the dashboard.
--
-- The chat agent is connected to Supabase directly, so it writes through
-- PostgREST, which only exposes `public`. `public.lead` is an auto-updatable
-- view over `dsr.lead`, so the agent's INSERT already succeeds today - and the
-- row is invisible. A naive insert supplies a name and a phone and nothing
-- else, so the row lands with period_id NULL, created_at NULL and
-- is_current_period false, and every headline view is scoped
-- `WHERE is_current_period`. The agent is told "success" and the dashboard
-- never moves.
--
-- The fix belongs on the view, not the table. The ETL sets search_path to
-- `dsr, public`, so the loader's INSERTs resolve to dsr.lead and never pass
-- through here - which matters, because the loader deliberately inserts the
-- 2024 historical dump with period_id NULL. Filling that in on the base table
-- would file 1,787 archive rows into 2024 reporting months that should not
-- exist. On the view, only writes arriving from outside are touched.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dsr.lead_insert_from_api() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    d    date;
    pid  smallint;
    act  boolean;
BEGIN
    -- An enquiry with no date is one that just came in.
    NEW.created_at := coalesce(NEW.created_at, now());
    d := NEW.created_at::date;

    IF NEW.period_id IS NULL THEN
        SELECT period_id, is_active INTO pid, act
          FROM dsr.dim_period
         WHERE d BETWEEN period_start AND period_end
         LIMIT 1;

        -- First enquiry of a month the dealership has not opened yet: create
        -- the month rather than dropping the lead. Same rule as period_for().
        IF pid IS NULL THEN
            INSERT INTO dsr.dim_period (label, period_start, period_end)
            VALUES (upper(to_char(d, 'MON')) || to_char(d, 'YYYY'),
                    date_trunc('month', d)::date,
                    (date_trunc('month', d) + interval '1 month'
                                            - interval '1 day')::date)
            ON CONFLICT (label) DO UPDATE SET label = EXCLUDED.label
            RETURNING period_id, is_active INTO pid, act;
        END IF;

        NEW.period_id := pid;
    END IF;

    -- Visible exactly when the lead belongs to the month being reported on.
    IF NEW.is_current_period IS NULL THEN
        SELECT is_active INTO act FROM dsr.dim_period
         WHERE period_id = NEW.period_id;
        NEW.is_current_period := coalesce(act, false);
    END IF;

    INSERT INTO dsr.lead (
        lead_id, lead_record_id, created_at, lead_name, mobile, email,
        source_id, lead_type, model_of_interest, variant_of_interest,
        colour_of_interest, model_id, lead_owner, consultant_id, lead_status,
        rating, qualified_stage, test_drive_given, trade_in, trade_in_vehicle,
        dealership, period_id, origin, loaded_at, updated_at, entered_by,
        is_current_period)
    VALUES (
        coalesce(NEW.lead_id, nextval('dsr.lead_lead_id_seq')),
        NEW.lead_record_id, NEW.created_at, NEW.lead_name, NEW.mobile,
        NEW.email, NEW.source_id, NEW.lead_type, NEW.model_of_interest,
        NEW.variant_of_interest, NEW.colour_of_interest, NEW.model_id,
        NEW.lead_owner, NEW.consultant_id,
        coalesce(NEW.lead_status, 'New'),
        NEW.rating,
        coalesce(NEW.qualified_stage, 'New'),
        NEW.test_drive_given, NEW.trade_in, NEW.trade_in_vehicle,
        NEW.dealership, NEW.period_id,
        -- MANUAL, not the WORKBOOK default. reset() deletes only
        -- origin = 'WORKBOOK', so an enquiry left as WORKBOOK would be
        -- silently deleted by the next monthly upload.
        coalesce(NEW.origin, 'MANUAL'),
        coalesce(NEW.loaded_at, now()),
        coalesce(NEW.updated_at, now()),
        coalesce(NEW.entered_by, 'agent'),
        NEW.is_current_period);

    RETURN NEW;
END $$;

COMMENT ON FUNCTION dsr.lead_insert_from_api() IS
  'Fills in the reporting month, the visibility flag and MANUAL provenance for
   leads written through public.lead - the path the chat agent uses via
   Supabase. Without it an agent enquiry is stored correctly and displayed
   nowhere.';

DROP TRIGGER IF EXISTS lead_insert_instead ON public.lead;
CREATE TRIGGER lead_insert_instead
    INSTEAD OF INSERT ON public.lead
    FOR EACH ROW EXECUTE FUNCTION dsr.lead_insert_from_api();
