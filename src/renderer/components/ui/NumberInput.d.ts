import type { InputHTMLAttributes, ReactNode } from 'react';

export interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'step' | 'type'> {
  value: number | null | undefined;
  onChange?: (value: number | null) => void;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  /** Whole numbers only (default). */
  integer?: boolean;
  /** An empty field reports null instead of putting the last value back. */
  nullable?: boolean;
}

export default function NumberInput(props: NumberInputProps): ReactNode;
