import type { ComponentType, ReactNode } from 'react';

export interface ConfirmAction {
  label: string;
  onClick?: () => void | Promise<void>;
  variant?: 'primary' | 'danger' | 'ghost' | 'subtle';
  loading?: boolean;
  autoFocus?: boolean;
}

export interface ConfirmDialogProps {
  tone?: 'danger' | 'warning' | 'info' | 'question';
  icon?: ComponentType<{ className?: string }> | null;
  title?: ReactNode;
  message?: ReactNode;
  actions?: ConfirmAction[];
  onClose?: () => void;
}

export default function ConfirmDialog(props: ConfirmDialogProps): ReactNode;
