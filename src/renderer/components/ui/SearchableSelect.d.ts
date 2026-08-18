import type { ComponentType, ReactElement } from 'react';

export interface SearchableSelectOption {
  id: string;
  label: string;
  aliases?: string[];
  keywords?: string[];
  group?: string;
  description?: string;
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  color?: string;
}

interface SearchableSelectCommonProps {
  options?: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  clearable?: boolean;
  autoOpen?: boolean;
  ariaLabel?: string;
  className?: string;
}

export interface SearchableSelectSingleProps extends SearchableSelectCommonProps {
  multiple?: false;
  value?: string;
  values?: never;
  onChange: (value: string) => void;
}

export interface SearchableSelectMultipleProps extends SearchableSelectCommonProps {
  multiple: true;
  value?: never;
  values?: string[];
  onChange: (values: string[]) => void;
}

export default function SearchableSelect(
  props: SearchableSelectSingleProps | SearchableSelectMultipleProps
): ReactElement;
