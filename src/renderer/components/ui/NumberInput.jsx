import React, { useEffect, useRef, useState } from 'react';

const parse = (text, integer) => {
  const trimmed = String(text).trim().replace(',', '.');
  if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return integer ? Math.trunc(value) : value;
};

const clamp = (value, min, max) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));

/**
 * The text is the writer's while typing; `onChange` only hears valid numbers in range. Leaving
 * the field clamps it, or restores the last value when empty unless `nullable`.
 */
export default function NumberInput({
  value,
  onChange,
  min: minProp,
  max: maxProp,
  step: stepProp = 1,
  integer = true,
  nullable = false,
  onBlur,
  onKeyDown,
  onFocus,
  ...rest
}) {
  // Callers pass limits from markup as strings too.
  const min = minProp == null || minProp === '' ? undefined : Number(minProp);
  const max = maxProp == null || maxProp === '' ? undefined : Number(maxProp);
  const step = Number(stepProp) || 1;
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value == null ? '' : String(value));
  }, [value]);

  const inRange = (n) => (min == null || n >= min) && (max == null || n <= max);

  const handleChange = (event) => {
    const text = event.target.value;
    if (!/^-?\d*([.,]\d*)?$/.test(text) || (integer && /[.,]/.test(text))) return;
    if (min != null && min >= 0 && text.startsWith('-')) return;
    setDraft(text);
    if (nullable && text.trim() === '') {
      if (value != null) onChange?.(null);
      return;
    }
    const parsed = parse(text, integer);
    if (parsed != null && inRange(parsed) && parsed !== value) onChange?.(parsed);
  };

  const settle = () => {
    const parsed = parse(draft, integer);
    if (parsed == null) {
      setDraft(nullable && draft.trim() === '' ? '' : value == null ? '' : String(value));
      return;
    }
    const next = clamp(parsed, min, max);
    setDraft(String(next));
    if (next !== value) onChange?.(next);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const base = parse(draft, integer) ?? value ?? min ?? 0;
      const next = clamp(base + (event.key === 'ArrowUp' ? step : -step), min, max);
      setDraft(String(next));
      if (next !== value) onChange?.(next);
    } else if (event.key === 'Enter') {
      settle();
    }
    onKeyDown?.(event);
  };

  return (
    <input
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={draft}
      onChange={handleChange}
      onFocus={(event) => { focused.current = true; onFocus?.(event); }}
      onBlur={(event) => { focused.current = false; settle(); onBlur?.(event); }}
      onKeyDown={handleKeyDown}
      {...rest}
    />
  );
}
