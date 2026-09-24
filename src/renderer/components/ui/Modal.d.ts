import type { ComponentType, ReactNode } from 'react';

export interface ModalProps {
  onClose?: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'wide' | '2xl';
  title?: ReactNode;
  icon?: ComponentType<{ className?: string }> | null;
  closeOnOverlay?: boolean;
  closeOnEsc?: boolean;
  showClose?: boolean;
  className?: string;
  children?: ReactNode;
}

export default function Modal(props: ModalProps): ReactNode;
