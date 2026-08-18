import type { ReactElement } from 'react';

export type WorldDateValue = Record<string, unknown>;

export interface WorldDateInputProps {
  calendar: Record<string, any>;
  value?: WorldDateValue | null;
  onChange: (value: WorldDateValue | null) => void;
  includeTime?: boolean;
  allowClear?: boolean;
  label?: string;
  emptyLabel?: string;
  seedValue?: WorldDateValue | null;
  disabled?: boolean;
  className?: string;
  'aria-describedby'?: string;
}

export function formatWorldDate(
  calendar: Record<string, any>,
  value: WorldDateValue | null | undefined,
  includeTime?: boolean
): string;

export default function WorldDateInput(props: WorldDateInputProps): ReactElement | null;
