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
  const [includeChapters, setIncludeChapters] = useState(true);
  useEffect(() => {
    let active = true;
    api?.worldbuildExportSummary?.(workspaceId).then(result => { if (active && result?.success) setSummary(result); }).catch(() => {});
    return () => { active = false; };
  }, [api, workspaceId]);
  const count = summary?.entities ?? entityCount;
  const images = summary?.images || 0;
  const chapters = summary?.chapters || 0;
  const rules = summary?.rules || null;
  const line = (key, show, label) => (show ? { key, label } : null);

  const imageLine = { key: 'images', label: plural(images, 'portrait or scene background', 'portraits and scene backgrounds') };
  const valuesLine = { key: 'values', label: "Each character's current HP, Mana, level and XP" };
  const chaptersLine = { key: 'chapters', label: `${plural(chapters, 'background chapter', 'background chapters')} from the Writing Desk` };
  const placement = [summary?.equipped ? plural(summary.equipped, 'item worn', 'items worn') : null, summary?.placed ? plural(summary.placed, 'item lying in a place', 'items lying in places') : null].filter(Boolean).join(' and ');
  const inside = [
    { key: 'sheets', label: `${plural(count, 'sheet', 'sheets')}, with lore, data and what each one hides from readers` },
    line('links', summary?.links, `${plural(summary?.links || 0, 'link', 'links')} between them: relationships, memberships, inventories and places`),
    { key: 'calendar', label: summary?.calendarName ? <>The calendar, <b className="font-semibold text-text-primary">{summary.calendarName}</b></> : 'The calendar' },
    line('rules', rules, rules ? `Roleplay rules: ${describeRules(rules)}` : ''),
    line('templates', summary?.templates || summary?.fields, `${plural(summary?.templates || 0, 'entity template', 'entity templates')} with ${plural(summary?.fields || 0, 'custom field', 'custom fields')}`),
    line('knowledge', summary?.knowledge, `${plural(summary?.knowledge || 0, 'Knowledge entry', 'Knowledge entries')} you wrote, with what each one may read`),
    line('facts', summary?.facts, `${plural(summary?.facts || 0, 'Fact', 'Facts')} you wrote about the world`),
    line('occurrences', summary?.occurrences, `${plural(summary?.occurrences || 0, 'event occurrence', 'event occurrences')} you recorded, with the memories they give`),
    line('texts', summary?.texts, `${plural(summary?.texts || 0, 'page', 'pages')} written inside items`),
    line('placement', placement, placement),
    chapters > 0 && includeChapters ? chaptersLine : null,
    images > 0 && includeImages ? imageLine : null,
    rules && includeCurrentValues ? valuesLine : null,
  ].filter(Boolean);
  const stays = [
    chapters > 0 && !includeChapters ? chaptersLine : null,
    images > 0 && !includeImages ? imageLine : null,
    rules && !includeCurrentValues ? valuesLine : null,
    { key: 'play', label: 'The story as played: the scene, the clock and what the Narrative State recorded' },
    { key: 'chat', label: 'Chats, memory, profiles and the other Writing Desk chapters' },
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
          {chapters > 0 && (
            <OptionRow checked={includeChapters} onChange={setIncludeChapters} title="Include background chapters" description={`${plural(chapters, 'chapter', 'chapters')} that sheets use as their background. They land in a Background chapters folder.`} />
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
        <Button icon={Download} onClick={() => onConfirm({ includeImages: images > 0 && includeImages, includeCurrentValues: Boolean(rules) && includeCurrentValues, includeChapters: chapters > 0 && includeChapters })}>Export</Button>
      </div>
    </Modal>
  );
}
