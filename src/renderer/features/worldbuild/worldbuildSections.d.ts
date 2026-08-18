export type SheetTabId = 'data' | 'inventory' | 'connections' | 'knowledge' | 'occurrences';
export type SheetVariant = 'individual' | 'group';

export interface NativeSection {
  id: string;
  label: string;
  tab: SheetTabId;
  /** Present when the section belongs to only one shape of the type. */
  variant?: SheetVariant;
  /** Filled in from other records rather than edited directly. */
  derived?: boolean;
}

export declare const TAB_LABELS: Record<SheetTabId, string>;
export declare const TAB_ORDER: SheetTabId[];
export declare const VARIANT_LABELS: Record<SheetVariant, string>;
export declare const TYPE_VARIANTS: Record<string, SheetVariant[]>;
export declare const TYPE_SECTIONS: Record<string, NativeSection[]>;
export declare function canonicalSectionId(typeId: string, sectionId: string): string;
export declare function nativeSections(typeId: string): NativeSection[];
export declare function sheetSections(typeId: string, variant?: SheetVariant | null): NativeSection[];
export declare function sheetTabs(typeId: string, variant?: SheetVariant | null): SheetTabId[];
export declare function tabLabel(typeId: string, variant: SheetVariant | null, tab: SheetTabId | string): string;
export declare function templateSections(typeId: string): NativeSection[];
export declare function normalizeTemplateSections<T extends { id: string; kind?: string }>(
  typeId: string,
  sections?: T[],
): T[];
export declare function variantsOf(typeId: string): SheetVariant[];
