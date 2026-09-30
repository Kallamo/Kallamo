import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { entityMeta } from './worldbuildConfig';
import { locationSizeLabel, locationSizeOf } from '../../../shared/location-sizes';

export default function EntityPickerButton({ label = 'Add', title, options, onPick, icon = Plus }) {
  const [isOpen, setOpen] = useState(false);
  const selectOptions = options.map((option) => {
    const metadata = option.type ? entityMeta(option) : null;
    return {
      id: option.id,
      label: option.canonicalName,
      aliases: Array.isArray(option.aliases)
        ? option.aliases
        : String(option.aliases || '').split(',').map(alias => alias.trim()).filter(Boolean),
      group: option.type === 'Locations' ? locationSizeLabel(locationSizeOf(option)) || metadata.label : metadata?.label,
      icon: metadata?.icon,
    };
  });

  return (
    <>
      <Button size="sm" variant="ghost" icon={icon} onClick={() => setOpen(true)}>{label}</Button>
      {isOpen ? (
        <Modal size="md" title={title || 'Choose'} icon={Search} iconClassName="text-text-muted" onClose={() => setOpen(false)}>
          <div className="p-4">
            {selectOptions.length ? (
              <SearchableSelect
                value=""
                onChange={(id) => { onPick(id); setOpen(false); }}
                options={selectOptions}
                placeholder="Search and choose…"
                searchPlaceholder="Search by name or alias…"
                clearable={false}
                autoOpen
                ariaLabel={title || 'Choose entity'}
              />
            ) : (
              <p className="rounded-control border border-dashed border-border-default px-4 py-6 text-center text-sm text-text-muted">Nothing to add. Create one first.</p>
            )}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
