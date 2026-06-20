import React, { useMemo, useState } from 'react';
import { FilePen } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';
import TextInput from './TextInput';

/**
 * Lets the user manually rename conflicting files before upload, then confirms
 * to proceed with vectorization. Each field is pre-filled with a suggested
 * unique name; live validation blocks empty names and collisions (against
 * existing sources and against the other entered names).
 *
 * Props:
 *  - files:         conflict file objects ({ name, ... })
 *  - existingNames: names already taken in the Knowledge Base
 *  - loading:       confirm button busy state
 *  - onCancel()     · onConfirm(renameMapping)  where map = { originalName: newName }
 */
function suggestUnique(originalName, takenLower) {
  const lastDot = originalName.lastIndexOf('.');
  const base = lastDot !== -1 ? originalName.slice(0, lastDot) : originalName;
  const ext = lastDot !== -1 ? originalName.slice(lastDot) : '';
  let candidate = originalName;
  let i = 2;
  while (takenLower.has(candidate.toLowerCase())) {
    candidate = `${base} (${i})${ext}`;
    i++;
  }
  return candidate;
}

export default function RenameFilesModal({
  files = [],
  existingNames = [],
  loading = false,
  onCancel,
  onConfirm,
}) {
  // Initial suggestions: each name unique against existing + previously suggested.
  const initial = useMemo(() => {
    const taken = new Set(existingNames.map(n => n.toLowerCase()));
    const map = {};
    for (const file of files) {
      const suggestion = suggestUnique(file.name, taken);
      map[file.name] = suggestion;
      taken.add(suggestion.toLowerCase());
    }
    return map;
  }, [files, existingNames]);

  const [names, setNames] = useState(initial);

  const existingLower = useMemo(
    () => new Set(existingNames.map(n => n.toLowerCase())),
    [existingNames]
  );

  const errors = useMemo(() => {
    const result = {};
    const seen = new Map(); // lowerName -> originalName that used it first
    for (const file of files) {
      const value = (names[file.name] || '').trim();
      const lower = value.toLowerCase();
      if (!value) {
        result[file.name] = 'Name cannot be empty.';
      } else if (existingLower.has(lower)) {
        result[file.name] = 'A file with this name already exists.';
      } else if (seen.has(lower)) {
        result[file.name] = 'Duplicate of another new name.';
      }
      if (!result[file.name]) seen.set(lower, file.name);
    }
    return result;
  }, [files, names, existingLower]);

  const hasErrors = Object.keys(errors).length > 0;

  const handleConfirm = () => {
    if (hasErrors) return;
    const mapping = {};
    for (const file of files) mapping[file.name] = names[file.name].trim();
    onConfirm?.(mapping);
  };

  return (
    <Modal onClose={onCancel} size="md" closeOnOverlay={!loading} closeOnEsc={!loading}>
      <div className="p-6 flex flex-col space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg shrink-0 bg-accent/10 text-accent">
            <FilePen className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Rename Files</h3>
        </div>

        <p className="text-xs text-gray-400 leading-relaxed">
          Give each file a new name to keep it alongside the existing one. The file is
          vectorized after you confirm.
        </p>

        <div className="flex flex-col gap-3 max-h-[320px] overflow-y-auto custom-scrollbar pr-1">
          {files.map((file) => (
            <div key={file.name} className="flex flex-col gap-1">
              <span className="text-[10px] font-mono text-gray-500 truncate" title={file.name}>
                {file.name}
              </span>
              <TextInput
                value={names[file.name] || ''}
                onChange={(e) => setNames(prev => ({ ...prev, [file.name]: e.target.value }))}
                error={errors[file.name]}
                disabled={loading}
                autoFocus={files[0]?.name === file.name}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-3 pt-1">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button variant="primary" onClick={handleConfirm} loading={loading} disabled={hasErrors}>
            Rename &amp; Vectorize
          </Button>
        </div>
      </div>
    </Modal>
  );
}
