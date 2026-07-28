import { useState, useRef, useEffect } from 'react';

interface Props {
  availableDates: Set<string>; // 'YYYY-MM-DD'
  selectedDate: string;
  onSelect: (date: string) => void;
  onClear: () => void;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function getInitialMonth(selectedDate: string, availableDates: Set<string>) {
  if (selectedDate) {
    const d = new Date(selectedDate + 'T00:00:00');
    return { y: d.getFullYear(), m: d.getMonth() };
  }
  if (availableDates.size > 0) {
    const latest = Array.from(availableDates).sort().slice(-1)[0];
    const d = new Date(latest + 'T00:00:00');
    return { y: d.getFullYear(), m: d.getMonth() };
  }
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() };
}

export default function DatePickerCalendar({ availableDates, selectedDate, onSelect, onClear }: Props) {
  const init = getInitialMonth(selectedDate, availableDates);
  const [isOpen, setIsOpen] = useState(false);
  const [viewYear, setViewYear] = useState(init.y);
  const [viewMonth, setViewMonth] = useState(init.m);
  const containerRef = useRef<HTMLDivElement>(null);

  // When the calendar opens, jump to the month of the selected/latest date
  useEffect(() => {
    if (isOpen) {
      const { y, m } = getInitialMonth(selectedDate, availableDates);
      setViewYear(y);
      setViewMonth(m);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }
  function toISO(day: number) {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  return (
    <div ref={containerRef} className="date-picker-wrap">
      {/* Trigger button */}
      <button
        className="section-date-btn"
        onClick={() => setIsOpen(o => !o)}
        title={
          selectedDate
            ? `Filtered: ${new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-GB')} — click to change`
            : 'Filter by date'
        }
        aria-label="Pick a date to filter the daily table"
      >
        {/* Calendar SVG icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        {selectedDate && (
          <span className="section-date-value">
            {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-GB')}
          </span>
        )}
      </button>

      {/* Clear button (only when date is selected) */}
      {selectedDate && (
        <button
          className="section-date-clear"
          onClick={() => { onClear(); setIsOpen(false); }}
          title="Clear date filter"
        >
          ×
        </button>
      )}

      {/* Calendar popup */}
      {isOpen && (
        <div className="cal-popup">
          {/* Month navigation header */}
          <div className="cal-header">
            <button className="cal-nav" onClick={prevMonth} title="Previous month">‹</button>
            <span className="cal-month-label">{MONTH_NAMES[viewMonth]} {viewYear}</span>
            <button className="cal-nav" onClick={nextMonth} title="Next month">›</button>
          </div>

          {/* Day grid */}
          <div className="cal-grid">
            {/* Weekday name headers */}
            {DAY_NAMES.map(d => (
              <div key={d} className="cal-weekday">{d}</div>
            ))}
            {/* Empty offset cells */}
            {Array.from({ length: firstDayOfWeek }, (_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {/* Day cells */}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const iso = toISO(day);
              const isAvail = availableDates.has(iso);
              const isSel = iso === selectedDate;
              return (
                <button
                  key={iso}
                  className={[
                    'cal-day',
                    isSel ? 'cal-day--selected' : '',
                    isAvail ? 'cal-day--avail' : 'cal-day--disabled',
                  ].filter(Boolean).join(' ')}
                  disabled={!isAvail}
                  onClick={() => { onSelect(iso); setIsOpen(false); }}
                  title={
                    isAvail
                      ? `Select ${new Date(iso + 'T00:00:00').toLocaleDateString('en-GB')}`
                      : 'No ad data for this date'
                  }
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="cal-footer">
            <span className="cal-legend cal-legend--avail" /> has data &nbsp;
            <span className="cal-legend cal-legend--disabled" /> no data
          </div>
        </div>
      )}
    </div>
  );
}
