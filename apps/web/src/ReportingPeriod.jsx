import React, { useEffect, useRef } from 'react';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';

const choices = [
  ['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days'], ['custom', 'Custom date'],
];
const formatDate = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});

export function ReportingPeriod({ period, date, max, onPeriod, onDate }) {
  const panel = useRef(null);
  const trigger = useRef(null);
  const calendar = useRef(null);
  function close() {
    panel.current.open = false;
    trigger.current.focus();
  }
  useEffect(() => {
    function outside(event) {
      if (!panel.current.contains(event.target)) panel.current.open = false;
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, []);
  const label = period === 'custom' ? formatDate.format(new Date(date + 'T00:00:00Z'))
    : choices.find(([value]) => value === period)[1];
  return (
    <details ref={panel} className="period-picker" onKeyDown={event => {
      if (event.key === 'Escape' && panel.current.open) close();
    }}>
      <summary ref={trigger} aria-label={'Reporting period: ' + label}>
        <CalendarDays size={17} /><span>{label}</span><ChevronDown size={14} />
      </summary>
      <div className="period-sheet">
        <fieldset>
          <legend>Reporting period</legend>
          {choices.map(([value, title]) => (
            <label key={value}>
              <input type="radio" name="report-period" value={value} checked={period === value}
                onChange={() => onPeriod(value)}
                onClick={() => {
                  if (value === 'custom') requestAnimationFrame(() => calendar.current?.focus());
                  else close();
                }} />
              <span>{title}</span>{period === value && <Check size={16} aria-hidden="true" />}
            </label>
          ))}
        </fieldset>
        {period === 'custom' && <input ref={calendar} aria-label="Business date" type="date"
          className="period-calendar" value={date} max={max} onChange={event => {
            if (event.target.value && event.target.validity.valid) onDate(event.target.value);
          }} />}
      </div>
    </details>
  );
}
