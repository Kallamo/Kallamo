import type { ComponentType, ReactNode, RefObject } from 'react';

export interface MenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose?: () => void;
  label?: string;
  align?: 'left' | 'right';
  className?: string;
  children?: ReactNode | ((close: () => void) => ReactNode);
}

export interface MenuItemProps {
  icon?: ComponentType<{ className?: string }>;
  iconClassName?: string;
  label: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  onSelect?: () => void;
}

export function Menu(props: MenuProps): ReactNode;
export function MenuItem(props: MenuItemProps): ReactNode;
export function MenuLabel(props: { children?: ReactNode }): ReactNode;
export function MenuSeparator(): ReactNode;
export function MenuNote(props: { children?: ReactNode }): ReactNode;
export default Menu;
