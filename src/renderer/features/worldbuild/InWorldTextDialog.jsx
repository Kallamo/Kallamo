import React, { useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import SearchableSelect from '../../components/ui/SearchableSelect';

const AUTHOR_TYPES = ['Characters', 'Creatures', 'Factions'];

// Marks a chapter as something written inside the story, held by an item. The AI then reads it
// only when that item is read, as what its author wrote.
export default function InWorldTextDialog({ workspaceId, document, electronAPI, showToast, onClose, onChanged }) {
  const [entities, setEntities] = useState([]);
  const [current, setCurrent] = useState(null);
  const [itemId, setItemId] = useState('');
  const [authorId, setAuthorId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([electronAPI.listEntities(workspaceId), electronAPI.getInWorldText(document.id)]).then(([list, text]) => {
      if (!active) return;
      setEntities((list?.entities || []).filter(entity => entity.status !== 'proposed'));
      const found = text?.text || null;
      setCurrent(found);
      setItemId(found?.itemId || '');
      setAuthorId(found?.authorId || '');
    });
    return () => { active = false; };
  }, [workspaceId, document.id, electronAPI]);

  const option = entity => ({ id: entity.id, label: entity.canonicalName, aliases: entity.aliases, group: entity.type === 'Items' ? undefined : entity.type.replace(/s$/, '') });
  const items = entities.filter(entity => entity.type === 'Items').map(option);
  const authors = entities.filter(entity => AUTHOR_TYPES.includes(entity.type)).map(option);

  const run = async (action, message) => {
    setSaving(true);
    try {
      const result = await action();
      if (!result?.success) throw new Error(result?.error || 'The chapter could not be changed.');
      showToast(message, 'success');
      onChanged?.();
      onClose();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} size="md" title="In-world text" icon={ScrollText}>
      <div className="flex flex-col gap-4 p-5">
        <p className="text-sm leading-relaxed text-text-muted">
          A journal, a letter or a notice that exists inside the story. The AI reads it only when someone reads the item in a scene, as what its author wrote, and it stays out of story search and entity updates.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text-secondary">Written in</span>
          <SearchableSelect ariaLabel="Item that holds the text" value={itemId} onChange={value => setItemId(value || '')} options={items}
            placeholder={items.length ? 'Choose an item' : 'No items in this world yet'} emptyMessage="No item matches." searchInTrigger />
          <span className="caption">The item a character has to hold or find to read it.</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text-secondary">Written by <span className="font-normal text-text-subtle">(optional)</span></span>
          <SearchableSelect ariaLabel="Author of the text" value={authorId} onChange={value => setAuthorId(value || '')} options={authors}
            placeholder="Unknown author" emptyMessage="No one matches." searchInTrigger />
          <span className="caption">Readers learn what the text says as the author's word, not as fact.</span>
        </label>
      </div>
      <div className="flex items-center gap-2 border-t border-border-subtle px-5 py-3.5">
        {current && (
          <Button variant="subtle" disabled={saving} onClick={() => run(() => electronAPI.clearInWorldText(document.id), `“${document.title || 'Untitled'}” is a story chapter again.`)}>
            Make it a story chapter
          </Button>
        )}
        <span className="flex-1" />
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={saving} disabled={!itemId}
          onClick={() => run(() => electronAPI.setInWorldText(document.id, itemId, authorId || null), `“${document.title || 'Untitled'}” is now written in ${items.find(item => item.id === itemId)?.label || 'the item'}.`)}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
