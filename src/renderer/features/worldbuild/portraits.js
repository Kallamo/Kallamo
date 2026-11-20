import { createContext, useContext, useEffect, useState } from 'react';

// Portraits per workspace, shared by the Worldbuild list, the sheet and the roleplay panel,
// so a new portrait shows everywhere without each view asking again.
const cache = new Map();
const listeners = new Set();
const notify = () => listeners.forEach(listener => listener());

export async function loadPortraits(workspaceId, api, { force = false } = {}) {
  if (!workspaceId || !api?.listEntityPortraits) return {};
  if (!force && cache.has(workspaceId)) return cache.get(workspaceId);
  const result = await api.listEntityPortraits(workspaceId).catch(() => null);
  cache.set(workspaceId, result?.success ? result.portraits || {} : {});
  notify();
  return cache.get(workspaceId);
}

export function usePortraits(workspaceId, api) {
  const [portraits, setPortraits] = useState(() => cache.get(workspaceId) || {});
  useEffect(() => {
    const sync = () => setPortraits(cache.get(workspaceId) || {});
    listeners.add(sync);
    sync();
    loadPortraits(workspaceId, api);
    return () => { listeners.delete(sync); };
  }, [workspaceId, api]);
  return portraits;
}

export const PortraitContext = createContext({});
export const usePortraitOf = (entityId) => useContext(PortraitContext)[entityId] || null;

export const portraitUrl = (portrait) => portrait?.imagePath ? `app-file:///${encodeURI(String(portrait.imagePath).replace(/\\/g, '/'))}` : null;
