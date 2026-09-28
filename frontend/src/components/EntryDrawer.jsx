import React, { useState, useEffect } from 'react';
import useClosing from './useClosing';
import { X, Send, AlertCircle } from 'lucide-react';
import { sendJson } from '../api/client';

export default function EntryDrawer({
  isOpen,
  activeTab = 'booking',
  onClose,
  options = {},
  activePeriod = {},
  onSaved,
}) {
  const [currentTab, setCurrentTab] = useState(activeTab);
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setCurrentTab(activeTab);
  }, [activeTab]);

  // Determine default date (last day of month if outside active period)
  const today = new Date().toISOString().slice(0, 10);
  const defaultDate = () => {
    if (!activePeriod.period_start) return today;
    if (today >= activePeriod.period_start && today <= activePeriod.period_end) return today;
    return activePeriod.period_end || today;
  };

  // Reset form data when tab changes or drawer opens
  useEffect(() => {
    setError(null);
    const initial = {
      entered_by: localStorage.getItem('dsr.who') || '',
    };

    if (currentTab === 'booking') {
      initial.booking_date = defaultDate();
      initial.fulfilment_status = 'BOOKED';
      initial.source = 'Walk In';
      initial.model_year = new Date().getFullYear();
    } else if (currentTab === 'lead') {
      initial.created_on = defaultDate();
      initial.source = 'Walk In';
      initial.qualified = true;
    } else if (currentTab === 'testdrive') {
      initial.td_date = defaultDate();
    } else if (currentTab === 'allotment') {
      initial.allotted_date = defaultDate();
      if (options.open_bookings?.length) initial.booking_id = options.open_bookings[0].booking_id;
      if (options.free_chassis?.length) initial.chassis_number = options.free_chassis[0].chassis_number;
    } else if (currentTab === 'vehicle') {
      initial.stock_status = 'FREESTOCK';
      initial.model_year = new Date().getFullYear();
    }
    setFormData(initial);
  }, [currentTab, isOpen]);

  const { render, leaving } = useClosing(isOpen);
  if (!render) return null;

  const handleChange = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const endpoints = {
      booking: '/api/bookings',
      lead: '/api/leads',
      testdrive: '/api/test-drives',
      allotment: '/api/allotments',
      registration: '/api/registrations',
      vehicle: '/api/vehicles',
    };

    try {
      if (formData.entered_by) {
        localStorage.setItem('dsr.who', formData.entered_by);
      }

      // Convert numeric fields
      const payload = { ...formData };
      ['booking_amount', 'model_year', 'start_km', 'end_km', 'accessories', 'elite_discount'].forEach(k => {
        if (payload[k] !== undefined && payload[k] !== '') {
          payload[k] = Number(payload[k]);
        }
      });
      if (payload.booking_id) payload.booking_id = Number(payload.booking_id);

      const res = await sendJson('POST', endpoints[currentTab], payload);
      onSaved(`${currentTab.toUpperCase()} successfully saved to Supabase!`, res);
      onClose();
    } catch (err) {
      setError(err.message || 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: 'booking', label: 'New Booking' },
    { id: 'lead', label: 'New Lead' },
    { id: 'testdrive', label: 'Test Drive' },
    { id: 'allotment', label: 'Allotment / Delivery' },
    { id: 'registration', label: 'Retail Delivery' },
    { id: 'vehicle', label: 'Vehicle Stock' },
  ];

  return (
    <>
      <div className={`drawer-scrim ${leaving ? 'is-leaving' : ''}`} onClick={onClose} />
      <aside className={`drawer ${leaving ? 'is-leaving' : ''}`}
             role="dialog" aria-label="Direct Data Entry Drawer">
        <div className="drawer-head">
          <div>
            <h2 style={{ fontSize: 'var(--fs-head)', fontWeight: '800' }}>Direct Cloud Data Entry</h2>
            <p style={{ margin: '2px 0 0', color: 'var(--ink-muted)', fontSize: 'var(--fs-small)' }}>
              Saves straight to Supabase cloud PostgreSQL.
            </p>
          </div>
          <button onClick={onClose} style={{ padding: '6px', borderRadius: '50%' }}>
            <X size={18} />
          </button>
        </div>

        <div className="drawer-tabs">
          {tabs.map(t => (
            <button
              key={t.id}
              className={currentTab === t.id ? 'active' : ''}
              onClick={() => setCurrentTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div className="drawer-body">
            {error && (
              <div style={{
                background: 'var(--critical-light)',
                border: '1px solid var(--critical)',
                borderRadius: '8px',
                padding: '10px 14px',
                color: 'var(--critical)',
                fontSize: 'var(--fs-small)',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}>
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {/* TAB: BOOKING */}
            {currentTab === 'booking' && (
              <>
                <label className="field">
                  <span>Customer Name *</span>
                  <input
                    required
                    value={formData.customer_name || ''}
                    onChange={e => handleChange('customer_name', e.target.value)}
                    placeholder="e.g. Anand Kumar"
                  />
                </label>

                <div className="row-2">
                  <label className="field">
                    <span>Sales Consultant *</span>
                    <select
                      required
                      value={formData.consultant || ''}
                      onChange={e => handleChange('consultant', e.target.value)}
                    >
                      <option value="">Select consultant...</option>
                      {(options.consultants || []).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Enquiry Source *</span>
                    <select
                      required
                      value={formData.source || ''}
                      onChange={e => handleChange('source', e.target.value)}
                    >
                      {(options.sources || []).map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="row-2">
                  <label className="field">
                    <span>Model *</span>
                    <select
                      required
                      value={formData.model || ''}
                      onChange={e => handleChange('model', e.target.value)}
                    >
                      <option value="">Select model...</option>
                      {(options.models || []).map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Variant</span>
                    <input
                      value={formData.variant || ''}
                      onChange={e => handleChange('variant', e.target.value)}
                      placeholder="e.g. GT Line AT"
                    />
                  </label>
                </div>

                <div className="row-2">
                  <label className="field">
                    <span>Colour</span>
                    <select
                      value={formData.colour || ''}
                      onChange={e => handleChange('colour', e.target.value)}
                    >
                      <option value="">Select colour...</option>
                      {(options.colours || []).map(col => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Mobile (10 digits)</span>
                    <input
                      value={formData.mobile || ''}
                      onChange={e => handleChange('mobile', e.target.value)}
                      placeholder="9876543210"
                    />
                  </label>
                </div>

                <div className="row-2">
                  <label className="field">
                    <span>Booking Amount ₹</span>
                    <input
                      type="number"
                      value={formData.booking_amount || ''}
                      onChange={e => handleChange('booking_amount', e.target.value)}
                      placeholder="25000"
                    />
                  </label>

                  <label className="field">
                    <span>Booking Date *</span>
                    <input
                      type="date"
                      required
                      value={formData.booking_date || ''}
                      onChange={e => handleChange('booking_date', e.target.value)}
                    />
                  </label>
                </div>

                <div className="row-2">
                  <label className="field">
                    <span>Status</span>
                    <select
                      value={formData.fulfilment_status || 'BOOKED'}
                      onChange={e => handleChange('fulfilment_status', e.target.value)}
                    >
                      <option value="BOOKED">BOOKED</option>
                      <option value="NO_STOCK">NO_STOCK</option>
                      <option value="ALLOTED">ALLOTED</option>
                      <option value="RETAILED">RETAILED</option>
                    </select>
                  </label>

                  <label className="field">
                    <span>Punched in CRM?</span>
                    <select
                      value={formData.crm_entry_done === true ? 'true' : formData.crm_entry_done === false ? 'false' : ''}
                      onChange={e => handleChange('crm_entry_done', e.target.value === 'true' ? true : e.target.value === 'false' ? false : null)}
                    >
                      <option value="">Not yet</option>
                      <option value="true">Yes, Punched</option>
                      <option value="false">No</option>
                    </select>
                  </label>
                </div>

                <label className="field">
                  <span>Remarks / Notes</span>
                  <textarea
                    rows={2}
                    value={formData.notes || ''}
                    onChange={e => handleChange('notes', e.target.value)}
                  />
                </label>
              </>
            )}

            {/* TAB: LEAD */}
            {currentTab === 'lead' && (
              <>
                <label className="field">
                  <span>Customer Name *</span>
                  <input
                    required
                    value={formData.lead_name || ''}
                    onChange={e => handleChange('lead_name', e.target.value)}
                    placeholder="Ramesh Iyer"
                  />
                </label>

                <div className="row-2">
                  <label className="field">
                    <span>Source *</span>
                    <select
                      required
                      value={formData.source || ''}
                      onChange={e => handleChange('source', e.target.value)}
                    >
                      {(options.sources || []).map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Consultant</span>
                    <select
                      value={formData.consultant || ''}
                      onChange={e => handleChange('consultant', e.target.value)}
                    >
                      <option value="">Select consultant...</option>
                      {(options.consultants || []).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="row-2">
                  <label className="field">
                    <span>Mobile (10 digits)</span>
                    <input
                      value={formData.mobile || ''}
                      onChange={e => handleChange('mobile', e.target.value)}
                      placeholder="9845012345"
                    />
                  </label>

                  <label className="field">
                    <span>Rating</span>
                    <select
                      value={formData.rating || ''}
                      onChange={e => handleChange('rating', e.target.value)}
                    >
                      <option value="Hot">Hot</option>
                      <option value="Warm">Warm</option>
                      <option value="Cold">Cold</option>
                    </select>
                  </label>
                </div>

                <label className="field">
                  <span>Model of Interest</span>
                  <input
                    value={formData.model_of_interest || ''}
                    onChange={e => handleChange('model_of_interest', e.target.value)}
                    placeholder="Virtus / Taigun GT Line"
                  />
                </label>

                <div className="row-2">
                  <label className="field">
                    <span>Enquiry Date *</span>
                    <input
                      type="date"
                      required
                      value={formData.created_on || ''}
                      onChange={e => handleChange('created_on', e.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>Qualified?</span>
                    <select
                      value={formData.qualified ? 'true' : 'false'}
                      onChange={e => handleChange('qualified', e.target.value === 'true')}
                    >
                      <option value="true">Yes, Qualified</option>
                      <option value="false">No</option>
                    </select>
                  </label>
                </div>
              </>
            )}

            {/* TAB: TEST DRIVE */}
            {currentTab === 'testdrive' && (
              <>
                <label className="field">
                  <span>Customer Name *</span>
                  <input
                    required
                    value={formData.lead_name || ''}
                    onChange={e => handleChange('lead_name', e.target.value)}
                    placeholder="Customer Name"
                  />
                </label>

                <div className="row-2">
                  <label className="field">
                    <span>Consultant</span>
                    <select
                      value={formData.consultant || ''}
                      onChange={e => handleChange('consultant', e.target.value)}
                    >
                      <option value="">Select consultant...</option>
                      {(options.consultants || []).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Source</span>
                    <select
                      value={formData.source || ''}
                      onChange={e => handleChange('source', e.target.value)}
                    >
                      {(options.sources || []).map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="field">
                  <span>Model Driven</span>
                  <input
                    value={formData.model_of_interest || ''}
                    onChange={e => handleChange('model_of_interest', e.target.value)}
                    placeholder="Taigun 1.0L TSI GT Line"
                  />
                </label>

                <div className="row-2">
                  <label className="field">
                    <span>Start KM</span>
                    <input
                      type="number"
                      value={formData.start_km || ''}
                      onChange={e => handleChange('start_km', e.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>End KM</span>
                    <input
                      type="number"
                      value={formData.end_km || ''}
                      onChange={e => handleChange('end_km', e.target.value)}
                    />
                  </label>
                </div>

                <label className="field">
                  <span>Date *</span>
                  <input
                    type="date"
                    required
                    value={formData.td_date || ''}
                    onChange={e => handleChange('td_date', e.target.value)}
                  />
                </label>
              </>
            )}

            {/* TAB: ALLOTMENT */}
            {currentTab === 'allotment' && (
              <>
                <label className="field">
                  <span>Open Booking *</span>
                  <select
                    required
                    value={formData.booking_id || ''}
                    onChange={e => handleChange('booking_id', e.target.value)}
                  >
                    {(options.open_bookings || []).map(b => (
                      <option key={b.booking_id} value={b.booking_id}>
                        {b.customer_name} &mdash; {b.model} {b.variant || ''} {b.consultant ? `· ${b.consultant}` : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Car From Free Stock *</span>
                  <select
                    required
                    value={formData.chassis_number || ''}
                    onChange={e => handleChange('chassis_number', e.target.value)}
                  >
                    {(options.free_chassis || []).map(c => (
                      <option key={c.chassis_number} value={c.chassis_number}>
                        {c.chassis_number} &mdash; {c.model} {c.variant || ''} · {c.colour || '?'} · {c.stock_aging_days ?? '?'} d
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Allotted Date *</span>
                  <input
                    type="date"
                    required
                    value={formData.allotted_date || ''}
                    onChange={e => handleChange('allotted_date', e.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Remarks</span>
                  <textarea
                    rows={2}
                    value={formData.remarks || ''}
                    onChange={e => handleChange('remarks', e.target.value)}
                  />
                </label>
              </>
            )}

            {/* TAB: REGISTRATION */}
            {currentTab === 'registration' && (
              <>
                <label className="field">
                  <span>Customer Name *</span>
                  <input
                    required
                    value={formData.customer_name || ''}
                    onChange={e => handleChange('customer_name', e.target.value)}
                  />
                </label>

                <div className="row-2">
                  <label className="field">
                    <span>Registration No</span>
                    <input
                      value={formData.registration_no || ''}
                      onChange={e => handleChange('registration_no', e.target.value)}
                      placeholder="KA01AB1234"
                    />
                  </label>

                  <label className="field">
                    <span>Delivery Date</span>
                    <input
                      type="date"
                      value={formData.delivery_date || ''}
                      onChange={e => handleChange('delivery_date', e.target.value)}
                    />
                  </label>
                </div>
              </>
            )}

            {/* TAB: VEHICLE */}
            {currentTab === 'vehicle' && (
              <>
                <label className="field">
                  <span>Chassis Number *</span>
                  <input
                    required
                    value={formData.chassis_number || ''}
                    onChange={e => handleChange('chassis_number', e.target.value)}
                    placeholder="MEXA26D21TT022886"
                  />
                </label>

                <div className="row-2">
                  <label className="field">
                    <span>Model *</span>
                    <select
                      required
                      value={formData.model || ''}
                      onChange={e => handleChange('model', e.target.value)}
                    >
                      {(options.models || []).map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Variant</span>
                    <input
                      value={formData.variant || ''}
                      onChange={e => handleChange('variant', e.target.value)}
                    />
                  </label>
                </div>
              </>
            )}

            <label className="field" style={{ marginTop: '14px', borderTop: '1px solid var(--grid)', paddingTop: '14px' }}>
              <span>Entered By <em>(for audit trail)</em></span>
              <input
                value={formData.entered_by || ''}
                onChange={e => handleChange('entered_by', e.target.value)}
                placeholder="Your Name"
              />
            </label>
          </div>

          <div className="drawer-foot">
            <button type="button" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={loading}>
              <Send size={14} />
              <span>{loading ? 'Saving to Supabase...' : 'Save Record'}</span>
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
