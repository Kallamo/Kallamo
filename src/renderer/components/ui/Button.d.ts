import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'danger' | 'ghost' | 'subtle';
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ComponentType<{ className?: string; strokeWidth?: number }> | null;
  fullWidth?: boolean;
  children?: ReactNode;
}

export default function Button(props: ButtonProps): ReactNode;
