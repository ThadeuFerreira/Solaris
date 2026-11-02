import { useId, useState, type ReactNode } from 'react';

interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  full?: boolean;
  /** When false, clearing the field keeps the last value instead of sending null. */
  nullable?: boolean;
}

/** Numeric input that lets the user type freely and only commits valid numbers. */
export function NumberField({ label, value, onChange, unit, min, max, step, placeholder, full, nullable }: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState(value === null ? '' : String(value));
  const [lastValue, setLastValue] = useState(value);

  // Resync the text when the value changes from outside, but keep partial
  // input like "1." that still parses to the same number.
  if (value !== lastValue) {
    setLastValue(value);
    const parsed = text === '' ? null : Number(text);
    if (parsed !== value) setText(value === null ? '' : String(value));
  }

  return (
    <label className={`field${full ? ' field-full' : ''}`} htmlFor={id}>
      <span>{label}</span>
      <div className="input-unit">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          step={step ?? 'any'}
          placeholder={placeholder}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            if (raw === '') {
              if (nullable) onChange(null);
              return;
            }
            let n = Number(raw);
            if (!Number.isFinite(n)) return;
            if (min !== undefined) n = Math.max(min, n);
            if (max !== undefined) n = Math.min(max, n);
            onChange(n);
          }}
        />
        {unit && <em>{unit}</em>}
      </div>
    </label>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function Section({
  title,
  note,
  defaultOpen = true,
  children,
}: {
  title: string;
  note?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="card section" open={defaultOpen}>
      <summary>
        {title}
        {note && <span className="section-summary-note">{note}</span>}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}
