import type { ForwardRefExoticComponent, ReactElement, ReactNode, RefAttributes } from 'react';

export function SpoilerScope(props: { data?: Record<string, unknown> | null; onToggle?: (field: string, hidden: boolean) => void; children?: ReactNode }): ReactElement;
export function useSpoiler(field?: string | null): { covered: boolean; hidden: boolean; reveal(): void; setHidden(on: boolean): void };
export function SpoilerCover(props: { field?: string | null; compact?: boolean; className?: string; children?: ReactNode }): ReactElement | null;
export function FieldEye(props: { field?: string | null; size?: 'sm' | 'md'; className?: string }): ReactElement | null;
export function SpoilerRow(props: { field?: string | null; editing?: boolean; children?: ReactNode }): ReactElement;
export function SpoilerMenuItem(props: { field?: string | null; onDone?: () => void }): ReactElement | null;
export function SpoilerText(props: { text: unknown }): ReactElement;
export const SpoilerTextArea: ForwardRefExoticComponent<{
  value?: string;
  onChange?: (event: { target: { value: string } }) => void;
  rows?: number;
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
} & RefAttributes<{ focus(options?: unknown): void }>>;
