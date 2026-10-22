import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, ScrollText, SquarePen } from 'lucide-react';
import IconButton from '../../components/ui/IconButton';

/**
 * The pages written in an item, in reading order. They live in the Writing Desk; the AI reads
 * them only when the item is read in a scene, as what their author wrote.
 */
export default function WorldbuildItemText({ workspaceId, item, api, showToast, onOpenPage }) {
  const [pages, setPages] = useState([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const result = await api.listItemTexts?.(workspaceId, item.id);
    setPages(result?.success ? result.pages : []);
  }, [api, item.id, workspaceId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => api.onInWorldTextsChanged?.(payload => { if (payload?.workspaceId === workspaceId) load(); }), [api, load, workspaceId]);

  const move = async (page, direction) => {
    const result = await api.moveItemText(page.documentId, direction);
    if (!result?.success) return showToast(result?.error || 'Could not move the page.', 'error');
    setPages(result.pages);
  };

  const create = async () => {
    setCreating(true);
    try {
      const title = pages.length ? `${item.canonicalName}, page ${pages.length + 1}` : item.canonicalName;
      const result = await api.createItemText(workspaceId, item.id, title);
      if (!result?.success) throw new Error(result?.error || 'Could not create the page.');
      onOpenPage({ documentId: result.document.id, folderId: result.folderId });
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const write = (
    <button type="button" onClick={create} disabled={creating}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-hover/60 hover:text-text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      <Plus className="h-3.5 w-3.5" aria-hidden="true" />{pages.length ? 'Add a page' : 'Write its text'}
    </button>
  );

  if (!pages.length) {
    return (
      <section className="flex min-h-12 items-center gap-2.5 rounded-card border border-border-subtle bg-surface-panel-muted/45 py-1.5 pl-4 pr-2 backdrop-blur-md">
        <ScrollText className="h-4 w-4 shrink-0 text-text-disabled" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-text-secondary">Written pages</h2>
        <span className="min-w-0 flex-1 truncate text-sm text-text-disabled">Nothing written in it</span>
        {write}
      </section>
    );
  }

  return (
    <section className="ws-card overflow-hidden rounded-card border border-border-default bg-surface-panel-muted/60 backdrop-blur-md">
      <header className="flex min-h-11 items-center gap-2.5 border-b border-border-subtle pl-4 pr-2">
        <ScrollText className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-text-primary">Written pages</h2>
        <span className="text-xs tabular-nums text-text-subtle">{pages.length}</span>
        <span className="flex-1" />
        {write}
      </header>
      <p className="caption px-4 pt-3">Read by the AI only when someone reads {item.canonicalName} in a scene, as what its author wrote.</p>
      <ol className="divide-y divide-border-subtle px-4 pb-2 pt-1">
        {pages.map((page, index) => (
          <li key={page.documentId} className="flex items-center gap-3 py-2">
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-text-subtle">{index + 1}</span>
            <button type="button" onClick={() => onOpenPage(page)}
              className="min-w-0 flex-1 truncate text-left text-sm font-medium text-text-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              {page.title || 'Untitled'}
            </button>
            <IconButton icon={ArrowUp} size="sm" label="Earlier in the reading order" disabled={index === 0} onClick={() => move(page, -1)} />
            <IconButton icon={ArrowDown} size="sm" label="Later in the reading order" disabled={index === pages.length - 1} onClick={() => move(page, 1)} />
            <IconButton icon={SquarePen} size="sm" label={`Open ${page.title || 'the page'} in the Writing Desk`} onClick={() => onOpenPage(page)} />
          </li>
        ))}
      </ol>
    </section>
  );
}
