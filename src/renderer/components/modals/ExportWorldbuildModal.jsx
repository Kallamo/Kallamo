import React, { useEffect, useState } from 'react';
import { Download, Eye, Globe } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { FileName, OptionRow, PackageColumns, ToneTile, TypeStrip, megabytes } from './ModalParts';

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
function describeRules(rules) {
  const progression = rules.progressionMode === 'levels'
    ? `levels with ${plural(rules.attributes, 'attribute', 'attributes')}`
    : null;
  return [plural(rules.resources, 'resource', 'resources'), progression, rules.skills ? plural(rules.skills, 'skill', 'skills') : null, plural(rules.timeRanges, 'time range', 'time ranges')].filter(Boolean).join(', ');
}

// Informs only; onConfirm opens the save dialog with the chosen options.
export default function ExportWorldbuildModal({ workspaceId, workspaceName = null, api, entityCount = 0, onClose, onConfirm }) {
  const [summary, setSummary] = useState(null);
  const [includeImages, setIncludeImages] = useState(true);
  const [includeCurrentValues, setIncludeCurrentValues] = useState(false);
  useEffect(() => {
    let active = true;
    api?.worldbuildExportSummary?.(workspaceId).then(result => { if (active && result?.success) setSummary(result); }).catch(() => {});
    return () => { active = false; };
  }, [api, workspaceId]);
  const count = summary?.entities ?? entityCount;
  const images = summary?.images || 0;
  const rules = summary?.rules || null;

  const imageLine = { key: 'images', label: `${plural(images, 'portrait or scene background', 'portraits and scene backgrounds')}` };
  const valuesLine = { key: 'values', label: "Each character's current HP, Mana, level and XP" };
  const inside = [
    { key: 'sheets', label: `${plural(count, 'sheet', 'sheets')}, with lore and data` },
    summary?.links ? { key: 'links', label: `${plural(summary.links, 'link', 'links')} between them` } : null,
    summary?.knowledge ? { key: 'knowledge', label: `${plural(summary.knowledge, 'Knowledge entry', 'Knowledge entries')} you wrote, with what each one may read` } : null,
    { key: 'calendar', label: summary?.calendarName ? <>The calendar, <b className="font-semibold text-text-primary">{summary.calendarName}</b></> : 'The calendar' },
    rules ? { key: 'rules', label: `Roleplay rules: ${describeRules(rules)}` } : null,
    images > 0 && includeImages ? imageLine : null,
    rules && includeCurrentValues ? valuesLine : null,
  ].filter(Boolean);
  const stays = [
    images > 0 && !includeImages ? imageLine : null,
    rules && !includeCurrentValues ? valuesLine : null,
    { key: 'facts', label: 'Facts and custom entity templates' },
    { key: 'chapters', label: 'Links to Writing Desk chapters' },
    { key: 'scene', label: 'The scene and Narrative State' },
    summary?.pendingReview ? { key: 'review', label: `${plural(summary.pendingReview, 'entity', 'entities')} waiting for review` } : null,
  ].filter(Boolean);

  return (
    <Modal
      onClose={onClose}
      size="wide"
      title="Export Worldbuild"
      subtitle={[workspaceName, plural(count, 'entity', 'entities')].filter(Boolean).join(' · ')}
      leading={<ToneTile icon={Globe} color="var(--theme-entity-location)" />}
      className="!max-w-[44rem] max-h-[86vh]"
    >
      <div className="custom-scrollbar min-h-0 space-y-3 overflow-y-auto p-5">
        <TypeStrip counts={summary?.typeCounts} />
        <PackageColumns inside={inside} stays={stays} />
        <div className="space-y-2">
          {images > 0 && (
            <OptionRow checked={includeImages} onChange={setIncludeImages} title="Include images" description={`${plural(images, 'image', 'images')}, ${megabytes(summary.imageBytes)}. Leave them out for a smaller file.`} />
          )}
          {rules && (
            <OptionRow checked={includeCurrentValues} onChange={setIncludeCurrentValues} title="Include each character's current values" description="HP, Mana, level, XP and attributes as they are now. Leave it off to share a fresh world; turn it on to hand over a campaign." />
          )}
        </div>
        <div className="flex items-center gap-2.5 rounded-control border px-3.5 py-2.5" style={{ background: 'color-mix(in srgb, var(--theme-status-warning) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--theme-status-warning) 24%, transparent)' }}>
          <Eye className="h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" />
          <p className="text-[0.8125rem] leading-relaxed text-text-secondary">Anyone with the file can read everything in it. Share it as you would share the story.</p>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border-subtle px-5 py-3.5">
        <FileName name="worldbuild.klwb" />
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button icon={Download} onClick={() => onConfirm({ includeImages: images > 0 && includeImages, includeCurrentValues: Boolean(rules) && includeCurrentValues })}>Export</Button>
      </div>
    </Modal>
  );
}
