import React, { useState, useEffect } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import TextInput from '../ui/TextInput';
import Textarea from '../ui/Textarea';

const KEY_PATTERN = /^[a-zA-Z0-9_]+$/;
const keyFromName = (name) => name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export default function VariableModal({ variable, preset, onClose, onSave, inline = false }) {
  const isEditing = !!variable;
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    // A starter fills the name and description of a new variable; the text stays the user's.
    if (!variable && preset) {
      setName(preset.name || '');
      setKey(keyFromName(preset.name || ''));
      setDescription(preset.description || '');
      return;
    }
    if (!variable) return;
    setName(variable.name || '');
    setKey(variable.key || '');
    setValue(variable.value || '');
    setDescription(variable.description || '');
  }, [variable, preset]);

  // A new variable's tag follows its name until the tag is edited by hand.
  const changeName = (next) => {
    setName(next);
    if (!isEditing && !keyTouched) setKey(keyFromName(next));
  };

  const keyError = !key.trim() ? (keyTouched ? 'A tag is required.' : '') : (KEY_PATTERN.test(key) ? '' : 'Use only letters, numbers and _.');
  const canSave = !keyError && key.trim() && name.trim() && value.trim();

  const handleSave = () => {
    if (!canSave) return;
    onSave?.({
      id: variable?.id || 'var_' + Math.random().toString(36).substr(2, 9),
      name: name.trim(),
      key: key.trim(),
      value: value.trim(),
      description: description.trim(),
    });
    onClose();
  };

  return (
    <Modal
      onClose={onClose}
      size="xl"
      inline={inline}
      title={isEditing ? 'Edit variable' : 'New variable'}
      subtitle="A piece of text you can drop into any profile or workflow step."
      className="max-h-[calc(100vh-2rem)]"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto custom-scrollbar px-7 py-5">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <TextInput label="Name" value={name} onChange={e => changeName(e.target.value)} placeholder="Tone" autoFocus={!isEditing} />
          <div className="flex flex-col">
            <label htmlFor="variable-key" className="mb-1.5 block text-sm font-medium text-text-secondary">Tag</label>
            <div className={`flex min-h-10 items-center rounded-control border bg-surface-input px-3 font-mono text-sm ${keyError ? 'border-status-danger/60' : 'border-border-default focus-within:border-accent'} ${isEditing ? 'opacity-60' : ''}`}>
              <span className="text-text-disabled">{'{{'}</span>
              <input
                id="variable-key"
                value={key}
                onChange={e => { setKeyTouched(true); setKey(e.target.value); }}
                disabled={isEditing}
                placeholder="tone"
                aria-invalid={!!keyError || undefined}
                className="min-w-0 flex-1 bg-transparent py-2 text-text-secondary placeholder:text-text-subtle focus:outline-none disabled:cursor-not-allowed"
              />
              <span className="text-text-disabled">{'}}'}</span>
            </div>
            <span className={`mt-1 ${keyError ? 'text-xs font-semibold text-status-danger' : 'caption'}`}>
              {keyError || (isEditing ? "A saved tag can't change; profiles already use it." : 'Filled in from the name. Letters, numbers and _.')}
            </span>
          </div>
        </div>
        <TextInput label="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} placeholder="The voice every narrator profile writes in" />
        <Textarea
          label="Text"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="A dry, wry voice with short sentences."
          monospace
          className="min-h-[15rem]"
        />
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-2.5 border-t border-border-subtle px-6 py-3.5">
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={!canSave}>{isEditing ? 'Save variable' : 'Create variable'}</Button>
      </footer>
    </Modal>
  );
}
