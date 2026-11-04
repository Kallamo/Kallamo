import type { ComponentType, ReactNode } from 'react';

export interface ModalProps {
  onClose?: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'wide' | '2xl' | 'editor';
  title?: ReactNode;
  icon?: ComponentType<{ className?: string }> | null;
  iconClassName?: string;
  subtitle?: ReactNode;
  /** Replaces the icon, for dialogs that open on a thing with its own medallion. */
  leading?: ReactNode;
  /** Shown at the right of the header, before the close button. */
  aside?: ReactNode;
  closeOnOverlay?: boolean;
  closeOnEsc?: boolean;
  showClose?: boolean;
  className?: string;
  children?: ReactNode;
}

export default function Modal(props: ModalProps): ReactNode;
