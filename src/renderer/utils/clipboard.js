// navigator.clipboard is gated in Electron: main-process clipboard, then the Web API, then execCommand.
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
