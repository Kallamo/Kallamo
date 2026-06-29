// Robust copy for Electron: navigator.clipboard.writeText is permission/focus-gated
// and throws on programmatic copies, so prefer the ungated main-process clipboard,
// then fall back to the Web API, then to a DOM execCommand last resort.
export async function copyText(text) {
  try { if (window.electronAPI?.copyToClipboard) return await window.electronAPI.copyToClipboard(text); } catch (e) {}
  try { return await navigator.clipboard.writeText(text); } catch (e) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text == null ? '' : String(text);
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch (e) {}
}
