// Spoilers hide Worldbuild text from the reader, never from the AI. A span is written
// ||like this|| on one line; the markers must touch text so "a || b || c" is left alone.
export const SPOILER_PATTERN = /\|\|(?=\S)([^|\n]*?\S)\|\|/g;

export type SpoilerSegment = { type: 'text' | 'spoiler'; value: string };

export function parseSpoilers(text: unknown): SpoilerSegment[] {
  const source = String(text ?? '');
  const segments: SpoilerSegment[] = [];
  let last = 0;
  for (const match of source.matchAll(SPOILER_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ type: 'text', value: source.slice(last, start) });
    segments.push({ type: 'spoiler', value: match[1] });
    last = start + match[0].length;
  }
  if (last < source.length) segments.push({ type: 'text', value: source.slice(last) });
  return segments;
}

export function hasSpoilers(text: unknown): boolean {
  return parseSpoilers(text).some(segment => segment.type === 'spoiler');
}

export function stripSpoilerMarkers(text: string): string;
export function stripSpoilerMarkers(text: unknown): unknown;
export function stripSpoilerMarkers(text: unknown): unknown {
  return typeof text === 'string' && text.includes('||') ? text.replace(SPOILER_PATTERN, '$1') : text;
}

export function spoilerSpans(text: unknown): string[] {
  return parseSpoilers(text).filter(segment => segment.type === 'spoiler').map(segment => `||${segment.value}||`);
}

/** Spans of `before` that `after` no longer carries verbatim. */
export function missingSpoilers(before: unknown, after: unknown): string[] {
  const remaining = spoilerSpans(after);
  return spoilerSpans(before).filter(span => {
    const index = remaining.indexOf(span);
    if (index === -1) return true;
    remaining.splice(index, 1);
    return false;
  });
}

// Which sheet fields the reader hides. Stored on the entity so it travels in a package.
export const HIDDEN_FIELDS_KEY = 'spoilers';

export function hiddenFields(data: unknown): string[] {
  const list = (data && typeof data === 'object') ? (data as Record<string, unknown>)[HIDDEN_FIELDS_KEY] : null;
  return Array.isArray(list) ? list.filter((key): key is string => typeof key === 'string') : [];
}

export function withFieldHidden(data: Record<string, unknown>, field: string, hidden: boolean): Record<string, unknown> {
  const next = new Set(hiddenFields(data));
  if (hidden) next.add(field);
  else next.delete(field);
  return { ...data, [HIDDEN_FIELDS_KEY]: [...next] };
}
