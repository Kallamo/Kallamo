// Where the reader was in Worldbuild, per workspace: sheet, tab, search, filter and scroll.
// It lives while the workspace is open, so moving between its tabs keeps the place, and is
// forgotten when the workspace closes, so the next visit starts from the world overview.
export const worldbuildViewCache = new Map();

export function forgetWorldbuildView(workspaceId) {
  if (workspaceId) worldbuildViewCache.delete(workspaceId);
}
