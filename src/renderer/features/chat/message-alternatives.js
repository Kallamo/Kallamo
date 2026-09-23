// Alternatives are stored as JSON `{ activeIndex, list }`; a bare array is read as a legacy list at index 0.
// Returns null when there is nothing to page between, so callers render no switcher.
export function readAlternativeSwitcher(raw) {
  if (!raw) return null;

  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const isLegacyArray = Array.isArray(parsed);
  const list = isLegacyArray ? parsed : parsed?.list;
  if (!Array.isArray(list) || list.length < 2) return null;

  const storedIndex = isLegacyArray ? 0 : parsed.activeIndex;
  const index = Number.isInteger(storedIndex) && storedIndex >= 0 && storedIndex < list.length ? storedIndex : 0;
  return { index, count: list.length };
}
