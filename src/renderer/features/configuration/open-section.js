// The request outlives the switch to Configuration: a view still mounting reads it on mount.
let pendingSection = null;

export function openConfigurationSection(sectionId) {
  pendingSection = sectionId;
  window.dispatchEvent(new CustomEvent('configuration-open-section', { detail: { sectionId } }));
}

export function takeConfigurationSection() {
  const sectionId = pendingSection;
  pendingSection = null;
  return sectionId;
}
