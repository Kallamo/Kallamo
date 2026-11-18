// The workspace stays mounted under the Library; its window-wide shortcuts wait until it is back.
export const workspaceCovered = () => Boolean(document.querySelector('[data-workspace-covered]'));
