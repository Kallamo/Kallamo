import type { ComponentType } from 'react';

export interface CheckboxProps {
  checked?: boolean;
  onChange?(checked: boolean): void;
  label?: string | null;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}

declare const Checkbox: ComponentType<CheckboxProps>;
export default Checkbox;
