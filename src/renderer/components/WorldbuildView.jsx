import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Search, BookOpen, Package, Users, EyeOff, 
  Trash2, Save, X, Pencil, Check, Link2, Globe, Tag, ScrollText, Info, Replace,
  RefreshCw, Upload, Download, ChevronRight, ChevronDown, MoreHorizontal, ListChecks, Loader2, Gem, 
  NotebookText, Backpack, Braces, AlertTriangle, LayoutTemplate, BookCheck, CircleHelp, ChevronLeft, UserMinus, Undo2, Crown, AlignLeft, CalendarDays, CalendarRange, Drama, GripVertical, Gamepad2, IdCard, Landmark, Scale, Lightbulb, ListTree, LogOut, MapPinned, Merge, PencilLine, ScanEye, ScanFace, Shield, UserRound, ImagePlus, Image as ImageIcon, Crop, Flag, MapPin, ChevronsDownUp, ChevronsUpDown,
} from 'lucide-react';
import { AiGlyph, PolicyOpenGlyph, PolicyReviewGlyph, PolicyLockedGlyph, KnowledgeGlyph, ConnectionsGlyph, OccurrencesGlyph } from './ui/glyphs';
import { useApp } from '../context/AppContext';
import Button from './ui/Button';
import NumberInput from './ui/NumberInput';
import Checkbox from './ui/Checkbox';
import Popover from './ui/Popover';
import Menu, { MenuItem, MenuLabel, MenuSeparator } from './ui/Menu';
import IconButton from './ui/IconButton';
import Tooltip from './ui/Tooltip';
import WorldSelectionBar from '../features/worldbuild/WorldSelectionBar';
import WorldUpdateStatus from '../features/worldbuild/WorldUpdateStatus';
import WorldOverview from '../features/worldbuild/WorldOverview';
import WorldbuildMergeDialog from '../features/worldbuild/WorldbuildMergeDialog';
import { worldbuildViewCache } from '../features/worldbuild/worldbuildViewCache';
import WorldbuildImageDialog from '../features/worldbuild/WorldbuildImageDialog';
import { framedImageStyle, loadPortraits, usePortraits } from '../features/worldbuild/portraits';
import SearchableSelect from './ui/SearchableSelect';
import ConfirmDialog from './ui/ConfirmDialog';
import ExportWorldbuildModal from './modals/ExportWorldbuildModal';
import ImportWorldbuildModal, { ImportWorldbuildDone } from '../features/worldbuild/ImportWorldbuildModal';
import { buildLocationTree } from '../features/worldbuild/locationTree';
import EntityPickerButton from '../features/worldbuild/EntityPickerButton';
import { useSidebarWidth } from '../features/worldbuild/useSidebarWidth';
import { useWorldbuildNavigationState } from '../features/worldbuild/useWorldbuildNavigationState';
import { useScrollRestore } from '../features/worldbuild/useScrollRestore';
import WorldbuildCustomFields, { fieldsForSection, isFilledValue, isLongField } from '../features/worldbuild/WorldbuildCustomFields';
import WorldbuildKnowledgeTab from '../features/worldbuild/WorldbuildKnowledgeTab';
import WorldbuildNarrativeReview from '../features/worldbuild/WorldbuildNarrativeReview';
import WorldbuildFactsRegistry from '../features/worldbuild/WorldbuildFactsRegistry';
import WorldbuildCalendar from '../features/worldbuild/WorldbuildCalendar';
import WorldbuildRules from '../features/worldbuild/WorldbuildRules';
import WorldbuildEventOccurrences from '../features/worldbuild/WorldbuildEventOccurrences';
import WorldDateInput, { formatWorldDate } from '../features/worldbuild/WorldDateInput';
import { WorldbuildInventory, WorldbuildRelationships } from '../features/worldbuild/WorldbuildAgentCollections';
import WorldbuildTemplateManager from '../features/worldbuild/WorldbuildTemplateManager';
import WorldbuildRoleplayResources, { RaceRoleplayDefaults } from '../features/worldbuild/WorldbuildRoleplayResources';
import WorldbuildEntitySkills from '../features/worldbuild/WorldbuildEntitySkills';
import { describeSkillChange, skillChangeItems } from '../features/roleplay/changeKinds';
import { displayNativeValue, displayProposalValue } from '../features/worldbuild/reviewDisplay';
import {
  ABUNDANCE_HELP, CREATURE_NATURES, DISPOSITION, entityMeta, fieldLabel, ITEM_TYPES, itemMeta, meta, TYPES,
  RARITY, RELATIONSHIP_LABELS, STATUS, THREAT, TYPE_ORDER, LOCATION_SIZE_OPTIONS, locationSizeIcon, sortLocationsForPresence,
} from '../features/worldbuild/worldbuildConfig';
import { isInvertedNesting, locationSizeGuide, locationSizeLabel, locationSizeOf, locationSizeRank } from '../../shared/location-sizes';
import SegmentedControl from './ui/SegmentedControl';
import SelectMenu from './ui/SelectMenu';
import { normalizeTemplateSections, sheetTabs as sheetTabsFor, tabLabel } from '../features/worldbuild/worldbuildSections';
import { FieldEye, SpoilerCover, SpoilerRow, SpoilerScope, SpoilerText, SpoilerTextArea } from '../features/worldbuild/Spoilers';
import { hiddenFields, withFieldHidden } from '../../shared/spoilers';

// Frosted dark inputs: their own dark backing guarantees legible text over BOTH
// light and dark workspace backgrounds, while the blur keeps the background alive.
const FIELD = 'wb-input min-h-10 w-full bg-surface-input/90 backdrop-blur-md border border-border-default text-text-primary text-sm rounded-control px-3 py-2 placeholder:text-text-subtle focus:outline-none focus:border-accent/70 focus:ring-2 focus:ring-accent/20 transition-colors';
const LInput = (p) => <input {...p} className={`${FIELD} ${p.className || ''}`} />;
const LTextarea = (p) => <textarea {...p} className={`${FIELD} resize-none leading-relaxed custom-scrollbar ${p.className || ''}`} />;

// Why the name review flagged an entity, as shown on its sheet and in the sidebar tooltip.
const NAME_REVIEW_TEXT = {
  'common-word': () => 'Looks like a common word rather than a name, so it can tag ordinary text.',
  number: () => 'Has no letters, so it cannot be found in the story by name.',
  fragment: (reason) => `Appears almost only inside “${reason.relatedName}”. It may be a piece of that name; merging keeps it as an alias.`,
  duplicate: (reason) => `This may be the same as ${reason.relatedName}`,
};
// Story state a delete lets go of: narrative records are retired, cards and scene entries removed.
const describeStoryImpact = (summary) => {
  const parts = [
    summary?.narrativeRecords ? `${summary.narrativeRecords} Narrative State records` : '',
    summary?.knowledgeCards ? `${summary.knowledgeCards} Knowledge cards` : '',
    summary?.sceneState ? `${summary.sceneState} scene and equipment entries` : '',
  ].filter(Boolean);
  return parts.length ? ` Roleplay state stops using them: ${parts.join(', ')}.` : '';
};

// A known life status reads in its own colour on the list; an unknown one shows nothing.
const STATUS_TONE = { alive: 'text-status-success/85', missing: 'text-status-warning/85', deceased: 'text-status-danger/85' };
const REVIEW_FILTERS ={ proposed: 'Proposed by the AI', updates: 'With suggested updates', names: 'Names to check' };

const describeNameReview = (reason) => (NAME_REVIEW_TEXT[reason?.code] || (() => 'Worth a second look.'))(reason);

const matchesReviewFilter = (entity, filter, { nameReview, reviewCounts }) => {
  if (filter === 'proposed') return entity.status === 'proposed';
  if (filter === 'updates') {
    const counts = reviewCounts[entity.id];
    return entity.status !== 'proposed' && ((counts?.entityUpdates || 0) > 0 || (counts?.narrative || 0) > 0);
  }
  if (filter === 'names') return nameReview.has(entity.id);
  return true;
};

// A state read as a dot and a word (life status, disposition). `map` is STATUS or DISPOSITION.
const StateTag = ({ map, value }) => {
  const s = map[value]; if (!s) return null;
  return <span className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary"><span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />{s.label}</span>;
};

const EvidenceReferences = ({ excerpts, support = '', label }) => {
  const [open, setOpen] = useState(false);
  const references = excerpts.filter(Boolean);
  if (!references.length && !support) return null;
  return (
    <div className="mt-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="inline-flex items-center gap-1 rounded text-xs font-medium text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        {open ? 'Hide passages' : label || (references.length ? `From the story, ${references.length} ${references.length === 1 ? 'passage' : 'passages'}` : 'Why')}
      </button>
      {open && <div className="mt-2 max-h-56 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
        {support && <p className="caption">{support}</p>}
        {references.map((excerpt, index) => <p key={index} className="caption border-l-2 border-border-default pl-2.5">“{excerpt}”</p>)}
      </div>}
    </div>
  );
};

// Systematic sheet tabs carry their own icon; template-driven sections do not.
const SheetTabIcon = {
  data: NotebookText, inventory: Backpack, connections: ConnectionsGlyph,
  knowledge: KnowledgeGlyph, occurrences: OccurrencesGlyph, review: AiGlyph,
};

const AI_POLICY = {
  open:   { label: 'Open',   icon: PolicyOpenGlyph,   tip: 'Writes changes from the story straight into this sheet.' },
  review: { label: 'Review', icon: PolicyReviewGlyph, tip: 'Suggests changes. You accept or reject each one.' },
  locked: { label: 'Locked', icon: PolicyLockedGlyph, tip: 'Reads this sheet, never changes it.' },
};
// One named button instead of three near-identical icons: the choice is read, not decoded.
const AiPolicyControl = ({ value, onChange, className = '' }) => {
  const cur = AI_POLICY[value] ? value : 'review';
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const Icon = AI_POLICY[cur].icon;
  return (
    <>
      <button ref={anchorRef} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control border border-border-default bg-surface-canvas/60 px-2.5 backdrop-blur-sm text-xs font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${className}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" /><span className="text-text-subtle">AI</span>{AI_POLICY[cur].label}<ChevronDown className="h-3.5 w-3.5 text-text-subtle" aria-hidden="true" />
      </button>
      <Menu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="AI policy" className="w-72">
        <MenuLabel>What the AI may do here</MenuLabel>
        {Object.entries(AI_POLICY).map(([key, policy]) => (
          <MenuItem key={key} icon={policy.icon} label={policy.label} description={policy.tip} checked={key === cur}
            onSelect={() => { setOpen(false); if (key !== cur) onChange(key); }} />
        ))}
      </Menu>
    </>
  );
};

const StateSelect = ({ map, value, onChange, label }) => (
  <SelectMenu ariaLabel={label} value={value || 'unknown'} onChange={(next) => onChange({ target: { value: next } })}
    options={Object.entries(map).map(([k, v]) => ({ value: k, label: v.label }))} />
);
const ChoiceSelect = ({ value, onChange, options, label, empty = 'Not set' }) => (
  <SelectMenu ariaLabel={label} value={value || ''} onChange={(next) => onChange({ target: { value: next } })}
    options={[{ value: '', label: empty }, ...options.map(option => ({ value: option, label: option }))]} />
);

// No native datalist: its popup can't be themed. onChange receives an event-like object.
const FreeDatalist = ({ value, onChange, options, placeholder }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const opts = [...new Set(options.filter(Boolean))];
  const q = (value || '').toLowerCase();
  const filtered = opts.filter(o => o.toLowerCase().includes(q));
  return (
    <div className="relative" ref={wrapRef}>
      <LInput placeholder={placeholder} value={value || ''} onFocus={() => setOpen(true)} onChange={(e) => { onChange(e); setOpen(true); }} />
      <Popover anchorRef={wrapRef} open={open && filtered.length > 0} onClose={() => setOpen(false)} maxHeight={176} scroll={false} className="border-border-default bg-surface-panel-muted p-1">
        <div className="max-h-44 overflow-y-auto custom-scrollbar">
          {filtered.map(o => (
            <button key={o} type="button" onMouseDown={(e) => { e.preventDefault(); onChange({ target: { value: o } }); setOpen(false); }}
              className="w-full rounded-md px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-accent/15 hover:text-text-primary">{o}</button>
          ))}
        </div>
      </Popover>
    </div>
  );
};

// A small "?" that reveals a themed legend on hover, matching the app's tooltips.
const InfoPopover = ({ items }) => {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  return (
    <span ref={anchorRef} className="relative inline-flex align-middle" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <Info className="w-3 h-3 text-text-subtle hover:text-accent cursor-help" />
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} matchAnchorWidth={false} scroll={false} className="w-60 border-border-default bg-surface-panel-muted p-3 normal-case tracking-normal">
        <div className="space-y-1.5">
          {items.map(([k, v]) => <div key={k} className="text-xs leading-snug"><span className="font-semibold text-text-primary">{k}</span> <span className="text-text-muted">{v}</span></div>)}
        </div>
      </Popover>
    </span>
  );
};

const FieldLabel = ({ children }) => <label className="mb-1.5 block text-xs font-medium text-text-muted">{children}</label>;
const Hint = ({ children }) => <span className="caption mt-1 block">{children}</span>;
// `spoiler` names the field the eye hides from readers; a hidden one stays closed until clicked.
const Edit = ({ label, hint, spoiler, children }) => (
  <div>
    {spoiler
      ? <div className="mb-1.5 flex items-center gap-1"><label className="block text-xs font-medium text-text-muted">{label}</label><FieldEye field={spoiler} /></div>
      : label && <FieldLabel>{label}</FieldLabel>}
    {spoiler ? <SpoilerCover field={spoiler}>{children}</SpoilerCover> : children}
    {hint && <Hint>{hint}</Hint>}
  </div>
);

// Read-only field in the rendered sheet. `value` may be a node (a state tag, a chip
// row) as well as text; `full` spans the whole row of the surrounding FactGrid.
const ViewField = ({ label, value, empty = 'Not set', full = false, spoiler }) => (
  <div className={full ? 'col-span-full min-w-0' : 'min-w-0'}>
    <div className="mb-1 text-xs font-medium text-text-muted">{label}</div>
    {value === null || value === undefined || value === ''
      ? <div className="text-sm text-text-disabled">{empty}</div>
      : <SpoilerCover field={spoiler}>{typeof value === 'object' ? value : <div className="text-sm text-text-primary whitespace-pre-wrap break-words leading-relaxed"><SpoilerText text={value} /></div>}</SpoilerCover>}
  </div>
);

// The short facts of a section, read across before the prose that follows them.
const FactGrid = ({ children, columns = 3 }) => (
  <div className={`grid gap-x-5 gap-y-4 ${columns === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3'}`}>{children}</div>
);

// Long text folds after a few lines, so a sheet reads as a sheet and not as one essay.
const Prose = ({ text, empty = 'Not written yet', clamp = true, spoiler }) => {
  const [open, setOpen] = useState(false);
  const value = String(text || '').trim();
  if (!value) return <p className="text-sm text-text-disabled">{empty}</p>;
  const long = clamp && (value.length > 520 || value.split('\n').length > 6);
  return (
    <SpoilerCover field={spoiler}><div>
      <p className={`text-sm leading-relaxed text-text-secondary whitespace-pre-wrap ${long && !open ? 'line-clamp-5' : ''}`}><SpoilerText text={value} /></p>
      {long && <button type="button" onClick={() => setOpen(v => !v)} className="mt-2 inline-flex items-center gap-1 rounded text-xs font-semibold text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        {open ? 'Show less' : 'Show all'}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>}
    </div></SpoilerCover>
  );
};

// How a recurring event is spoken of: "Every 2 years since 5 Frostmoon 1204".
const recurrenceText = (recurrence, calendar) => {
  if (!recurrence?.anchorDate) return null;
  const interval = Math.max(1, Number(recurrence.interval) || 1);
  const unit = recurrence.unit || 'year';
  return `${interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`} since ${formatWorldDate(calendar, recurrence.anchorDate)}`;
};

const LongField = ({ label, text, empty = 'Not set', spoiler }) => (
  <div className="border-t border-border-subtle pt-4">
    <div className="mb-1.5 text-xs font-medium text-text-muted">{label}</div>
    <Prose text={text} empty={empty} spoiler={spoiler} />
  </div>
);

// Template cells join the section's own grid, so where a field came from never shows.
// The first FactGrid in the view takes them; the caller falls back to a grid of its own.
function injectIntoGrid(view, cells) {
  let placed = false;
  const visit = (node, depth) => {
    if (placed || depth > 3 || !React.isValidElement(node)) return node;
    if (node.type === FactGrid) { placed = true; return React.cloneElement(node, {}, node.props.children, cells); }
    if (node.props?.children == null) return node;
    const children = React.Children.map(node.props.children, child => visit(child, depth + 1));
    return placed ? React.cloneElement(node, {}, children) : node;
  };
  const out = visit(view, 0);
  return [out, placed];
}

// Warns without blocking: some fiction nests a world inside a bottle on purpose.
function NestingWarning({ size, parent }) {
  const parentSize = locationSizeOf(parent);
  if (!parent || !isInvertedNesting(size, parentSize)) return null;
  return (
    <p className="flex items-start gap-2 rounded-control border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs leading-relaxed text-status-warning">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>This {locationSizeLabel(size).toLowerCase()} sits inside {parent.canonicalName}, which is a {locationSizeLabel(parentSize).toLowerCase()}. A container is usually larger than what it holds.</span>
    </p>
  );
}

const LocationSizeValue = ({ size }) => {
  if (!size) return null;
  const Icon = locationSizeIcon(size);
  return <div className="inline-flex items-center gap-1.5 text-sm font-medium text-text-primary"><Icon className="h-3.5 w-3.5 text-entity-location" aria-hidden="true" />{locationSizeLabel(size)}</div>;
};

const Chip = ({ children }) => (
  <span className="inline-flex min-h-6 items-center gap-1 rounded-full border border-border-subtle bg-surface-hover/35 px-2.5 py-0.5 text-xs font-medium text-text-secondary">{children}</span>
);

// A sheet section: titled card with one Edit for everything inside, template fields
// included. `empty` folds an unwritten section to one line that keeps its place.
function Section({ icon, title, count, editing, onEdit, showPencil, right, empty = false, emptyVerb = 'Write', emptyNote = 'Not written yet', quiet = false, children }) {
  const Icon = icon || BookOpen;
  if (empty && !editing) {
    return (
      <section className="flex min-h-12 items-center gap-2.5 rounded-card border border-border-subtle bg-surface-panel-muted/45 py-1.5 pl-4 pr-2 backdrop-blur-md">
        <Icon className="h-4 w-4 shrink-0 text-text-disabled" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-text-secondary">{title}</h2>
        <span className="min-w-0 flex-1 truncate text-sm text-text-disabled">{emptyNote}</span>
        {right}
        {showPencil && <button type="button" onClick={onEdit} aria-label={`${emptyVerb} ${title}`}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />{emptyVerb}
        </button>}
      </section>
    );
  }
  return (
    <section className="ws-card rounded-card border border-border-default bg-surface-panel-muted/60 backdrop-blur-md overflow-hidden">
      <header className={`flex min-h-11 items-center gap-2.5 pl-4 pr-2 ${quiet ? 'pt-1.5' : 'border-b border-border-subtle'}`}>
        {!quiet && <Icon className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />}
        <h2 className={`min-w-0 truncate ${quiet ? 'text-xs font-medium text-text-subtle' : 'text-sm font-semibold text-text-primary'}`}>{title}</h2>
        {count != null && <span className="text-xs tabular-nums text-text-subtle">{count}</span>}
        {editing && <span className="text-xs text-text-subtle">Editing</span>}
        <span className="flex-1" />
        {right}
        {showPencil && !editing && (
          <button type="button" onClick={onEdit} aria-label={`Edit ${title || 'section'}`}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit
          </button>
        )}
      </header>
      <div className={`space-y-4 px-4 ${quiet ? 'pb-4 pt-1' : 'py-4'}`}>{children}</div>
    </section>
  );
}

// An AI note about the whole sheet, above its header, with its actions in reach.
function SheetNotice({ icon: Icon, title, text, busy = false, children }) {
  return (
    <div className={`flex gap-3 rounded-card border px-4 py-3.5 backdrop-blur-md ${busy ? 'border-border-default bg-surface-panel-muted/70' : 'border-status-warning/30 bg-status-warning/[0.07]'}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${busy ? 'animate-spin text-accent' : 'text-status-warning'}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary">{title}</p>
        {text && <p className="caption mt-0.5 text-text-muted">{text}</p>}
        {children && <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}

// The sheet's own actions. Delete lives here, never at the foot of every tab.
function SheetActionsMenu({ onPortrait, hasPortrait, onEditName, onMerge, onReprocess, onDelete }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const run = (action) => () => { setOpen(false); action(); };
  return (
    <>
      <IconButton ref={anchorRef} icon={MoreHorizontal} label="Sheet actions" size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)} />
      <Menu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="Sheet actions" className="w-64">
        <MenuItem icon={PencilLine} label="Edit name and aliases" onSelect={run(onEditName)} />
        {onPortrait && <MenuItem icon={ImagePlus} label={hasPortrait ? 'Change portrait' : 'Add portrait'} description="Also shown beside them in roleplay." onSelect={run(onPortrait)} />}
        <MenuItem icon={Merge} label="Merge into another entity" description="Keeps this name as an alias." onSelect={run(onMerge)} />
        {onReprocess && <MenuItem icon={RefreshCw} label="Read the story again" description="The next update rereads its passages." onSelect={run(onReprocess)} />}
        <MenuSeparator />
        <MenuItem icon={Trash2} label="Delete entity" danger onSelect={run(onDelete)} />
      </Menu>
    </>
  );
}

// Portraits belong to someone who can stand in a scene: a character or a single creature.
const canHavePortrait = (entity) => entity?.type === 'Characters' || (entity?.type === 'Creatures' && (entity.data?.scope || 'individual') !== 'group');

function SheetMedallion({ meta, portrait, onPortrait }) {
  const style = framedImageStyle(portrait);
  const label = portrait ? 'Change portrait' : 'Add portrait';
  // A portrait is the sheet's face, so it is shown large; the type icon keeps its usual size.
  const tile = style
    ? <span role="img" aria-label="Portrait" className="block h-[6.5rem] w-[6.5rem] shrink-0 rounded-card border border-border-default" style={style} />
    : <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-card border ${meta.medallion}`}>{React.createElement(meta.icon, { className: 'h-7 w-7' })}</span>;
  if (!onPortrait) return tile;
  return (
    <div className="group relative shrink-0">
      {tile}
      <button type="button" onClick={onPortrait} aria-label={label} data-tooltip={label}
        className={`absolute flex items-center justify-center rounded-full border border-border-default bg-surface-panel text-text-secondary shadow-sm transition-opacity hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${portrait ? '-bottom-2 -right-2 h-8 w-8' : '-bottom-1.5 -right-1.5 h-6 w-6 opacity-0 group-hover:opacity-100'}`}>
        {portrait ? <PencilLine className="h-3.5 w-3.5" aria-hidden="true" /> : <ImagePlus className="h-3 w-3" aria-hidden="true" />}
      </button>
    </div>
  );
}

// The scene background a place shows in roleplay. A place without its own inherits the
// one of the place it sits in, and only its own image can be framed or removed.
function LocationCoverMenu({ cover, childNames = [], parentName, onChoose, onFrame, onRemove }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const run = (action) => () => { setOpen(false); action(); };
  const own = !!cover && !cover.inherited;
  const buttonClass = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control border border-border-default bg-surface-canvas/60 px-2.5 backdrop-blur-sm text-xs font-semibold text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';
  if (!cover) {
    return <button type="button" onClick={onChoose} className={buttonClass}><ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Add background</button>;
  }
  return (
    <>
      <button ref={anchorRef} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)} className={buttonClass}>
        <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Background<ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-subtle" aria-hidden="true" />
      </button>
      <Menu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="Scene background" className="w-80">
        <MenuItem icon={Upload} label={own ? 'Choose another image' : 'Choose its own image'} description="PNG, JPG or WebP." onSelect={run(onChoose)} />
        {own && <MenuItem icon={Crop} label="Adjust the framing" description="Where the header crops it." onSelect={run(onFrame)} />}
        {own && childNames.length > 0 && <>
          <MenuSeparator />
          <p className="px-2.5 py-1.5 text-xs leading-relaxed text-text-muted">Places inside it without their own image use this one too: <span className="text-text-secondary">{childNames.join(', ')}</span>.</p>
        </>}
        {own && <>
          <MenuSeparator />
          <MenuItem icon={Trash2} label="Remove background" danger description={parentName ? `The scene falls back to ${parentName}.` : 'Roleplay shows no background here.'} onSelect={run(onRemove)} />
        </>}
      </Menu>
    </>
  );
}

// Other names as chips. The sheet still stores them as one comma-separated string.
function AliasInput({ value, onChange, placeholder, withEyes = false }) {
  const [draft, setDraft] = useState('');
  const names = String(value || '').split(',').map(name => name.trim()).filter(Boolean);
  const commit = (list) => onChange(list.join(', '));
  const add = () => {
    const extra = draft.split(',').map(name => name.trim()).filter(Boolean).filter(name => !names.includes(name));
    if (extra.length) commit([...names, ...extra]);
    setDraft('');
  };
  return (
    <div className="wb-input flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-control border border-border-default bg-surface-input/90 px-2 py-1.5 backdrop-blur-md focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-accent/20">
      {names.map(name => (
        <span key={name} className="inline-flex min-h-6 items-center gap-1 rounded-full border border-border-subtle bg-surface-hover/35 py-0.5 pl-2.5 pr-1 text-xs font-medium text-text-secondary">
          {withEyes ? <SpoilerCover field={`alias:${name}`} compact>{name}</SpoilerCover> : name}
          {withEyes && <FieldEye field={`alias:${name}`} size="sm" />}
          <button type="button" aria-label={`Remove ${name}`} onClick={() => commit(names.filter(item => item !== name))} className="rounded p-0.5 text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><X className="h-3 w-3" /></button>
        </span>
      ))}
      <input value={draft} aria-label="Add another name" placeholder={names.length ? 'Type and press Enter' : placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add(); }
          else if (event.key === 'Backspace' && !draft && names.length) commit(names.slice(0, -1));
        }}
        onBlur={add}
        className="min-w-32 flex-1 bg-transparent px-1 text-sm text-text-primary placeholder:text-text-subtle focus:outline-none" />
    </div>
  );
}

const draftFor = (type, data = {}) => ({ id: null, type, canonicalName: '', aliases: '', lore: '', loreDocumentId: '', status: 'confirmed', data });

// Links need a saved entity id, so these render nothing before the first save.
function SingleRelation({ label, hint, current, options, onSet, disabled, spoiler }) {
  if (disabled) return null;
  const currentName = options.find(o => o.id === current)?.canonicalName;
  return (
    <Edit label={label} hint={hint} spoiler={spoiler}>
      <div className="flex items-center gap-2 flex-wrap">
        {currentName
          ? <div className="inline-flex min-h-9 items-center gap-2 rounded-control border border-border-default bg-surface-input/70 pl-3 pr-1.5 text-sm font-medium text-text-primary">
              <span>{currentName}</span>
              <button type="button" aria-label={`Clear ${label}`} onClick={() => onSet(null)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-status-danger/10 hover:text-status-danger"><X className="w-3.5 h-3.5" /></button>
            </div>
          : <span className="inline-flex min-h-9 items-center rounded-control border border-dashed border-border-default px-3 text-sm text-text-subtle">None set</span>}
        <EntityPickerButton icon={currentName ? Replace : Plus} label={currentName ? 'Change' : 'Set'} title={label} options={options} onPick={(id) => onSet(id)} />
      </div>
    </Edit>
  );
}
function MultiRelation({ label, hint, links, options, onAdd, onRemove, disabled, spoiler }) {
  if (disabled) return null;
  const linked = new Set(links.map(l => l.entity.id));
  const remaining = options.filter(o => !linked.has(o.id));
  return (
    <Edit label={label} hint={hint} spoiler={spoiler}>
      <div className="flex flex-wrap items-center gap-1.5">
        {links.map(l => (
          <span key={l.linkId} className="inline-flex min-h-6 items-center gap-1.5 text-xs font-medium text-text-primary bg-surface-hover/65 border border-border-default rounded-full pl-2.5 pr-1 py-0.5">
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta(l.entity.type).dot || 'bg-text-subtle'}`} /><SpoilerCover field={`link:${l.linkId}`} compact>{l.entity.canonicalName}</SpoilerCover>
            <FieldEye field={`link:${l.linkId}`} size="sm" />
            <button type="button" onClick={() => onRemove(l.linkId)} aria-label={`Remove ${l.entity.canonicalName}`} className="text-text-muted hover:text-status-danger cursor-pointer p-0.5"><X className="w-3 h-3" /></button>
          </span>
        ))}
        <EntityPickerButton title={label} options={remaining} onPick={onAdd} />
      </div>
    </Edit>
  );
}

// Character↔character relationships are directional. Outgoing edges can be edited
// from the open sheet's point of view; incoming edges are shown as the other
// character's perspective and remain read-only here.
function LabeledRelation({ subjectName, links, options, priorLabels, onAdd, onRemove, disabled }) {
  const [toId, setToId] = useState('');
  const [role, setRole] = useState('');
  if (disabled) return null;
  const who = subjectName?.trim() ? subjectName.trim() : 'this character';
  const linked = new Set((links || []).map(l => l.entity.id));
  const remaining = options.filter(o => !linked.has(o.id));
  const suggestions = [...new Set([...RELATIONSHIP_LABELS, ...priorLabels])];
  const pickedName = options.find(o => o.id === toId)?.canonicalName;
  const submit = () => { if (!toId) return; onAdd(toId, role.trim()); setToId(''); setRole(''); };
  return (
    <Edit label="Relationships">
      <Hint>Pick a character and say what they are to {who}. For example, choose "John" and type "father" to record that John is {who}'s father.</Hint>
      <div className="flex flex-wrap gap-1.5 my-2">
        {(!links || links.length === 0) && <span className="caption">None yet.</span>}
        {(links || []).map(l => (
          <span key={l.linkId} className="inline-flex min-h-6 items-center gap-1 text-xs font-medium text-text-primary bg-surface-hover/65 border border-border-default rounded-full pl-2.5 pr-1 py-0.5">
            <span className="text-text-muted">{l.label || 'related'}</span> · {l.entity.canonicalName}
            <button type="button" onClick={() => onRemove(l.linkId)} aria-label={`Remove ${l.entity.canonicalName}`} className="text-text-muted hover:text-status-danger cursor-pointer p-0.5"><X className="w-3 h-3" /></button>
          </span>
        ))}
      </div>
      {remaining.length === 0
        ? <span className="caption">Everyone is already linked.</span>
        : toId
          ? <div className="flex items-center gap-1.5">
              <span className="caption shrink-0"><span className="text-text-secondary font-medium">{pickedName}</span> is {who}'s</span>
              <div className="flex-1"><FreeDatalist value={role} onChange={(e) => setRole(e.target.value)} options={suggestions} placeholder="e.g. father, rival, mentor (optional)" /></div>
              <Button size="sm" icon={Check} onClick={submit}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => { setToId(''); setRole(''); }}>Cancel</Button>
            </div>
          : <EntityPickerButton label="Add relationship" title="Choose a character" options={remaining} onPick={(id) => setToId(id)} />}
    </Edit>
  );
}

// A membership badge: leader, founder. Small enough to sit beside a name.
const MemberFlag = ({ icon: Icon, label, tone }) => (
  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-semibold ${tone}`}>
    <Icon className="h-3 w-3" />{label}
  </span>
);

// One line of a faction roster, past or present: name on the left, rank on the right,
// and the dates of the tenure underneath. The same row serves both lists so a departure
// changes only the wording, never the shape of what you are reading.
function MemberRow({ link, calendar, kind, isLeader, editing, onOpen, onSetRole, onSetMeta, onSetFormer, onRestore, onRemove }) {
  const [role, setRole] = useState(link.label || '');
  const [datesOpen, setDatesOpen] = useState(false);
  useEffect(() => { setRole(link.label || ''); }, [link.label]);
  const meta = link.metadata || {};
  const isFormer = kind === 'former';
  const commitRole = () => { if ((role.trim() || '') !== (link.label || '')) onSetRole(link, role.trim()); };
  const rank = link.label || (isFormer ? 'former member' : '');
  const joined = formatWorldDate(calendar, meta.joined);
  const left = formatWorldDate(calendar, meta.left);
  const leaderSince = formatWorldDate(calendar, meta.leaderSince);
  const tenure = [
    joined && (left ? `${joined} to ${left}` : `Joined ${joined}`),
    !joined && left && `Left ${left}`,
    isLeader && leaderSince && `Leading since ${leaderSince}`,
  ].filter(Boolean).join(' · ');

  const typeInfo = entityMeta(link.entity);
  const Icon = typeInfo.icon;
  return (
    <div className="py-2.5">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${typeInfo.medallion} ${isFormer ? 'opacity-70' : ''}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {onOpen
              ? <button type="button" onClick={() => onOpen(link.entity.id)} data-tooltip={`Open ${link.entity.canonicalName}`} className="min-w-0 truncate text-left text-sm font-semibold text-text-primary transition-colors hover:underline underline-offset-4 cursor-pointer">{link.entity.canonicalName}</button>
              : <span className="min-w-0 truncate text-sm font-semibold text-text-primary">{link.entity.canonicalName}</span>}
            {isLeader && <MemberFlag icon={Crown} label="Leader" tone="border-accent/30 bg-accent/10 text-accent" />}
            {meta.founder && <MemberFlag icon={Landmark} label="Founder" tone="border-entity-faction/30 bg-entity-faction/10 text-entity-faction" />}
          </div>
          {tenure && <p className="caption mt-0.5">{tenure}</p>}
        </div>
        {editing ? (
          <>
            <input value={role} onChange={(e) => setRole(e.target.value)} onBlur={commitRole} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
              placeholder={isFormer ? 'Last rank' : 'Rank'} aria-label={`Rank of ${link.entity.canonicalName}`}
              className="wb-input h-9 w-56 shrink-0 rounded-control border border-border-default bg-surface-input/90 px-2.5 text-sm text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none" />
            <IconButton icon={MoreHorizontal} size="sm" label={`${link.entity.canonicalName} membership`} aria-expanded={datesOpen} className={datesOpen ? '!bg-surface-hover !text-text-primary' : ''} onClick={() => setDatesOpen(open => !open)} />
          </>
        ) : (
          rank && <span className={`shrink-0 text-right text-sm ${isFormer ? 'text-text-muted' : 'text-text-secondary'}`}>{rank}</span>
        )}
      </div>
      {/* One date per row: the control needs its full width to show the month by name. */}
      {editing && datesOpen && (
        <div className="ml-9 mt-2.5 space-y-3 rounded-control border border-border-subtle bg-surface-canvas/30 p-3">
          {calendar ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Edit label="Joined"><WorldDateInput label="Joined" emptyLabel="Set the date they joined" calendar={calendar} value={meta.joined} onChange={joinedDate => onSetMeta(link, { joined: joinedDate })} /></Edit>
              {isFormer && <Edit label="Left"><WorldDateInput label="Left" emptyLabel="Set the date they left" calendar={calendar} value={meta.left} onChange={leftDate => onSetMeta(link, { left: leftDate })} /></Edit>}
              {isLeader && <Edit label="Leading since"><WorldDateInput label="Leading since" emptyLabel="Set the date they took charge" calendar={calendar} value={meta.leaderSince} onChange={since => onSetMeta(link, { leaderSince: since })} /></Edit>}
            </div>
          ) : <p className="caption">Set up the world calendar to record dates.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" icon={Landmark} aria-pressed={Boolean(meta.founder)} className={meta.founder ? '!border-entity-faction/40 !text-entity-faction' : ''} onClick={() => onSetMeta(link, { founder: !meta.founder })}>Founder</Button>
            {onSetFormer && <Button size="sm" variant="ghost" icon={LogOut} onClick={() => onSetFormer(link)}>Moved on</Button>}
            {onRestore && <Button size="sm" variant="ghost" icon={Undo2} onClick={() => onRestore(link)}>Back on the roster</Button>}
            <span className="flex-1" />
            <Button size="sm" variant="subtle" icon={Trash2} className="!text-status-danger" onClick={() => onRemove(link.linkId)}>{isFormer ? 'Drop this record' : 'Remove from roster'}</Button>
          </div>
          <p className="caption">{isFormer ? 'Dropping the record erases this tenure entirely.' : 'Moved on keeps what they knew and stops what the faction shares from now on. Remove erases the record.'}</p>
        </div>
      )}
    </div>
  );
}

// The roster. The leader sits at the top: they are a member like any other, and reading
// a faction should start with who answers for it.
function MemberList({ links, calendar, kind = 'member', leaderId, editing, options, onOpen, onAdd, onSetRole, onSetMeta, onSetFormer, onRestore, onRemove, empty }) {
  const rows = [...(links || [])].sort((a, b) => {
    if (a.entity.id === leaderId) return -1;
    if (b.entity.id === leaderId) return 1;
    return a.entity.canonicalName.localeCompare(b.entity.canonicalName);
  });
  const linked = new Set(rows.map(l => l.entity.id));
  const remaining = (options || []).filter(o => !linked.has(o.id));
  const [showAll, setShowAll] = useState(false);
  const shown = editing || showAll || rows.length <= 6 ? rows : rows.slice(0, 5);
  return (
    <div>
      {editing && kind === 'member' && <p className="caption mb-2">Add anyone who belongs here, give each a rank, and record when they joined.</p>}
      {rows.length === 0
        ? <p className="text-sm text-text-disabled">{empty}</p>
        : <div className="divide-y divide-border-subtle">
            {shown.map(link => (
              <SpoilerRow key={link.linkId} field={`link:${link.linkId}`} editing={editing}>
                <MemberRow link={link} calendar={calendar} kind={kind} isLeader={link.entity.id === leaderId}
                  editing={editing} onOpen={onOpen} onSetRole={onSetRole} onSetMeta={onSetMeta}
                  onSetFormer={onSetFormer} onRestore={onRestore} onRemove={onRemove} />
              </SpoilerRow>
            ))}
          </div>}
      {shown.length < rows.length && <button type="button" onClick={() => setShowAll(true)} className="mt-1 inline-flex items-center gap-1 rounded text-xs font-semibold text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">Show {rows.length - shown.length} more<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /></button>}
      {editing && onAdd && <div className="mt-2"><EntityPickerButton label="Add member" title="Add member" options={remaining} onPick={onAdd} /></div>}
    </div>
  );
}

// The last registry read per workspace. Reopening the tab shows it at once while a fresh
// read runs; nothing can be opened or edited until that read lands.
const registryCache = new Map();
const viewCache = worldbuildViewCache;

export default function WorldbuildView({ chat, electronAPI, focusEntityId, onFocusHandled, focusSurface, onSurfaceHandled }) {
  const { showToast, settings, openSettings } = useApp();
  // Update Entities always uses System AI, independently of the Tagger executor.
  const hasSystemAi = !!settings?.advanced?.systemApiProfileId && !!settings?.advanced?.systemModelName;
  const workspaceId = chat?.id;

  const [cachedRegistry] = useState(() => registryCache.get(workspaceId));
  const [entities, setEntities] = useState(() => cachedRegistry?.entities || []);
  const [insideLinks, setInsideLinks] = useState(() => cachedRegistry?.insideLinks || []);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(() => !cachedRegistry);
  const [registryFresh, setRegistryFresh] = useState(false);
  const savedView = viewCache.get(workspaceId);
  const [search, setSearch] = useState(() => savedView?.search || '');
  const [filterType, setFilterType] = useState(() => savedView?.filterType || null);
  const [reviewFilter, setReviewFilter] = useState(() => savedView?.reviewFilter || null);
  const [nameReview, setNameReview] = useState(() => cachedRegistry?.nameReview || new Map());
  const [manageMode, setManageMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const filterStripRef = useRef(null);
  const [bulkConfirm, setBulkConfirm] = useState(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [selected, setSelected] = useState(null);
  const [surface, setSurface] = useState(() => savedView?.surface || 'entities');
  const [factCount, setFactCount] = useState(() => cachedRegistry?.factCount || 0);
  const [worldCalendar, setWorldCalendar] = useState(() => cachedRegistry?.worldCalendar || null);
  const [worldClock, setWorldClock] = useState(() => cachedRegistry?.worldClock || null);
  const [rel, setRel] = useState({});
  const [charTab, setCharTab] = useState('data');
  const listScrollRef = useRef(null);
  const sheetScrollRef = useRef(null);
  const scrollOffsets = useRef({ list: savedView?.listScroll || 0, sheet: savedView?.sheetScroll || 0 });
  const [editingSection, setEditingSection] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const createRef = useRef(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState(null);
  const enrichProgressRef = useRef(null);
  enrichProgressRef.current = enrichProgress || enrichProgressRef.current;
  const [enrichStopping, setEnrichStopping] = useState(false);
  const [enrichErrors, setEnrichErrors] = useState([]);
  const [showEnrichErrors, setShowEnrichErrors] = useState(false);
  const [enrichErrorSummary, setEnrichErrorSummary] = useState('');
  // How many sheets the last run set out to read, so its failures read as a share of it.
  const [enrichRunTotal, setEnrichRunTotal] = useState(0);
  const [mergePrompt, setMergePrompt] = useState(null); // { id, name } while choosing merge priority
  const [mergeDialog, setMergeDialog] = useState(null); // { suggestedId } while the merge dialog is open
  const [showExportModal, setShowExportModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteImpact, setDeleteImpact] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [fieldDefinitions, setFieldDefinitions] = useState([]);
  const [reviewCounts, setReviewCounts] = useState(() => cachedRegistry?.reviewCounts || {});
  const [subjectReview, setSubjectReview] = useState({ proposals: [] });
  const [reviewKind, setReviewKind] = useState('entity');
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef(null);
  const [showReviewMenu, setShowReviewMenu] = useState(false);
  const reviewMenuRef = useRef(null);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const [openCreateSections, setOpenCreateSections] = useState(() => new Set());
  const { sidebarWidth, updateSidebarWidth, startSidebarResize, handleSidebarResizeKey } = useSidebarWidth();
  const portraits = usePortraits(workspaceId, electronAPI);
  // Ctrl K (or Cmd K) jumps to the search, as in the rest of the app's lists.
  const searchRef = useRef(null);
  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Knowledge and occurrences load inside their tabs; the tab strip still shows how many.
  const [sideCounts, setSideCounts] = useState({ entityId: null, knowledge: null, occurrences: null });
  useEffect(() => {
    const id = selected?.id;
    if (!workspaceId || !id) return undefined;
    let active = true;
    const knowledge = ['Characters', 'Factions', 'Creatures', 'Locations'].includes(selected.type)
      ? electronAPI.getWorldbuildSubjectKnowledge?.(workspaceId, id).then(result => result?.success && result.projection ? (result.projection.cards?.length || 0) + (result.projection.memories?.length || 0) : null).catch(() => null)
      : Promise.resolve(null);
    const occurrences = selected.type === 'Events'
      ? electronAPI.listWorldbuildEventOccurrences?.(workspaceId, id).then(result => result?.success ? (result.occurrences || []).length : null).catch(() => null)
      : Promise.resolve(null);
    Promise.all([knowledge, occurrences]).then(([knowledgeCount, occurrenceCount]) => {
      if (active) setSideCounts({ entityId: id, knowledge: knowledgeCount ?? null, occurrences: occurrenceCount ?? null });
    });
    return () => { active = false; };
  }, [workspaceId, selected?.id, selected?.type, charTab, electronAPI]); // eslint-disable-line react-hooks/exhaustive-deps
  const [locationCover, setLocationCover] = useState(null);
  const [playerEntityId, setPlayerEntityId] = useState(null);
  const [worldImport, setWorldImport] = useState(null);
  const [importDone, setImportDone] = useState(null);
  const [rulesMeta, setRulesMeta] = useState('');
  // The played character's sheet says so while the workspace is in Roleplay; the Rules tile
  // summarizes the world's rules.
  useEffect(() => {
    if (!workspaceId) return undefined;
    let cancelled = false;
    const read = () => Promise.all([
      electronAPI.getWorkspaceExperienceMode?.(workspaceId),
      electronAPI.getRoleplayConfiguration?.(workspaceId)
    ]).then(([mode, result]) => {
      if (cancelled) return;
      setPlayerEntityId(mode?.mode === 'roleplay' && result?.success ? result.settings?.playerEntityId || null : null);
      const resources = result?.definitions?.length || 0;
      const style = result?.progression?.mode === 'levels' ? 'Levels' : '';
      setRulesMeta([resources ? `${resources} ${resources === 1 ? 'resource' : 'resources'}` : '', style || ''].filter(Boolean).join(' · '));
    }).catch(() => {});
    read();
    const refresh = event => { if (!event.detail?.workspaceId || event.detail.workspaceId === workspaceId) read(); };
    window.addEventListener('roleplay-state-change', refresh);
    window.addEventListener('roleplay-mode-change', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('roleplay-state-change', refresh);
      window.removeEventListener('roleplay-mode-change', refresh);
    };
  }, [electronAPI, workspaceId]);
  const [imageDialog, setImageDialog] = useState(null); // 'portrait' | 'background' while choosing or framing
  const [imageBusy, setImageBusy] = useState(false);
  const coverFileRef = useRef(null);
  const selectedId = selected?.id || null;
  const selectedIsLocation = selected?.type === 'Locations';
  useEffect(() => { setImageDialog(null); }, [selectedId]);
  // Reloads when the nesting changes, since a place may inherit its background from a new parent.
  useEffect(() => {
    setLocationCover(null);
    if (!workspaceId || !selectedId || !selectedIsLocation || !electronAPI.getRoleplayLocationBackground) return undefined;
    let active = true;
    electronAPI.getRoleplayLocationBackground(workspaceId, selectedId)
      .then(result => { if (active && result?.success) setLocationCover(result.background?.imagePath ? result.background : null); })
      .catch(() => {});
    return () => { active = false; };
  }, [workspaceId, selectedId, selectedIsLocation, electronAPI, insideLinks]);
  const imageSaved = (result, fallback) => {
    if (result?.success) return true;
    showToast(result?.error || fallback, 'error');
    return false;
  };
  const applyCover = (result) => setLocationCover(result.background?.imagePath ? result.background : null);
  const chooseImage = async (kind, filePath) => {
    if (!selectedId || !filePath) return false;
    setImageBusy(true);
    try {
      if (kind === 'portrait') {
        if (!imageSaved(await electronAPI.setEntityPortrait(workspaceId, selectedId, filePath), 'Could not save the portrait.')) return false;
        await loadPortraits(workspaceId, electronAPI, { force: true });
        return true;
      }
      const result = await electronAPI.uploadRoleplayLocationBackground(workspaceId, selectedId, filePath);
      if (!imageSaved(result, 'Could not save the background.')) return false;
      applyCover(result);
      return true;
    } finally { setImageBusy(false); }
  };
  const saveImageFocus = async (focus) => {
    setImageBusy(true);
    try {
      if (imageDialog === 'portrait') {
        if (!imageSaved(await electronAPI.setEntityPortrait(workspaceId, selectedId, null, focus), 'Could not save the framing.')) return;
        await loadPortraits(workspaceId, electronAPI, { force: true });
      } else {
        const result = await electronAPI.setLocationBackgroundFocus(workspaceId, selectedId, focus);
        if (!imageSaved(result, 'Could not save the framing.')) return;
        applyCover(result);
      }
      setImageDialog(null);
    } finally { setImageBusy(false); }
  };
  const removeImage = async (kind) => {
    setImageBusy(true);
    try {
      if (kind === 'portrait') {
        if (!imageSaved(await electronAPI.removeEntityPortrait(workspaceId, selectedId), 'Could not remove the portrait.')) return;
        await loadPortraits(workspaceId, electronAPI, { force: true });
      } else {
        const result = await electronAPI.setRoleplayLocationBackground(workspaceId, selectedId, null);
        if (!imageSaved(result, 'Could not remove the background.')) return;
        applyCover(result);
      }
      setImageDialog(null);
    } finally { setImageBusy(false); }
  };
  // A new background opens straight into framing, so the header shows the part that was meant.
  const pickCover = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file?.path && await chooseImage('background', file.path)) setImageDialog('background');
  };
  const {
    expandedLocations,
    setExpandedLocations,
    isNavigationStateReady: navigationStateReady,
  } = useWorldbuildNavigationState({
    workspaceId,
    electronAPI,
    sidebarWidth,
    updateSidebarWidth,
  });

  const isNew = !selected?.id;
  const isIndividualCreature = selected?.type === 'Creatures' && (selected?.data?.scope || 'individual') !== 'group';
  // A Region or Area is where common knowledge lives, read by everyone local to it.
  const isSharingLocation = selected?.type === 'Locations' && ['region', 'area'].includes(locationSizeOf(selected));
  const hasKnowledgeTab = selected?.type === 'Characters' || selected?.type === 'Factions' || isIndividualCreature || isSharingLocation;
  const hasOccurrencesTab = selected?.type === 'Events';
  // Read through the registry, as the editor does, so legacy section ids keep their place.
  const storedTemplate = templates.find(template => template.typeId === selected?.type);
  const activeTemplate = useMemo(() => storedTemplate && {
    ...storedTemplate,
    layout: { ...storedTemplate.layout, sections: normalizeTemplateSections(storedTemplate.typeId, storedTemplate.layout?.sections) },
  }, [storedTemplate]);
  const templateSections = activeTemplate?.layout?.sections || [];
  const sectionSetting = (id) => templateSections.find(section => section.id === id);
  const selectedReviewCounts = reviewCounts[selected?.id] || { entityUpdates: selected?.data?._enrichPending ? 1 : 0, narrative: 0 };
  const hasEntityReview = selectedReviewCounts.entityUpdates > 0;
  const hasNarrativeReview = selectedReviewCounts.narrative > 0;
  const hasReview = hasEntityReview || hasNarrativeReview;
  // Skills the AI wants to give or raise live in the Rules; the sheet's review shows the same changes.
  const [reviewSkillChanges, setReviewSkillChanges] = useState([]);
  const loadReviewSkillChanges = useCallback(async () => {
    if (!workspaceId || !selectedId) { setReviewSkillChanges([]); return; }
    try {
      const config = await electronAPI.getRoleplayConfiguration?.(workspaceId);
      setReviewSkillChanges(skillChangeItems(config).filter(change => change.entityId === selectedId && change.status === 'pending' && change.source === 'ai'));
    } catch { setReviewSkillChanges([]); }
  }, [electronAPI, workspaceId, selectedId]);
  useEffect(() => {
    if (!hasEntityReview) { setReviewSkillChanges([]); return undefined; }
    loadReviewSkillChanges();
    const refresh = event => { if (!event.detail?.workspaceId || event.detail.workspaceId === workspaceId) loadReviewSkillChanges(); };
    window.addEventListener('roleplay-state-change', refresh);
    return () => window.removeEventListener('roleplay-state-change', refresh);
  }, [hasEntityReview, loadReviewSkillChanges, workspaceId]);
  const isFaction = selected?.type === 'Factions';
  // Which tabs a sheet shows follows from the type and its shape. The relational tabs are
  // systematic, so the template has no say over them.
  const sheetVariant = selected?.type === 'Creatures' ? (isIndividualCreature ? 'individual' : 'group') : isSharingLocation ? 'shared' : null;
  const visibleSheetTabs = sheetTabsFor(selected?.type, sheetVariant);
  if (hasReview && !isNew) visibleSheetTabs.push('review');
  const sheetTabLabel = (tab) => tab === 'review' ? 'Review' : tabLabel(selected?.type, sheetVariant, tab);
  // A template's display name renames the type; left at its default plural, the singular stays.
  const typeMeta = (type) => {
    const base = meta(type);
    const displayName = templates.find(template => template.typeId === type)?.displayName;
    return displayName && displayName !== base.plural ? { ...base, label: displayName, plural: displayName } : base;
  };
  const concreteEntityMeta = (entity) => {
    const base = entityMeta(entity);
    const displayName = templates.find(template => template.typeId === entity?.type)?.displayName;
    return displayName && displayName !== base.plural ? { ...base, label: displayName, plural: displayName } : base;
  };
  const docTitle = (id) => documents.find(d => d.id === id)?.title;
  // A creature is either one being or a whole species, and the two get different sheets.
  // Offering the choice here, instead of a toggle found later inside the sheet, means the
  // right shape opens from the start.
  const createOptions = TYPE_ORDER.flatMap(type => type === 'Creatures'
    ? [
        { id: 'Creatures:individual', type, label: 'Creature', note: 'A specific being', data: { scope: 'individual' } },
        { id: 'Creatures:group', type, label: 'Species', note: 'A group or kind of creature', data: { scope: 'group' } },
      ]
    : type === 'Items'
      ? [
          { id: 'Items', type, label: 'Item type', note: 'Can exist in quantities', data: {} },
          { id: 'Items:unique', type, label: 'Unique item', note: 'Exists only once', data: { itemNature: 'unique' } },
        ]
      : [{ id: type, type, data: {} }]);

  const byType = useMemo(() => {
    const m = {}; for (const t of Object.keys(TYPES)) m[t] = [];
    for (const e of entities) (m[e.type] = m[e.type] || []).push(e);
    return m;
  }, [entities]);
  // Where a single object can lie: places and spots before the regions that contain them.
  const sharingLocations = useMemo(() => (byType.Locations || []).filter(location => ['region', 'area'].includes(locationSizeOf(location))), [byType.Locations]);
  const presenceLocations = useMemo(() => sortLocationsForPresence(byType.Locations || []), [byType.Locations]);
  // A species or swarm is not someone a relation can point at: only specific beings own things,
  // hold a relationship, or are regarded by a faction.
  const individualCreatures = useMemo(
    () => (byType.Creatures || []).filter(entity => (entity.data?.scope || 'individual') !== 'group'),
    [byType.Creatures],
  );

  const nameReviewRequest = useRef(0);
  // Kept apart from `load`: it reads every passage of the workspace, and the registry
  // gate must not wait for it. Its flags only annotate the list.
  const loadNameReview = useCallback(async () => {
    if (!workspaceId || !electronAPI.getEntityReview) return;
    const request = ++nameReviewRequest.current;
    const result = await electronAPI.getEntityReview(workspaceId).catch(() => null);
    if (request !== nameReviewRequest.current || !result?.success) return;
    const review = new Map((result.items || []).map(item => [item.id, item.reasons]));
    const cached = registryCache.get(workspaceId);
    if (cached) registryCache.set(workspaceId, { ...cached, nameReview: review });
    setNameReview(review);
  }, [workspaceId, electronAPI]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const [entityRes, linkRes, reviewRes, factRes, calendarRes] = await Promise.all([
        electronAPI.listEntities(workspaceId),
        electronAPI.listEntityLinks(workspaceId, 'inside'),
        electronAPI.listWorldbuildReviewCounts?.(workspaceId),
        electronAPI.listWorldbuildFacts?.(workspaceId),
        electronAPI.getWorldCalendar?.(workspaceId),
      ]);
      const registry = {
        entities: entityRes?.entities || [],
        insideLinks: linkRes?.links || [],
        reviewCounts: reviewRes?.counts || {},
        factCount: factRes?.facts?.length || 0,
        worldCalendar: calendarRes?.calendar || null,
        worldClock: calendarRes?.clock || null,
        nameReview: registryCache.get(workspaceId)?.nameReview || new Map()
      };
      registryCache.set(workspaceId, registry);
      setEntities(registry.entities);
      setInsideLinks(registry.insideLinks);
      setReviewCounts(registry.reviewCounts);
      setFactCount(registry.factCount);
      setWorldCalendar(registry.worldCalendar);
      setWorldClock(registry.worldClock);
      loadNameReview();
    } catch { registryCache.delete(workspaceId); setEntities([]); setInsideLinks([]); setNameReview(new Map()); }
    finally { setLoading(false); setRegistryFresh(true); }
  }, [workspaceId, electronAPI, loadNameReview]);

  const loadEnrichErrors = useCallback(async () => {
    if (!workspaceId || !electronAPI.getEntityEnrichmentErrors) return;
    const result = await electronAPI.getEntityEnrichmentErrors(workspaceId).catch(() => null);
    setEnrichErrors(result?.errors || []);
    if (result?.errors?.length) setShowEnrichErrors(true);
  }, [workspaceId, electronAPI]);

  useEffect(() => {
    setLoading(!registryCache.has(workspaceId));
    nameReviewRequest.current++;
    setNameReview(registryCache.get(workspaceId)?.nameReview || new Map());
    const view = viewCache.get(workspaceId);
    setSelected(null);
    setSurface(view?.surface || 'entities');
    setRel({});
    setManageMode(false);
    setSelectedIds(new Set());
    setSearch(view?.search || '');
    setFilterType(view?.filterType || null);
    setReviewFilter(view?.reviewFilter || null);
    scrollOffsets.current = { list: view?.listScroll || 0, sheet: view?.sheetScroll || 0 };
    load();
    loadEnrichErrors();
  }, [load, loadEnrichErrors]);

  // Declared after the restore above, so a page asked for from outside wins over the saved one.
  useEffect(() => {
    if (!focusSurface) return;
    setSurface(focusSurface);
    setSelected(null);
    setEditingSection(null);
    onSurfaceHandled?.();
  }, [focusSurface]); // eslint-disable-line react-hooks/exhaustive-deps

  // Saved when the reader leaves, not on every change: a workspace switch would otherwise
  // store one workspace's search under the next one before the restore above lands.
  const liveView = useRef(null);
  liveView.current = {
    surface, search, filterType, reviewFilter, charTab,
    entityId: surface === 'entities' ? selected?.id || null : null,
  };
  useEffect(() => () => {
    if (!workspaceId) return;
    viewCache.set(workspaceId, {
      ...liveView.current,
      listScroll: scrollOffsets.current.list,
      sheetScroll: scrollOffsets.current.sheet,
    });
  }, [workspaceId]);
  useScrollRestore(listScrollRef, {
    scope: workspaceId,
    offset: savedView?.listScroll || 0,
    ready: !loading && entities.length > 0,
  });
  useScrollRestore(sheetScrollRef, {
    scope: workspaceId,
    offset: savedView?.sheetScroll || 0,
    ready: savedView?.entityId ? selected?.id === savedView.entityId : !!savedView && surface === savedView.surface,
  });
  useEffect(() => { electronAPI.getWritingTree(workspaceId).then(t => setDocuments(t?.documents || [])).catch(() => setDocuments([])); }, [workspaceId, electronAPI]);
  useEffect(() => {
    if (!workspaceId || !electronAPI.listWorldbuildEntityTemplates) return;
    electronAPI.listWorldbuildEntityTemplates(workspaceId).then(result => setTemplates(result?.templates || [])).catch(() => setTemplates([]));
  }, [electronAPI, workspaceId]);
  useEffect(() => {
    if (!workspaceId || !selected?.type || !electronAPI.listWorldbuildFieldDefinitions) { setFieldDefinitions([]); return; }
    electronAPI.listWorldbuildFieldDefinitions(workspaceId, selected.type)
      .then(result => setFieldDefinitions(result?.fields || []))
      .catch(() => setFieldDefinitions([]));
  }, [electronAPI, selected?.type, workspaceId]);
  const loadSubjectReview = useCallback(async () => {
    if (!workspaceId || !selected?.id || !electronAPI.getWorldbuildSubjectReview) {
      setSubjectReview({ proposals: [] });
      return;
    }
    const result = await electronAPI.getWorldbuildSubjectReview(workspaceId, selected.id).catch(() => null);
    setSubjectReview(result?.review || { proposals: [] });
  }, [electronAPI, selected?.id, workspaceId]);
  useEffect(() => { loadSubjectReview(); }, [loadSubjectReview]);
  useEffect(() => {
    if (!hasEntityReview && hasNarrativeReview) setReviewKind('narrative');
    else if (hasEntityReview && !hasNarrativeReview) setReviewKind('entity');
  }, [hasEntityReview, hasNarrativeReview, selected?.id]);
  // A tab can disappear under the reader: the template hides its section, or a creature
  // changes shape. Fall back to Data instead of leaving an empty tab selected.
  useEffect(() => {
    if (selected && !visibleSheetTabs.includes(charTab)) setCharTab('data');
  }, [visibleSheetTabs.join(','), charTab, selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Every edge a sheet needs, read in parallel.
  const loadRelations = useCallback(async (ent) => {
    if (!ent?.id) { setRel({}); return; }
    const request = (direction, relType) => electronAPI.getEntityLinks(ent.id, direction, relType).then(x => x?.links || []);
    const wanted = {
      Locations: { inside: ['from', 'inside'], leader: ['from', 'led_by'] },
      Items: {
        createdBy: ['from', 'created_by'], ownedBy: ['from', 'owned_by'], locatedIn: ['from', 'located_in'],
        foundIn: ['from', 'found_in'], soldIn: ['from', 'sold_in'],
      },
      Races: { members: ['to', 'is_race'] },
      // A specific being's species is the same link as a character's race.
      Creatures: (ent.data?.scope || 'individual') === 'group'
        ? { foundIn: ['from', 'found_in'], members: ['to', 'is_race'] }
        : { foundIn: ['from', 'found_in'], isRace: ['from', 'is_race'], memberOf: ['from', 'member_of'], formerMemberOf: ['from', 'former_member_of'], localTo: ['from', 'local_to'] },
      Events: { happenedAt: ['from', 'happened_at'], involved: ['from', 'involved'] },
      Factions: {
        operatesIn: ['from', 'operates_in'], members: ['to', 'member_of'],
        formerMembers: ['to', 'former_member_of'], leader: ['from', 'led_by'],
      },
      Characters: {
        isRace: ['from', 'is_race'], memberOf: ['from', 'member_of'],
        formerMemberOf: ['from', 'former_member_of'], connectedTo: ['from', 'connected_to'],
        localTo: ['from', 'local_to'],
      },
    }[ent.type] || {};
    const singles = new Set(['inside', 'leader', 'createdBy', 'ownedBy', 'locatedIn', 'isRace']);
    const isAgent = ent.type === 'Characters' || (ent.type === 'Creatures' && (ent.data?.scope || 'individual') !== 'group');
    const wantsRelationships = isAgent || ent.type === 'Factions';
    const extras = {
      ...(isAgent ? { owned: ['to', 'owned_by'], carried: ['to', 'carried_by'] } : {}),
      ...(wantsRelationships ? { outgoing: ['from', 'related_to'], incoming: ['to', 'related_to'] } : {}),
    };
    const keys = [...Object.keys(wanted), ...Object.keys(extras)];
    const results = await Promise.all(keys.map(key => {
      const [direction, relType] = wanted[key] || extras[key];
      return request(direction, relType);
    }));
    const links = Object.fromEntries(keys.map((key, index) => [key, results[index]]));
    const n = {};
    for (const key of Object.keys(wanted)) n[key] = singles.has(key) ? links[key][0] || null : links[key];
    if (isAgent) n.inventory = [...links.owned, ...links.carried];
    if (wantsRelationships) {
      n.relationships = [
        ...links.outgoing.map(link => ({ ...link, direction: 'outgoing' })),
        ...links.incoming.map(link => ({ ...link, direction: 'incoming' })),
      ];
    }
    setRel(n);
  }, [electronAPI]);

  const openEntity = async (en, { preserveTab = false, tab = null } = {}) => {
    setSurface('entities');
    setEditingSection(null); if (tab) setCharTab(tab); else if (!preserveTab) setCharTab('data'); setMergePrompt(null);
    setSelected({ id: en.id, type: en.type, canonicalName: en.canonicalName || '', aliases: (en.aliases || []).join(', '), lore: en.lore || '', loreDocumentId: en.loreDocumentId || '', status: en.status || 'confirmed', data: en.data || {} });
    await loadRelations(en);
  };

  // Focus an entity requested from outside (the Writing Desk "Open in Worldbuild" action),
  // once the registry has loaded. Clear the request so it fires only once.
  useEffect(() => {
    if (!registryFresh || !focusEntityId || !entities.length) return;
    const en = entities.find(e => e.id === focusEntityId);
    if (en) openEntity(en);
    onFocusHandled?.();
  }, [registryFresh, focusEntityId, entities]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Only a sheet left open earlier in this visit comes back; a new visit opens on the overview.
    const view = viewCache.get(workspaceId);
    if (!registryFresh || !navigationStateReady || surface !== 'entities' || focusEntityId || selected || !view?.entityId) return;
    const en = entities.find(e => e.id === view.entityId);
    if (en) openEntity(en, { tab: view.charTab });
  }, [registryFresh, navigationStateReady, surface, focusEntityId, selected, entities]); // eslint-disable-line react-hooks/exhaustive-deps
  const openEntityById = (entityId, options) => {
    const target = entities.find(item => item.id === entityId);
    if (target) openEntity(target, options);
  };
  const startNew = (type, data = {}) => { setOpenCreateSections(new Set()); setSurface('entities'); setShowCreate(false); setEditingSection(null); setCharTab('data'); setSelected(draftFor(type, data)); setRel({}); };
  const patch = (f) => setSelected(p => ({ ...p, ...f }));
  const patchData = (f) => setSelected(p => ({ ...p, data: { ...p.data, ...f } }));
  // What the reader may see is a viewing setting, not content: it is saved the moment the eye
  // is used, so Cancel on a section never brings a secret back into view.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const toggleHidden = (field, hidden) => {
    const current = selectedRef.current;
    if (!current) return;
    const spoilers = withFieldHidden(current.data || {}, field, hidden).spoilers;
    selectedRef.current = { ...current, data: { ...(current.data || {}), spoilers } };
    setSelected(p => (p && p.id === current.id ? { ...p, data: { ...(p.data || {}), spoilers } } : p));
    if (!current.id) return;
    setEntities(list => list.map(item => item.id === current.id ? { ...item, data: { ...(item.data || {}), spoilers } } : item));
    electronAPI.updateEntity(current.id, { data: { spoilers } })
      .then(r => { if (!r?.success) showToast(`Could not save what is hidden: ${r?.error || 'unknown error'}`, 'error'); })
      .catch(e => showToast(`Could not save what is hidden: ${e.message}`, 'error'));
  };
  const applyIntegratedEntity = (entity) => {
    setSelected(current => current?.id === entity.id ? { ...current, data: entity.data || {} } : current);
    setEntities(current => current.map(item => item.id === entity.id ? { ...item, data: entity.data || {} } : item));
  };

  // Linked chapters: many-valued, stored in data.loreDocumentIds. Legacy entities that
  // only have the single loreDocumentId column read through the fallback below.
  const loreDocIds = () => {
    const arr = selected?.data?.loreDocumentIds;
    if (Array.isArray(arr)) return arr.filter(Boolean);
    return selected?.loreDocumentId ? [selected.loreDocumentId] : [];
  };
  const addLoreDoc = (id) => { if (!id) return; const cur = loreDocIds(); if (cur.includes(id)) return; patchData({ loreDocumentIds: [...cur, id] }); };
  const removeLoreDoc = (id) => patchData({ loreDocumentIds: loreDocIds().filter(x => x !== id) });
  const aliasesArr = (raw) => raw.split(',').map(s => s.trim()).filter(Boolean);

  const persist = async ({ accept = false } = {}) => {
    if (!selected) return null;
    if (!selected.canonicalName.trim()) { showToast('A name is required.', 'error'); return null; }
    setSaving(true);
    try {
      const ids = loreDocIds();
      const data = { ...(selected.data || {}), loreDocumentIds: ids };
      if (accept) delete data._imported; // accepting an imported proposal makes it a real entity
      const payload = { workspaceId, type: selected.type, canonicalName: selected.canonicalName.trim(), aliases: aliasesArr(selected.aliases), lore: selected.lore, loreDocumentId: ids[0] || null, data, status: accept ? 'confirmed' : selected.status };
      let id = selected.id;
      if (selected.id) { const r = await electronAPI.updateEntity(selected.id, payload); if (!r?.success) throw new Error(r?.error || 'update failed'); patch({ status: payload.status }); }
      else { const r = await electronAPI.createEntity(payload); if (!r?.success) throw new Error(r?.error || 'create failed'); id = r.entity.id; setSelected(s => ({ ...s, id, status: r.entity.status })); }
      await load();
      await loadEnrichErrors();
      return id;
    } catch (e) { showToast(`Save failed: ${e.message}`, 'error'); return null; }
    finally { setSaving(false); }
  };

  const saveSection = async () => { const id = await persist(); if (id) setEditingSection(null); };
  const cancelSection = async () => { const cur = entities.find(e => e.id === selected.id); if (cur) await openEntity(cur); setEditingSection(null); };
  useEffect(() => {
    setDeleteImpact(null);
    if (!confirmDelete || !selected?.id || !workspaceId) return undefined;
    let current = true;
    electronAPI.summarizeBulkEntities(workspaceId, [selected.id])
      .then(summary => { if (current && summary?.success) setDeleteImpact(summary); })
      .catch(() => {});
    return () => { current = false; };
  }, [confirmDelete, selected?.id, workspaceId]);

  const reprocessSelected = async () => {
    if (!selected?.id) return;
    const result = await electronAPI.bulkManageEntities(workspaceId, [selected.id], 'reprocess', null).catch(error => ({ success: false, error: error.message }));
    if (!result?.success) { showToast(`Could not reset: ${result?.error || 'unknown error'}`, 'error'); return; }
    showToast('The next update reads this entity\'s passages again.', 'success');
  };

  const remove = async () => {
    if (!selected?.id) { setSelected(null); return; }
    setSaving(true);
    try {
      const r = await electronAPI.deleteEntity(selected.id);
      if (!r?.success) { showToast(`Could not delete: ${r?.error || 'unknown error'}`, 'error'); return; }
      setSelected(null);
      await load();
    } finally { setSaving(false); }
  };

  const mergeInto = async (targetId, prefer = 'target') => {
    if (!selected?.id || !targetId) return;
    setSaving(true);
    try {
      const r = await electronAPI.mergeEntity(selected.id, targetId, prefer);
      if (!r?.success) { showToast(`Merge failed: ${r?.error || 'unknown error'}`, 'error'); return; }
      setMergePrompt(null);
      await load();
      if (r.entity) await openEntity(r.entity); else setSelected(null);
    } catch (e) { showToast(`Merge failed: ${e.message}`, 'error'); }
    finally { setSaving(false); }
  };
  // Picking a merge target: an imported entity carries its own data, so ask which side wins
  // on conflicts; a bare AI proposal has nothing to weigh, so merge straight into the target.
  const startMerge = (targetId) => {
    const t = entities.find(e => e.id === targetId);
    if (selected?.data?._imported) setMergePrompt({ id: targetId, name: t?.canonicalName || 'that entity' });
    else mergeInto(targetId, 'target');
  };
  // Candidates a proposal can fold into: every other real (non-proposed) entity.
  const mergeTargets = useMemo(() => entities.filter(e => e.id !== selected?.id && e.status !== 'proposed'), [entities, selected]);

  // Per-entity AI write permission. Persists immediately for saved entities; for an
  // unsaved draft it just rides along in data until the first save.
  const setAiPolicy = async (policy) => {
    patchData({ aiPolicy: policy });
    if (!selected?.id) return;
    try {
      const data = { ...(selected.data || {}), aiPolicy: policy };
      const r = await electronAPI.updateEntity(selected.id, { data });
      if (!r?.success) { showToast(`Could not change AI permission: ${r?.error || 'unknown error'}`, 'error'); return; }
      await load();
    } catch (e) { showToast(`Could not change AI permission: ${e.message}`, 'error'); }
  };

  // The review stops flagging this entity; its name and tags stay as they are.
  const keepName = async () => {
    if (!selected?.id) return;
    try {
      const data = { ...(selected.data || {}), nameReviewDismissed: true };
      const r = await electronAPI.updateEntity(selected.id, { data });
      if (!r?.success) { showToast(`Could not update: ${r?.error || 'unknown error'}`, 'error'); return; }
      patchData({ nameReviewDismissed: true });
      // A dismissed name is never flagged again, so the warning can go before the review reruns.
      setNameReview(current => { const next = new Map(current); next.delete(selected.id); return next; });
      await load();
    } catch (e) { showToast(`Could not update: ${e.message}`, 'error'); }
  };

  // The run lives in the main process; on mount the lock is restored from its status.
  useEffect(() => {
    if (!electronAPI.onEnrichEntitiesProgress) return;
    return electronAPI.onEnrichEntitiesProgress((p) => setEnrichProgress(p));
  }, [electronAPI]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!electronAPI.getEnrichStatus) return;
      const s = await electronAPI.getEnrichStatus();
      if (cancelled || !s?.running || (s.workspaceId && s.workspaceId !== workspaceId)) return;
      setEnriching(true);
      if (s.progress) setEnrichProgress(s.progress);
    })();
    return () => { cancelled = true; };
  }, [electronAPI, workspaceId]);

  // A ref keeps the handler current without re-subscribing every render.
  const onEnrichComplete = async (res) => {
    setEnrichRunTotal(enrichProgressRef.current?.total || 0);
    setEnriching(false); setEnrichProgress(null); setEnrichStopping(false);
    if (res && res.workspaceId && res.workspaceId !== workspaceId) return;
    if (res && res.success) {
      await load();
      await loadEnrichErrors();
      if (selected?.id) await refreshSelected(selected.id);
      const bits = [`${res.updated} updated`];
      if (res.staged) bits.push(`${res.staged} staged for review`);
      if (res.upToDate) bits.push(`${res.upToDate} with no unprocessed evidence`);
      if (res.noEvidence) bits.push(`${res.noEvidence} with no matching evidence`);
      if (res.evidenceUsed) bits.push(`${res.evidenceUsed} evidence passages read`);
      if (res.taggedEvidenceRemaining) bits.push(`${res.taggedEvidenceRemaining} tagged passages pending`);
      if (res.textMatchesDeferred) bits.push(`${res.textMatchesDeferred} lower-priority text matches deferred`);
      if (res.canonicalSuggestionCount) bits.push(`${res.canonicalSuggestionCount} entity suggestions`);
      if (res.narrativeSuggestionCount) bits.push(`${res.narrativeSuggestionCount} Narrative state suggestions`);
      if (res.skillSuggestionCount) bits.push(`${res.skillSuggestionCount} skill ${res.skillSuggestionCount === 1 ? 'suggestion' : 'suggestions'}`);
      if (res.emptyFieldSuggestions) bits.push(`${res.emptyFieldSuggestions} empty field suggestions`);
      if (res.emptyFieldsWithoutSupport) bits.push(`${res.emptyFieldsWithoutSupport} empty fields without supporting evidence`);
      if (res.emptyFieldsAwaitingEvidence) bits.push(`${res.emptyFieldsAwaitingEvidence} empty fields still awaiting deferred evidence`);
      if (res.tokenUsage?.inputTokens) bits.push(`~${res.tokenUsage.inputTokens.toLocaleString()} input tokens`);
      if (res.tokenUsage?.outputTokens) bits.push(`~${res.tokenUsage.outputTokens.toLocaleString()} output tokens`);
      if (res.failed) bits.push(`${res.failed} failed`);
      if (res.stoppedEarly && res.remaining) bits.push(`${res.remaining} left pending after repeated structured-output failures`);
      if (res.cancelled && res.remaining) bits.push(`${res.remaining} not read yet`);
      const summary = bits.join(', ');
      if (res.failed) {
        setShowEnrichErrors(true);
      }
      if (res.failed && !res.updated) {
        setEnrichErrorSummary(`${summary}.`);
      } else {
        setEnrichErrorSummary('');
        showToast(`${res.cancelled ? 'Update stopped' : 'Update complete'}: ${summary}.`, res.failed ? 'error' : 'success');
      }
    } else if (res) {
      showToast(`Update failed: ${res.error || 'unknown error'}`, 'error');
    }
  };
  const dismissEnrichError = async (id) => {
    const result = await electronAPI.dismissEntityEnrichmentError?.(id);
    if (result?.success) setEnrichErrors(current => {
      const next = current.filter(item => item.id !== id);
      if (!next.length) setShowEnrichErrors(false);
      return next;
    });
  };
  const dismissAllEnrichErrors = async () => {
    const ids = enrichErrors.map(error => error.id);
    const results = await Promise.all(ids.map(id => electronAPI.dismissEntityEnrichmentError?.(id)));
    const dismissed = new Set(ids.filter((_, index) => results[index]?.success));
    setEnrichErrors(current => current.filter(error => !dismissed.has(error.id)));
    if (dismissed.size === ids.length) setShowEnrichErrors(false);
    else showToast('Some update errors could not be dismissed.', 'error');
  };
  const onEnrichCompleteRef = useRef(onEnrichComplete);
  onEnrichCompleteRef.current = onEnrichComplete;
  useEffect(() => {
    if (!electronAPI.onEnrichEntitiesComplete) return;
    return electronAPI.onEnrichEntitiesComplete((res) => onEnrichCompleteRef.current(res));
  }, [electronAPI]);

  const runEnrichment = async (entityIds = null) => {
    if (enriching || !workspaceId) return;
    if (!hasSystemAi) { showToast('System AI needs both an API Connection and a model in Settings → Engine & Memory.', 'error'); return; }
    enrichProgressRef.current = null;
    setEnriching(true); setEnrichProgress(null); setEnrichStopping(false);
    // The completion event drives the toast, reload and clearing of the progress card. Here we
    // only surface a failure to even start the run (e.g. one is already in flight).
    try {
      const r = await electronAPI.enrichEntities(workspaceId, { entityIds: Array.isArray(entityIds) ? entityIds : undefined });
      if (r && r.success === false) { setEnriching(false); showToast(`Update failed: ${r.error || 'unknown error'}`, 'error'); }
    } catch (e) { setEnriching(false); showToast(`Update failed: ${e.message}`, 'error'); }
  };
  const stopEnrichment = async () => {
    setEnrichStopping(true);
    const result = await electronAPI.cancelEnrichEntities?.(workspaceId).catch(() => null);
    if (!result?.success) setEnrichStopping(false);
  };
  // The open sheet is read again once the AI is done with it. An edit in progress keeps the
  // person's draft and only takes the new suggestions, so saving never drops them.
  const refreshSelected = async (entityId) => {
    const fresh = (await electronAPI.getEntity(entityId))?.entity;
    if (!fresh || selected?.id !== entityId) return;
    if (editingSection) {
      setSelected(current => current?.id === entityId ? { ...current, data: { ...current.data, _enrichPending: fresh.data?._enrichPending } } : current);
      return;
    }
    await openEntity(fresh, { preserveTab: true });
  };
  const readingEntityId = enriching ? enrichProgress?.entityId || null : null;
  const lastReadingRef = useRef(null);
  useEffect(() => {
    const previous = lastReadingRef.current;
    lastReadingRef.current = readingEntityId;
    if (previous && previous !== readingEntityId && previous === selected?.id) refreshSelected(previous);
  }, [readingEntityId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Export this workspace's Worldbuild to a portable file; import brings one in as proposals
  // to review, never merging by name.
  const exportWorld = async (includeImages = true, includeCurrentValues = false) => {
    const r = await electronAPI.exportWorldbuild(workspaceId, includeImages, includeCurrentValues);
    if (r?.cancelled) return;
    if (!r?.success) { showToast(`Export failed: ${r?.error || 'unknown error'}`, 'error'); return; }
    const ent = `${r.entities} ${r.entities === 1 ? 'entity' : 'entities'}`;
    const con = r.links ? ` and ${r.links} ${r.links === 1 ? 'connection' : 'connections'}` : '';
    showToast(`Exported ${ent}${con}.`, 'success');
  };
  // The package is read first, so a world with rules of its own can choose how to take the package's.
  const importWorld = async () => {
    const inspected = await electronAPI.inspectWorldbuildPackage(workspaceId);
    if (inspected?.cancelled) return;
    if (!inspected?.success) { showToast(`Import failed: ${inspected?.error || 'unknown error'}`, 'error'); return; }
    setWorldImport(inspected);
  };
  const finishImport = async ({ rulesMode, calendarMode, clearDates }) => {
    const inspected = worldImport;
    const r = await electronAPI.importWorldbuild(workspaceId, inspected.filePath, rulesMode, calendarMode, clearDates);
    if (r?.cancelled) { setWorldImport(null); return; }
    if (!r?.success) { showToast(`Import failed: ${r?.error || 'unknown error'}`, 'error'); return; }
    setWorldImport(null);
    await load();
    setImportDone({ inspected, result: r, rulesMode });
    window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
  };

  // The sheet reloads so remaining staged items stay visible.
  const resolveReview = async (accept = {}, reject = {}) => {
    if (!selected?.id) return;
    setSaving(true);
    try {
      const r = await electronAPI.resolveEnrichReview(selected.id, accept, reject);
      if (!r?.success) { showToast(`Review failed: ${r?.error || 'unknown error'}`, 'error'); return; }
      await load();
      if (r.entity) await openEntity(r.entity, { preserveTab: true });
    } catch (e) { showToast(`Review failed: ${e.message}`, 'error'); }
    finally { setSaving(false); }
  };
  const resolveSkillReview = async (changes, decision) => {
    if (!changes.length) return;
    setSaving(true);
    try {
      for (const change of changes) {
        const r = await electronAPI.resolveRoleplaySkillChange(workspaceId, change.id, decision);
        if (!r?.success) { showToast(`Review failed: ${r?.error || 'unknown error'}`, 'error'); break; }
      }
      window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
      await load();
    } catch (e) { showToast(`Review failed: ${e.message}`, 'error'); }
    finally { setSaving(false); }
  };
  // Accept all and Reject all cover the staged sheet update and the skill changes together.
  const resolveWholeReview = async (accept, staged) => {
    await resolveSkillReview(reviewSkillChanges, accept ? 'approved' : 'rejected');
    if (staged) await resolveReview(accept ? staged : {}, accept ? {} : staged);
  };

  const reloadRel = async () => { await loadRelations({ id: selected.id, type: selected.type }); await load(); };
  // Any { success:false } surfaces as a toast, so a failed link never looks like a no-op.
  const linkOp = async (fn) => {
    try { const r = await fn(); if (r && r.success === false) { showToast(`Link failed: ${r.error || 'unknown error'}`, 'error'); return false; } await reloadRel(); return true; }
    catch (e) { showToast(`Link failed: ${e.message}`, 'error'); return false; }
  };
  const setSingle = async (relType, toId) => { if (!selected?.id) return; await linkOp(() => electronAPI.setEntityLink({ workspaceId, fromId: selected.id, relType, toId, single: true })); };
  const addMulti = async (relType, toId, fromSelected = true) => { if (!selected?.id) return; await linkOp(() => electronAPI.setEntityLink({ workspaceId, fromId: fromSelected ? selected.id : toId, relType, toId: fromSelected ? toId : selected.id, single: false })); };
  // Nesting is stored on the child, so adding a place here writes the child's own link.
  const putPlaceInside = async (childId) => { if (!selected?.id) return; if (await linkOp(() => electronAPI.setEntityLink({ workspaceId, fromId: childId, relType: 'inside', toId: selected.id, single: true }))) await load(); };
  const addInventory = async (itemId) => { await linkOp(() => electronAPI.setEntityLink({ workspaceId, fromId: itemId, relType: 'owned_by', toId: selected.id, single: true })); };
  const addRelationship = async (toId, label) => { if (!selected?.id) return; await linkOp(() => electronAPI.setEntityLink({ workspaceId, fromId: selected.id, relType: 'related_to', toId, single: false, label })); };
  const setRole = async (linkId, role) => { await linkOp(() => electronAPI.updateEntityLinkLabel(linkId, role)); };
  const removeLink = async (linkId) => { await linkOp(() => electronAPI.removeEntityLink(linkId)); };

  // member_of always means "member right now", so leaving swaps it for former_member_of. The old
  // role stays in metadata so rejoining can restore it; the label is what the dossier prints.
  const swapMembership = async (link, relType, label, metadata) => {
    if (!selected?.id) return;
    await linkOp(async () => {
      const created = await electronAPI.setEntityLink({
        workspaceId, fromId: link.entity.id, relType, toId: selected.id, single: false, label, metadata,
      });
      if (created && created.success === false) return created;
      return electronAPI.removeEntityLink(link.linkId);
    });
  };
  // A tenure carries its own record: when it began, when it ended, and whether this is
  // the person the faction started with. Leaving keeps all of it.
  const tenureOf = (link) => {
    const meta = link.metadata || {};
    return { ...(meta.joined ? { joined: meta.joined } : {}), ...(meta.founder ? { founder: true } : {}) };
  };
  const markFormerMember = async (link) => {
    const role = (link.label || '').trim();
    await swapMembership(link, 'former_member_of', role ? `former ${role}` : 'former member', { ...tenureOf(link), ...(role ? { role } : {}) });
  };
  const restoreMember = async (link) => {
    const role = String(link.metadata?.role || '').trim();
    await swapMembership(link, 'member_of', role, tenureOf(link));
  };
  const setMemberMeta = async (link, patch) => {
    await linkOp(() => electronAPI.updateEntityLink(link.linkId, { metadata: { ...(link.metadata || {}), ...patch } }));
  };
  const setMemberRole = async (link, value) => { await setRole(link.linkId, value); };
  // A departure carries the rank in two places: the label the dossier prints, and the
  // rank kept for a return. Editing one has to move the other.
  const setFormerRole = async (link, value) => {
    const rank = value.trim().replace(/^former\s+/i, '');
    await linkOp(() => electronAPI.updateEntityLink(link.linkId, {
      label: value.trim() || 'former member',
      metadata: { ...(link.metadata || {}), ...(rank ? { role: rank } : {}) },
    }));
  };
  // Leading a faction without belonging to it made no sense, so naming a leader puts them
  // on the roster. Someone who had left keeps the rank and dates they already had.
  const setFactionLeader = async (characterId) => {
    if (!selected?.id) return;
    const alreadyMember = (rel.members || []).some(link => link.entity.id === characterId);
    const former = (rel.formerMembers || []).find(link => link.entity.id === characterId);
    await linkOp(async () => {
      const led = await electronAPI.setEntityLink({ workspaceId, fromId: selected.id, relType: 'led_by', toId: characterId, single: true });
      if (led && led.success === false) return led;
      if (!characterId || alreadyMember) return led;
      return electronAPI.setEntityLink({
        workspaceId, fromId: characterId, relType: 'member_of', toId: selected.id, single: false,
        label: String(former?.metadata?.role || '').trim() || 'Leader',
        metadata: former ? tenureOf(former) : {},
      });
    });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = entities.filter(en =>
      (!filterType || en.type === filterType) &&
      matchesReviewFilter(en, reviewFilter, { nameReview, reviewCounts }) &&
      (!q || [en.canonicalName, ...(en.aliases || [])].join(' ').toLowerCase().includes(q))
    );
    return list.sort((a, b) => (TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)) || a.canonicalName.localeCompare(b.canonicalName));
  }, [entities, search, filterType, reviewFilter, reviewCounts, nameReview]);
  const locationTree = useMemo(() => buildLocationTree(entities, insideLinks), [entities, insideLinks]);
  const useLocationTree = !search.trim() && !reviewFilter && (!filterType || filterType === 'Locations');
  const toggleLocation = (id) => setExpandedLocations(current => ({ ...current, [id]: current[id] === false }));
  const proposedCount = useMemo(() => entities.filter(e => e.status === 'proposed').length, [entities]);
  const pendingUpdateCount = useMemo(() => entities.filter(e => e.status !== 'proposed' && ((reviewCounts[e.id]?.entityUpdates || 0) > 0 || (reviewCounts[e.id]?.narrative || 0) > 0)).length, [entities, reviewCounts]);
  const nameReviewCount = useMemo(() => entities.filter(e => nameReview.has(e.id)).length, [entities, nameReview]);
  const exportableCount = useMemo(() => entities.filter(e => e.status !== 'proposed').length, [entities]);
  const typeCounts = useMemo(() => entities.reduce((counts, entity) => ({ ...counts, [entity.type]: (counts[entity.type] || 0) + 1 }), {}), [entities]);
  const selectedEntities = useMemo(() => entities.filter(entity => selectedIds.has(entity.id)), [entities, selectedIds]);
  const visibleIds = useMemo(() => new Set(filtered.map(entity => entity.id)), [filtered]);
  const hiddenSelectedCount = useMemo(() => selectedEntities.filter(entity => !visibleIds.has(entity.id)).length, [selectedEntities, visibleIds]);
  const selectedProposedCount = selectedEntities.filter(entity => entity.status === 'proposed').length;
  // Sheet updates and Narrative state are resolved by different actions, so each counts on its own.
  const selectedUpdateCount = selectedEntities.filter(entity => entity.status !== 'proposed' && (reviewCounts[entity.id]?.entityUpdates || 0) > 0).length;
  const selectedNarrativeCount = selectedEntities.filter(entity => entity.status !== 'proposed' && (reviewCounts[entity.id]?.narrative || 0) > 0).length;
  const selectedConfirmedCount = selectedEntities.length - selectedProposedCount;

  useEffect(() => {
    if (reviewFilter === 'proposed' && proposedCount === 0) setReviewFilter(null);
    if (reviewFilter === 'updates' && pendingUpdateCount === 0) setReviewFilter(null);
    if (reviewFilter === 'names' && nameReviewCount === 0) setReviewFilter(null);
  }, [reviewFilter, proposedCount, pendingUpdateCount, nameReviewCount]);

  const toggleEntitySelection = (id) => setSelectedIds(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectEntities = list => setSelectedIds(new Set(list.map(entity => entity.id)));
  const selectVisibleEntities = () => setSelectedIds(current => new Set([...current, ...filtered.map(entity => entity.id)]));
  const leaveManageMode = () => { setManageMode(false); setSelectedIds(new Set()); };
  const moveFilterStrip = direction => filterStripRef.current?.scrollBy({ left: direction * 180, behavior: 'smooth' });

  const runBulkAction = async (action, policy = null) => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBulkSaving(true);
    try {
      const result = await electronAPI.bulkManageEntities(workspaceId, ids, action, policy);
      if (!result?.success) throw new Error(result?.error || 'bulk action failed');
      if (action === 'policy') showToast(`AI policy changed for ${result.updated} entit${result.updated === 1 ? 'y' : 'ies'}${result.skipped ? `; ${result.skipped} proposal${result.skipped === 1 ? '' : 's'} skipped` : ''}.`, 'success');
      else if (action === 'accept-proposed') showToast(`Accepted ${result.accepted} proposed entit${result.accepted === 1 ? 'y' : 'ies'}.`, 'success');
      else if (action === 'accept-updates') showToast(`Accepted AI updates for ${result.accepted} entit${result.accepted === 1 ? 'y' : 'ies'}.`, 'success');
      else if (action === 'reject-proposed') showToast(`Rejected ${result.rejected} proposed entit${result.rejected === 1 ? 'y' : 'ies'}.`, 'success');
      else if (action === 'reject-updates') showToast(`Rejected AI updates for ${result.rejected} entit${result.rejected === 1 ? 'y' : 'ies'}.`, 'success');
      else if (action === 'reject-narrative') showToast(`Rejected ${result.rejected} Narrative state ${result.rejected === 1 ? 'suggestion' : 'suggestions'}.`, 'success');
      else if (action === 'reprocess') showToast(`${result.reset} entit${result.reset === 1 ? 'y is' : 'ies are'} ready to be reprocessed.`, 'success');
      else if (action === 'delete') showToast(`Deleted ${result.deleted} entit${result.deleted === 1 ? 'y' : 'ies'}.`, 'success');
      const selectedId = selected?.id;
      if (selectedId && ids.includes(selectedId) && (action === 'delete' || (action === 'reject-proposed' && selected?.status === 'proposed'))) setSelected(null);
      setSelectedIds(new Set());
      setBulkConfirm(null);
      if (result.skills) window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
      await load();
      if (action === 'reject-narrative') await loadSubjectReview();
      if (action !== 'delete' && selectedId && ids.includes(selectedId)) {
        const refreshed = await electronAPI.getEntity(selectedId);
        if (refreshed?.entity) await openEntity(refreshed.entity);
      }
    } catch (error) {
      showToast(`Bulk action failed: ${error.message}`, 'error');
    } finally {
      setBulkSaving(false);
    }
  };

  const requestBulkConfirmation = async action => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    try {
      const summary = await electronAPI.summarizeBulkEntities(workspaceId, ids);
      if (!summary?.success) throw new Error(summary?.error || 'could not inspect selection');
      setBulkConfirm({ action, summary });
    } catch (error) {
      showToast(`Could not inspect selection: ${error.message}`, 'error');
    }
  };

  const isUniqueItem = selected?.type === 'Items' && selected?.data?.itemNature === 'unique';
  const isItemType = selected?.type === 'Items' && !isUniqueItem;
  const unsaved = isNew;

  // A character owner is an owned_by edge; the ownerless modes live in data.ownership.
  const ownerVal = rel.ownedBy ? rel.ownedBy.entity.id : (selected?.data?.ownership === 'lost' ? 'lost' : 'ai');
  const ownerOptions = [...byType.Characters, ...individualCreatures];
  const persistItemDraft = async () => {
    if (!selected?.id) return false;
    return Boolean(await persist());
  };
  const setOwner = async (val) => {
    if (!await persistItemDraft()) return;
    if (val === 'ai' || val === 'lost') { patchData({ ownership: val }); await setSingle('owned_by', null); }
    else { patchData({ ownership: 'character' }); await setSingle('located_in', null); await setSingle('owned_by', val); }
  };
  const ownerLabel = rel.ownedBy ? rel.ownedBy.entity.canonicalName : (selected?.data?.ownership === 'lost' ? 'Unknown or lost' : 'Decided by the AI');
  const setItemLocation = async (locationId) => {
    if (!await persistItemDraft()) return;
    if (locationId) await setSingle('owned_by', null);
    await setSingle('located_in', locationId || null);
  };

  const linkedDocs = loreDocIds();
  const remainingDocs = documents.filter(d => !linkedDocs.includes(d.id));
  const loreEdit = (
    <>
      <Edit><SpoilerTextArea aria-label="Lore" rows={5} placeholder="History, secrets, texture." value={selected?.lore || ''} onChange={(e) => patch({ lore: e.target.value })} /></Edit>
      <div className="border-t border-border-subtle pt-3">
        <div className="flex items-center gap-2.5">
          <BookOpen className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden="true" />
          <span className="text-sm text-text-secondary">Writing Desk chapters</span>
          <span data-tooltip="Chapters written as canonical background. Ordinary mentions still reach the AI through the World Index." className="inline-flex text-text-subtle"><Info className="h-3.5 w-3.5" aria-label="About Writing Desk chapters" /></span>
          <span className="flex-1" />
          <EntityPickerButton label="Link chapter" title="Link a chapter" options={remainingDocs.map(d => ({ id: d.id, canonicalName: d.title }))} onPick={addLoreDoc} />
        </div>
        {linkedDocs.length > 0 && <div className="mt-2.5 flex flex-wrap gap-1.5">
          {linkedDocs.map(id => (
            <span key={id} className="inline-flex min-h-6 items-center gap-1.5 rounded-full border border-border-subtle bg-surface-hover/35 py-0.5 pl-2.5 pr-1 text-xs font-medium text-text-secondary">
              <ScrollText className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />{docTitle(id) || 'Untitled'}
              <button type="button" aria-label={`Unlink ${docTitle(id) || 'chapter'}`} onClick={() => removeLoreDoc(id)} className="rounded p-0.5 text-text-muted hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>}
      </div>
    </>
  );
  const loreEmpty = !String(selected?.lore || '').trim() && linkedDocs.length === 0;
  const loreView = (
    <>
      <Prose text={selected?.lore} />
      {linkedDocs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {linkedDocs.map(id => docTitle(id) && (
            <span key={id} className="inline-flex items-center gap-1.5 text-xs text-text-secondary"><ScrollText className="w-3.5 h-3.5 text-text-muted" />{docTitle(id)}</span>
          ))}
        </div>
      )}
    </>
  );

  // Each section is { key, title, icon, view, edit, scalar }.
  const sectionsFor = (type) => {
    const S = [];
    if (type === 'System') {
      S.push({ key: 'concept', spoiler: 'content', title: "Always in the AI's context", quiet: true, icon: AiGlyph, scalar: true, empty: !String(selected.data.content || '').trim(),
        view: <Prose text={selected.data.content} empty="No rules written yet." />,
        edit: <Edit label="Content"><SpoilerTextArea rows={10} placeholder="Rules and concepts of this universe the AI should always honor." value={selected.data.content || ''} onChange={(e) => patchData({ content: e.target.value })} /></Edit> });
    }
    if (type === 'Locations') {
      const size = locationSizeOf(selected);
      const parent = rel.inside?.entity?.id ? byType.Locations.find(o => o.id === rel.inside.entity.id) : null;
      // Largest first: a container is picked from the places that can hold this one.
      const parentOptions = byType.Locations
        .filter(o => o.id !== selected.id)
        .sort((a, b) => locationSizeRank(locationSizeOf(b)) - locationSizeRank(locationSizeOf(a)) || String(a.canonicalName).localeCompare(String(b.canonicalName)));
      S.push({ key: 'overview', title: 'Overview', icon: locationSizeIcon(size), scalar: true,
        view: <>
          <FactGrid columns={4}>
            <ViewField label="Size" spoiler="size" value={size ? <LocationSizeValue size={size} /> : null} />
            <ViewField label="Type" spoiler="locationType" value={selected.data.locationType} />
            <ViewField label="Inside" spoiler="inside" value={rel.inside?.entity ? <EntityChip entity={rel.inside.entity} onOpen={openEntityById} /> : null} />
            <ViewField label="Owner or leader" spoiler="leader" value={rel.leader?.entity ? <EntityChip entity={rel.leader.entity} onOpen={openEntityById} /> : null} />
          </FactGrid>
          <NestingWarning size={size} parent={parent} />
          <LongField label="Description" spoiler="description" text={selected.data.description} />
        </>,
        edit: <>
          <Edit label="Size" spoiler="size" hint={size ? `${locationSizeGuide(size)} Select it again to clear.` : 'How this place relates to a scene. Leave it empty if you are unsure.'}>
            <SegmentedControl
              label="Size"
              value={size}
              options={LOCATION_SIZE_OPTIONS.map(option => ({ value: option.value, label: option.label, icon: option.icon, tooltip: option.guide }))}
              onChange={(value) => patchData({ size: value === size ? null : value })}
            />
          </Edit>
          <Edit label="Type" spoiler="locationType" hint="Its kind in your own words."><LInput placeholder="e.g. kingdom, space station, tavern, bridge" value={selected.data.locationType || ''} onChange={(e) => patchData({ locationType: e.target.value })} /></Edit>
          <Edit label="Description" spoiler="description"><SpoilerTextArea rows={5} placeholder="What this place looks and feels like, including its defining features." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit>
          <SingleRelation label="Inside another place" spoiler="inside" hint="Nest this within a larger location." disabled={unsaved} current={rel.inside?.entity?.id} options={parentOptions} onSet={(id) => setSingle('inside', id)} />
          <NestingWarning size={size} parent={parent} />
          <SingleRelation label="Owner or leader" spoiler="leader" hint="Who holds or rules this place, if anyone." disabled={unsaved} current={rel.leader?.entity?.id} options={byType.Characters} onSet={(id) => setSingle('led_by', id)} />
        </> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, spoiler: 'lore', empty: loreEmpty, view: loreView, edit: loreEdit });
      const childIds = new Set(insideLinks.filter(link => link.toId === selected.id).map(link => link.fromId));
      const children = byType.Locations
        .filter(o => childIds.has(o.id))
        .sort((a, b) => locationSizeRank(locationSizeOf(b)) - locationSizeRank(locationSizeOf(a)) || String(a.canonicalName).localeCompare(String(b.canonicalName)));
      // Each child keeps its own "Inside another place"; adding here writes that link.
      const insideCandidates = byType.Locations.filter(o => o.id !== selected.id && !childIds.has(o.id));
      if (!unsaved) {
        S.push({ key: 'inside', title: 'Places inside', icon: ListTree, count: children.length || null, derived: true, relationalOnly: true,
          empty: !children.length, emptyNote: 'No places inside yet', emptyVerb: 'Add',
          right: <EntityPickerButton icon={Plus} label="Add" title="Put a place inside" options={insideCandidates} onPick={putPlaceInside} />,
          view: <div className="flex flex-wrap gap-1.5">{children.map(child => <EntityChip key={child.id} entity={child} onOpen={openEntityById} />)}</div> });
      }
    }
    if (type === 'Items') {
      S.push({ key: 'details', title: 'Details', icon: itemMeta(selected.data.itemType).icon, scalar: true,
        view: <>
          <FactGrid>
            <ViewField label="Nature" spoiler="itemNature" value={isUniqueItem ? 'Unique item' : 'Item type'} />
            <ViewField label="Category" spoiler="itemType" value={selected.data.itemType ? <span className="inline-flex items-center gap-1.5 text-sm text-text-primary">{React.createElement(itemMeta(selected.data.itemType).icon, { className: 'h-3.5 w-3.5 text-entity-item', 'aria-hidden': true })}{selected.data.itemType}</span> : null} />
            {isUniqueItem && <ViewField label="Owner" spoiler="owner" value={rel.ownedBy ? <EntityChip entity={rel.ownedBy.entity} onOpen={openEntityById} /> : <span className="inline-flex items-center gap-1.5 text-sm text-text-secondary">{selected?.data?.ownership === 'lost' ? <CircleHelp className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" /> : <AiGlyph className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />}{ownerLabel}</span>} />}
            {isUniqueItem && <ViewField label="Where it is" spoiler="location" value={rel.locatedIn?.entity?.canonicalName} empty={rel.ownedBy ? `In ${rel.ownedBy.entity.canonicalName}'s inventory` : 'Not set'} />}
            <ViewField label="Creator" spoiler="creator" value={rel.createdBy?.entity ? <EntityChip entity={rel.createdBy.entity} onOpen={openEntityById} /> : null} empty="Unknown" />
            {isItemType && <ViewField label="How common" spoiler="abundance" value={selected.data.abundance} />}
            {isItemType && <ViewField full label="Where found" spoiler="foundIn" value={<ChipList onOpen={openEntityById} links={rel.foundIn} empty="Not set" />} />}
            {isItemType && <ViewField full label="Where sold" spoiler="soldIn" value={<ChipList onOpen={openEntityById} links={rel.soldIn} empty="Not set" />} />}
          </FactGrid>
          <LongField label="Description" spoiler="description" text={selected.data.description} />
        </>,
        edit: <>
          <Edit label="Nature" spoiler="itemNature" hint={(selected.data.itemNature || 'type') === 'unique' ? 'A unique item exists only once, in one inventory or one place.' : 'An item type can exist in quantities.'}>
            <SegmentedControl label="Item nature" value={selected.data.itemNature || 'type'} onChange={(itemNature) => patchData({ itemNature })} options={[{ value: 'type', label: 'Item type' }, { value: 'unique', label: 'Unique item' }]} />
          </Edit>
          <div className={`grid grid-cols-1 gap-3 ${isItemType ? 'sm:grid-cols-2' : ''}`}>
          <Edit label="Category" spoiler="itemType">
            <SearchableSelect
              value={selected.data.itemType || ''}
              onChange={(itemType) => patchData({ itemType })}
              options={ITEM_TYPES.map(itemType => ({
                id: itemType,
                label: itemType,
                icon: itemMeta(itemType).icon,
                description: itemType === 'Resource' ? 'Natural resources and creature drops' : undefined,
              }))}
              placeholder="Choose a category…"
              searchPlaceholder="Filter item categories…"
              ariaLabel="Item category"
            />
          </Edit>
          {isItemType && <Edit label={<>How common <InfoPopover items={ABUNDANCE_HELP} /></>} spoiler="abundance"><ChoiceSelect label="How common" value={selected.data.abundance} onChange={(e) => patchData({ abundance: e.target.value })} options={RARITY} /></Edit>}
          </div>
          <SingleRelation label="Creator" spoiler="creator" hint="Leave blank if unknown." disabled={unsaved} current={rel.createdBy?.entity?.id} options={byType.Characters} onSet={(id) => setSingle('created_by', id)} />
          {isUniqueItem && !unsaved && <Edit label="Owner" spoiler="owner" hint="A unique item can be in one inventory or one world location.">
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={() => setOwner('ai')} aria-pressed={ownerVal === 'ai'} className={`inline-flex min-h-9 items-center gap-2 rounded-control border px-3 py-2 text-xs font-semibold transition-colors ${ownerVal === 'ai' ? 'border-border-strong bg-surface-hover text-text-primary' : 'border-border-default bg-surface-input/70 text-text-muted hover:border-border-strong hover:text-text-primary'}`}><AiGlyph className="h-3.5 w-3.5" />Decided by the AI</button>
              <button type="button" onClick={() => setOwner('lost')} aria-pressed={ownerVal === 'lost'} className={`inline-flex min-h-9 items-center gap-2 rounded-control border px-3 py-2 text-xs font-semibold transition-colors ${ownerVal === 'lost' ? 'border-border-strong bg-surface-hover text-text-primary' : 'border-border-default bg-surface-input/70 text-text-muted hover:border-border-strong hover:text-text-primary'}`}><CircleHelp className="h-3.5 w-3.5" />Unknown or lost</button>
              {rel.ownedBy && <div className="inline-flex min-h-9 items-center gap-2 rounded-control border border-border-strong bg-surface-hover px-3 py-2 text-xs font-semibold text-text-primary"><UserRound className="h-3.5 w-3.5" />{rel.ownedBy.entity.canonicalName}</div>}
              <EntityPickerButton icon={rel.ownedBy ? Replace : Plus} label={rel.ownedBy ? 'Change' : 'Choose entity'} title="Choose owner" options={ownerOptions} onPick={setOwner} />
            </div>
          </Edit>}
          {isUniqueItem && <SingleRelation label="Current location" spoiler="location" hint="Setting a location removes this item from its current inventory." disabled={unsaved} current={rel.locatedIn?.entity?.id} options={presenceLocations} onSet={setItemLocation} />}
          {isItemType && <MultiRelation label="Where found" spoiler="foundIn" hint="Places where this item type can be found, gathered, or obtained." disabled={unsaved} links={rel.foundIn || []} options={byType.Locations} onAdd={(id) => addMulti('found_in', id)} onRemove={removeLink} />}
          {isItemType && <MultiRelation label="Where sold" spoiler="soldIn" hint="Places where this item type can normally be purchased." disabled={unsaved} links={rel.soldIn || []} options={byType.Locations} onAdd={(id) => addMulti('sold_in', id)} onRemove={removeLink} />}
          <Edit label="Description" spoiler="description"><SpoilerTextArea rows={4} placeholder="What it looks like and does." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit>
        </> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, spoiler: 'lore', empty: loreEmpty, view: loreView, edit: loreEdit });
    }
    if (type === 'Races') {
      S.push({ key: 'desc', title: 'Description', icon: AlignLeft, scalar: true, spoiler: 'description', empty: !String(selected.data.description || '').trim(), view: <Prose text={selected.data.description} />, edit: <Edit><SpoilerTextArea aria-label="Description" rows={5} placeholder="Traits, appearance, culture." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit> });
      if (!unsaved && selected.status !== 'proposed') S.push({ key: 'roleplay', raw: <RaceRoleplayDefaults workspaceId={workspaceId} race={selected} api={electronAPI} showToast={showToast} /> });
      S.push({ key: 'members', title: 'Known members', icon: Users, scalar: false, derived: true, relationalOnly: true, count: rel.members?.length || null, empty: !(rel.members || []).length, emptyNote: 'Filled in as characters take this race',
        right: <span className="mr-2 text-xs text-text-subtle">Filled from each character's race</span>,
        view: <KnownMembers links={rel.members || []} portraits={portraits} onOpen={openEntityById} /> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, spoiler: 'lore', empty: loreEmpty, view: loreView, edit: loreEdit });
    }
    if (type === 'Creatures') {
      const natureOpts = [...new Set([...CREATURE_NATURES, ...byType.Creatures.filter(c => c.data?.scope === 'group').map(c => c.data?.nature).filter(Boolean)])];
      const isIndividual = (selected.data.scope || 'individual') !== 'group';
      S.push({ key: 'details', title: 'Details', icon: ListTree, scalar: true,
        view: <>
          <FactGrid>
            {!isIndividual && <ViewField label="Nature" spoiler="nature" value={selected.data.nature} />}
            {isIndividual && <ViewField label="Species" spoiler="race" value={rel.isRace?.entity ? <button type="button" onClick={() => openEntityById(rel.isRace.entity.id)} className="rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{rel.isRace.entity.canonicalName}</button> : null} />}
            <ViewField label="Disposition" spoiler="disposition" value={<StateTag map={DISPOSITION} value={selected.data.disposition || 'unknown'} />} />
            {!isIndividual && <ViewField label="How common" spoiler="abundance" value={selected.data.abundance} />}
            <ViewField label="Threat" spoiler="threat" value={selected.data.threat} />
            {isIndividual && <ViewField label="Born" spoiler="birthDate" value={formatWorldDate(worldCalendar, selected.data.birthDate)} />}
            {isIndividual && selected.data.status === 'deceased' && <ViewField label="Died" spoiler="deathDate" value={formatWorldDate(worldCalendar, selected.data.deathDate)} />}
            {isIndividual && selected.data.status === 'missing' && <ViewField label="Disappeared" spoiler="missingDate" value={formatWorldDate(worldCalendar, selected.data.missingDate)} />}
            <ViewField label="Habitat" spoiler="foundIn" value={(rel.foundIn || []).length ? <ChipList onOpen={openEntityById} links={rel.foundIn} /> : null} />
          </FactGrid>
          <LongField label="Abilities and traits" spoiler="abilities" text={selected.data.abilities} />
        </>,
        edit: <>
          <Edit label="This creature is" spoiler="scope">
            <SegmentedControl label="Creature shape" value={selected.data.scope || 'individual'} onChange={(scope) => patchData({ scope })} options={[{ value: 'individual', label: 'A specific being' }, { value: 'group', label: 'A group or species' }]} />
            <Hint>A species has no single life. One tamed wolf does.</Hint>
            {isIndividual && (rel.inventory?.length || 0) + (rel.relationships?.length || 0) > 0 && (
              <Hint>Turning this into a group hides its inventory, connections and knowledge. Nothing is deleted, and switching back brings them into view again.</Hint>
            )}
          </Edit>
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
            {isIndividual
              ? <SingleRelation label="Species" spoiler="race" disabled={unsaved} current={rel.isRace?.entity?.id} options={byType.Creatures.filter(creature => creature.data?.scope === 'group' && creature.id !== selected.id)} onSet={(id) => setSingle('is_race', id)} />
              : <Edit label="Nature" spoiler="nature"><FreeDatalist value={selected.data.nature} onChange={(e) => patchData({ nature: e.target.value })} options={natureOpts} placeholder="e.g. Beast, Spirit, Deity" /></Edit>}
            <Edit label="Threat" spoiler="threat"><ChoiceSelect label="Threat" value={selected.data.threat} onChange={(e) => patchData({ threat: e.target.value })} options={THREAT} /></Edit>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Edit label="Disposition" spoiler="disposition"><StateSelect label="Disposition" map={DISPOSITION} value={selected.data.disposition || 'unknown'} onChange={(e) => patchData({ disposition: e.target.value })} /></Edit>
            {isIndividual && <Edit label="Status" spoiler="status"><StateSelect label="Status" map={STATUS} value={selected.data.status || 'unknown'} onChange={(e) => patchData({ status: e.target.value })} /></Edit>}
            {!isIndividual && <Edit label={<>How common <InfoPopover items={ABUNDANCE_HELP} /></>} spoiler="abundance"><ChoiceSelect label="How common" value={selected.data.abundance} onChange={(e) => patchData({ abundance: e.target.value })} options={RARITY} /></Edit>}
            {isIndividual && worldCalendar && <div className={selected.data.birthDate ? 'sm:col-span-3' : ''}><Edit label="Born" spoiler="birthDate"><WorldDateInput label="Birth date" emptyLabel="Set date" calendar={worldCalendar} value={selected.data.birthDate} onChange={birthDate => patchData({ birthDate })} /></Edit></div>}
          </div>
          <Edit label="Abilities and traits" spoiler="abilities" hint="Short, concrete powers the AI can use in a scene."><SpoilerTextArea rows={3} placeholder="e.g. flies, breathes fire, immune to steel." value={selected.data.abilities || ''} onChange={(e) => patchData({ abilities: e.target.value })} /></Edit>
          {isIndividual && worldCalendar && <Checkbox checked={Boolean(selected.data.showBirthday)} onChange={showBirthday => patchData({ showBirthday })} label="Show the birthday on the calendar" />}
          {isIndividual && selected.data.status === 'deceased' && worldCalendar && <Edit label="Death date" spoiler="deathDate"><WorldDateInput label="Death date" emptyLabel="Set death date" calendar={worldCalendar} value={selected.data.deathDate} onChange={deathDate => patchData({ deathDate })} /></Edit>}
          {isIndividual && selected.data.status === 'missing' && worldCalendar && <Edit label="Disappearance date" spoiler="missingDate"><WorldDateInput label="Disappearance date" emptyLabel="Set disappearance date" calendar={worldCalendar} value={selected.data.missingDate} onChange={missingDate => patchData({ missingDate })} /></Edit>}
          <MultiRelation label="Habitat" spoiler="foundIn" hint="Where it is found or dwells." disabled={unsaved} links={rel.foundIn || []} options={byType.Locations} onAdd={(id) => addMulti('found_in', id)} onRemove={removeLink} />
        </> });
      // A species has a shared look worth describing, but no single temperament: a
      // personality belongs to one being, never to every member of a kind.
      S.push({ key: 'appearance', title: 'Appearance', icon: ScanFace, scalar: true, spoiler: 'appearance', empty: !String(selected.data.appearance || '').trim(), view: <Prose text={selected.data.appearance} />, edit: <Edit hint={isIndividual ? undefined : 'What members of this kind typically look like.'}><SpoilerTextArea aria-label="Appearance" rows={5} placeholder={isIndividual ? 'Physical presence and distinguishing features.' : 'Shared build, markings, and distinguishing features.'} value={selected.data.appearance || ''} onChange={(e) => patchData({ appearance: e.target.value })} /></Edit> });
      if (!isIndividual && !unsaved && selected.status !== 'proposed') S.push({ key: 'roleplay', raw: <RaceRoleplayDefaults workspaceId={workspaceId} race={selected} api={electronAPI} showToast={showToast} /> });
      if (!isIndividual) S.push({ key: 'members', title: 'Known members', icon: Users, scalar: false, derived: true, relationalOnly: true, count: rel.members?.length || null, empty: !(rel.members || []).length, emptyNote: 'Filled in as specific beings take this species',
        right: <span className="mr-2 text-xs text-text-subtle">Filled from each specific being's species</span>,
        view: <KnownMembers links={rel.members || []} portraits={portraits} onOpen={openEntityById} /> });
      if (isIndividual) S.push({ key: 'personality', title: 'Personality', icon: Drama, scalar: true, spoiler: 'personality', empty: !String(selected.data.personality || '').trim(), view: <Prose text={selected.data.personality} />, edit: <Edit><SpoilerTextArea aria-label="Personality" rows={5} placeholder="Temperament, instincts, habits, and values." value={selected.data.personality || ''} onChange={(e) => patchData({ personality: e.target.value })} /></Edit> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, spoiler: 'lore', empty: loreEmpty, view: loreView, edit: loreEdit });
    }
    if (type === 'Factions') {
      S.push({ key: 'desc', title: 'Description', icon: AlignLeft, scalar: true, spoiler: 'description', empty: !String(selected.data.description || '').trim(), view: <Prose text={selected.data.description} />, edit: <Edit><SpoilerTextArea aria-label="Description" rows={5} placeholder="Goals, structure, reputation." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, spoiler: 'lore', empty: loreEmpty, view: loreView, edit: loreEdit });
    }
    if (type === 'Events') {
      const kindOpts = ['Battle', 'Festival', 'Holiday', 'Disaster', 'Ceremony', 'Discovery'];
      S.push({ key: 'overview', title: 'Overview', icon: Info, scalar: true,
        view: <>
          <FactGrid>
            <ViewField label="How often" spoiler="eventNature" value={(selected.data.eventNature || 'one-time') === 'recurring' ? 'Recurring' : 'Once'} />
            <ViewField label="Kind" spoiler="kind" value={selected.data.kind} />
            {(selected.data.eventNature || 'one-time') === 'recurring'
              ? <ViewField full label="Schedule" spoiler="date" value={recurrenceText(selected.data.recurrence, worldCalendar)} />
              : <ViewField full label="Date" spoiler="date" value={selected.data.startDate ? `${formatWorldDate(worldCalendar, selected.data.startDate)}${selected.data.endDate ? ` to ${formatWorldDate(worldCalendar, selected.data.endDate)}` : ''}` : null} />}
            <ViewField full label="Where" spoiler="happenedAt" value={<ChipList onOpen={openEntityById} links={rel.happenedAt} empty="No place set." />} />
            <ViewField full label="Who took part" spoiler="involved" value={<ChipList onOpen={openEntityById} links={rel.involved} empty="No one set." />} />
          </FactGrid>
        </>,
        edit: <>
          <Edit label="How often" spoiler="eventNature">
            <SegmentedControl label="How often" value={selected.data.eventNature || 'one-time'} onChange={(eventNature) => patchData({ eventNature })} options={[{ value: 'one-time', label: 'Once' }, { value: 'recurring', label: 'Recurring' }]} />
          </Edit>
          <Edit label="Kind" spoiler="kind" hint="Type your own or reuse one."><FreeDatalist value={selected.data.kind} onChange={(e) => patchData({ kind: e.target.value })} options={kindOpts} placeholder="e.g. Battle, Festival, Holiday" /></Edit>
          {worldCalendar && (selected.data.eventNature || 'one-time') === 'recurring' ? (
            <>
              <Edit label="First time" spoiler="date"><WorldDateInput label="First time" emptyLabel="Set the first occurrence" calendar={worldCalendar} value={selected.data.recurrence?.anchorDate} onChange={anchorDate => patchData({ recurrence: { ...(selected.data.recurrence || {}), anchorDate } })} /></Edit>
              <Edit label="Repeats every" spoiler="date"><div className="grid grid-cols-[7rem_1fr] gap-2"><NumberInput className={FIELD} min={1} value={selected.data.recurrence?.interval || 1} onChange={interval => patchData({ recurrence: { ...(selected.data.recurrence || {}), interval } })} /><SelectMenu ariaLabel="Repeat unit" value={selected.data.recurrence?.unit || 'year'} onChange={unit => patchData({ recurrence: { ...(selected.data.recurrence || {}), unit } })} options={[{ value: 'day', label: 'Days' }, { value: 'week', label: 'Weeks' }, { value: 'month', label: 'Months' }, { value: 'year', label: 'Years' }]} /></div></Edit>
            </>
          ) : worldCalendar ? (
            <>
              <div className={`grid grid-cols-1 gap-3 ${selected.data.startDate || selected.data.endDate ? '' : 'sm:grid-cols-2'}`}>
                <Edit label="Starts" spoiler="date"><WorldDateInput label="Starts" emptyLabel="Set date" calendar={worldCalendar} value={selected.data.startDate} onChange={startDate => patchData({ startDate })} /></Edit>
                <Edit label="Ends" spoiler="date" hint="Leave empty for a single day."><WorldDateInput label="Ends" emptyLabel="Add end date" calendar={worldCalendar} value={selected.data.endDate} onChange={endDate => patchData({ endDate })} /></Edit>
              </div>
            </>
          ) : null}
          {!unsaved && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MultiRelation label="Where" spoiler="happenedAt" disabled={unsaved} links={rel.happenedAt || []} options={byType.Locations} onAdd={(id) => addMulti('happened_at', id)} onRemove={removeLink} />
            <MultiRelation label="Who took part" spoiler="involved" disabled={unsaved} links={rel.involved || []} options={byType.Characters} onAdd={(id) => addMulti('involved', id)} onRemove={removeLink} />
          </div>}
        </> });
      S.push({ key: 'desc', title: 'Description', icon: AlignLeft, scalar: true, spoiler: 'description', empty: !String(selected.data.description || '').trim(), view: <Prose text={selected.data.description} />, edit: <Edit><SpoilerTextArea aria-label="Description" rows={5} placeholder="What happened, and why it matters." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, spoiler: 'lore', empty: loreEmpty, view: loreView, edit: loreEdit });
    }
    return S;
  };

  // Belonging reads the same whoever is doing it, so the section is written once and both
  // the character sheet and a specific being's sheet render it.
  const membershipSection = (hint) => {
    const pastFactions = rel.formerMemberOf || [];
    const membershipRow = (link, former) => {
      const since = formatWorldDate(worldCalendar, link.metadata?.joined);
      return (
        <SpoilerRow key={link.linkId} field={`link:${link.linkId}`} editing={editingSection === 'fac'}>
        <button type="button" onClick={() => openEntityById(link.entity.id)}
          className={`flex w-full items-center gap-3 rounded-control py-1.5 text-left transition-colors hover:bg-surface-hover/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${former ? 'opacity-70' : ''}`}>
          <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${meta('Factions').medallion}`}><Flag className="h-3.5 w-3.5" /></span>
          <span className={`truncate text-sm font-semibold ${former ? 'text-text-secondary' : 'text-text-primary'}`}>{link.entity.canonicalName}</span>
          {link.label && <span className="min-w-0 truncate text-sm text-text-muted">{link.label}</span>}
          <span className="flex-1" />
          <span className="shrink-0 text-xs text-text-subtle">{former ? 'Former member' : since ? `Since ${since}` : ''}</span>
        </button>
        </SpoilerRow>
      );
    };
    return { key: 'fac', title: 'Factions', icon: Flag, scalar: false, emptyVerb: 'Add', spoiler: 'factions',
      empty: !(rel.memberOf || []).length && !pastFactions.length,
      view: <div className="space-y-0.5">
        {(rel.memberOf || []).map(link => membershipRow(link, false))}
        {pastFactions.map(link => membershipRow(link, true))}
      </div>,
      edit: <>
        <MultiRelation label="Factions" hint={hint} disabled={unsaved} links={rel.memberOf || []} options={byType.Factions} onAdd={(id) => addMulti('member_of', id)} onRemove={removeLink} />
        {pastFactions.length > 0 && <Edit label="Former factions" hint="Departures are recorded on the faction sheet."><div className="space-y-0.5">{pastFactions.map(link => membershipRow(link, true))}</div></Edit>}
      </> };
  };

  const characterSections = () => {
    if (charTab === 'data') return [
      { key: 'identity', title: 'Identity', icon: IdCard, scalar: true,
        view: <>
          <FactGrid>
            <ViewField label="Race" spoiler="race" value={rel.isRace?.entity ? <EntityChip entity={rel.isRace.entity} onOpen={openEntityById} /> : null} />
            <ViewField label="Age" spoiler="age" value={selected.data.age} />
            <ViewField label="Born" spoiler="birthDate" value={formatWorldDate(worldCalendar, selected.data.birthDate)} />
            {selected.data.status === 'deceased' && <ViewField label="Died" spoiler="deathDate" value={formatWorldDate(worldCalendar, selected.data.deathDate)} />}
            {selected.data.status === 'missing' && <ViewField label="Disappeared" spoiler="missingDate" value={formatWorldDate(worldCalendar, selected.data.missingDate)} />}
          </FactGrid>
        </>,
        edit: <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Edit label="Status" spoiler="status"><StateSelect label="Status" map={STATUS} value={selected.data.status || 'unknown'} onChange={(e) => patchData({ status: e.target.value })} /></Edit>
            <Edit label="Age" spoiler="age"><LInput placeholder="e.g. 34" value={selected.data.age || ''} onChange={(e) => patchData({ age: e.target.value })} /></Edit>
            {worldCalendar && <div className={selected.data.birthDate ? 'sm:col-span-3' : ''}><Edit label="Born" spoiler="birthDate">
              <WorldDateInput label="Birth date" emptyLabel="Set date" calendar={worldCalendar} value={selected.data.birthDate} onChange={birthDate => patchData({ birthDate })} />
            </Edit></div>}
          </div>
          {worldCalendar && <Checkbox checked={Boolean(selected.data.showBirthday)} onChange={showBirthday => patchData({ showBirthday })} label="Show the birthday on the calendar" />}
          <SingleRelation label="Race" spoiler="race" disabled={unsaved} current={rel.isRace?.entity?.id} options={byType.Races} onSet={(id) => setSingle('is_race', id)} />
          {selected.data.status === 'deceased' && worldCalendar && <Edit label="Death date" spoiler="deathDate"><WorldDateInput label="Death date" emptyLabel="Set death date" calendar={worldCalendar} value={selected.data.deathDate} onChange={deathDate => patchData({ deathDate })} /></Edit>}
          {selected.data.status === 'missing' && worldCalendar && <Edit label="Disappearance date" spoiler="missingDate"><WorldDateInput label="Disappearance date" emptyLabel="Set disappearance date" calendar={worldCalendar} value={selected.data.missingDate} onChange={missingDate => patchData({ missingDate })} /></Edit>}
        </> },
      { key: 'appearance', title: 'Appearance', icon: ScanFace, scalar: true, spoiler: 'appearance', empty: !String(selected.data.appearance || '').trim(), view: <Prose text={selected.data.appearance} />, edit: <Edit><SpoilerTextArea aria-label="Appearance" rows={5} placeholder="Physical presence, clothing, and distinguishing features." value={selected.data.appearance || ''} onChange={(e) => patchData({ appearance: e.target.value })} /></Edit> },
      { key: 'personality', title: 'Personality', icon: Drama, scalar: true, spoiler: 'personality', empty: !String(selected.data.personality || '').trim(), view: <Prose text={selected.data.personality} />, edit: <Edit><SpoilerTextArea aria-label="Personality" rows={5} placeholder="Temperament, habits, values, and contradictions." value={selected.data.personality || ''} onChange={(e) => patchData({ personality: e.target.value })} /></Edit> },
      { key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, spoiler: 'lore', empty: loreEmpty, view: loreView, edit: loreEdit },
    ];
    if (charTab === 'inventory') return [
      { key: 'inv', raw: <WorldbuildInventory workspaceId={workspaceId} subject={selected} links={rel.inventory || []} options={byType.Items} api={electronAPI} showToast={showToast} onChanged={() => loadRelations(selected)} /> },
    ];
    return [
      membershipSection('Groups this character belongs to.'),
      placesSection('character', true),
      { key: 'rels', raw: <WorldbuildRelationships workspaceId={workspaceId} subject={selected} links={rel.relationships || []} options={[...byType.Characters, ...individualCreatures]} api={electronAPI} showToast={showToast} onChanged={() => loadRelations(selected)} /> },
    ];
  };

  // Faction sheet mirrors the Character one: Data holds what a faction is, the
  // connections tab holds who it is made of and how it stands with the world.
  const factionSections = () => {
    if (charTab !== 'connections') return sectionsFor('Factions');
    const leaderId = rel.leader?.entity?.id;
    const founders = [...(rel.members || []), ...(rel.formerMembers || [])].filter(link => link.metadata?.founder);
    // A roster is not only people: a bonded mount, a familiar or a dragon at the head of a
    // cult belongs to the group as much as any of its members do.
    const candidates = [...byType.Characters, ...individualCreatures];
    const roster = (editing) => (
      <MemberList links={rel.members} calendar={worldCalendar} leaderId={leaderId} editing={editing}
        options={candidates} onOpen={openEntityById} onAdd={(id) => addMulti('member_of', id, false)}
        onSetRole={setMemberRole} onSetMeta={setMemberMeta} onSetFormer={markFormerMember} onRemove={removeLink}
        empty="No members yet." />
    );
    return [
      { key: 'overview', title: 'Command and territory', icon: Crown, scalar: true,
        view: <FactGrid>
          <ViewField label="Leader" spoiler="leader" value={rel.leader?.entity ? <EntityChip entity={rel.leader.entity} onOpen={openEntityById} /> : null} />
          <ViewField label="Founded" spoiler="founded" value={formatWorldDate(worldCalendar, selected.data.foundedDate)} empty="Unknown" />
          <ViewField label="Founded by" spoiler="foundedBy" value={founders.length
            ? <div className="flex flex-wrap gap-1.5">{founders.map(link => <EntityChip key={link.linkId} entity={link.entity} onOpen={openEntityById} />)}</div>
            : null} empty="Not recorded" />
          <ViewField full label="Area of operation" spoiler="area" value={<ChipList onOpen={openEntityById} links={rel.operatesIn} empty="No territory set." />} />
        </FactGrid>,
        edit: <>
          <SingleRelation label="Leader (optional)" spoiler="leader" hint="Who heads this faction. They join the roster automatically, with an editable rank." disabled={unsaved} current={leaderId} options={candidates} onSet={setFactionLeader} />
          {worldCalendar && <Edit label="Founded" spoiler="founded" hint="When this faction came into being."><WorldDateInput label="Founded" emptyLabel="Set founding date" calendar={worldCalendar} value={selected.data.foundedDate} onChange={foundedDate => patchData({ foundedDate })} /></Edit>}
          <Edit label="Founded by" spoiler="foundedBy" hint="Mark a founder with the star on their row in Members or Former members.">
            {founders.length
              ? <div className="flex flex-wrap gap-1.5">{founders.map(link => <EntityChip key={link.linkId} entity={link.entity} onOpen={openEntityById} />)}</div>
              : <span className="caption">Nobody marked yet.</span>}
          </Edit>
          <MultiRelation label="Area of operation" spoiler="area" hint="Locations this faction works out of." disabled={unsaved} links={rel.operatesIn || []} options={byType.Locations} onAdd={(id) => addMulti('operates_in', id)} onRemove={removeLink} />
        </> },
      { key: 'members', title: 'Members', icon: Users, scalar: false, spoiler: 'members', count: rel.members?.length || null, emptyVerb: 'Add', empty: !(rel.members || []).length,
        view: roster(false),
        edit: unsaved ? null : roster(true) },
      { key: 'formerMembers', title: 'Former members', icon: UserMinus, scalar: false, spoiler: 'formerMembers', empty: !(rel.formerMembers || []).length, derived: !(rel.formerMembers || []).length,
        view: <MemberList links={rel.formerMembers} calendar={worldCalendar} kind="former" onOpen={openEntityById} empty="Nobody has left yet." />,
        edit: <div>
          <p className="caption mb-2">They keep what they already knew. From here on, whatever the faction shares with all members no longer reaches them.</p>
          <MemberList links={rel.formerMembers} calendar={worldCalendar} kind="former" editing onOpen={openEntityById}
            onSetRole={setFormerRole} onSetMeta={setMemberMeta} onRestore={restoreMember} onRemove={removeLink}
            empty="Nobody has left yet." />
        </div> },
      { key: 'diplomacy', raw: <WorldbuildRelationships title="Relations" workspaceId={workspaceId} subject={selected} links={rel.relationships || []} options={[...byType.Factions.filter(entity => entity.id !== selected.id), ...byType.Characters, ...individualCreatures]} api={electronAPI} showToast={showToast} onChanged={() => loadRelations(selected)} /> },
    ];
  };

  // Local to says where someone knows what everyone knows; only a Region or Area holds that.
  const placesSection = (noun, withTies) => {
    const localTo = rel.localTo || [];
    const tied = withTies ? rel.connectedTo || [] : [];
    return {
      key: 'loc', title: 'Places', icon: MapPin, scalar: false, spoiler: 'places', emptyVerb: 'Add', empty: !localTo.length && !tied.length,
      view: <div className="space-y-4">
        <ViewField label="Local to" spoiler="localTo" empty="Local nowhere yet." value={localTo.length ? <ChipList onOpen={openEntityById} links={localTo} /> : null} />
        {withTies && <ViewField label="Tied to" empty="Tied to no place." value={tied.length ? <ChipList onOpen={openEntityById} links={tied} /> : null} />}
      </div>,
      edit: <>
        <MultiRelation label="Local to" spoiler="localTo" hint={`Regions and Areas this ${noun} is from. In play they know what everyone there knows.`} disabled={unsaved} links={localTo} options={sharingLocations} onAdd={(id) => addMulti('local_to', id)} onRemove={removeLink} />
        {withTies && <MultiRelation label="Tied to" hint={`Places this ${noun} is tied to.`} disabled={unsaved} links={tied} options={byType.Locations} onAdd={(id) => addMulti('connected_to', id)} onRemove={removeLink} />}
      </>,
    };
  };

  const individualCreatureSections = () => {
    if (charTab === 'inventory') return [{ key: 'inv', raw: <WorldbuildInventory workspaceId={workspaceId} subject={selected} links={rel.inventory || []} options={byType.Items} api={electronAPI} showToast={showToast} onChanged={() => loadRelations(selected)} /> }];
    if (charTab === 'connections') return [
      membershipSection('Groups this being belongs to. A pack, a cult, or the household that keeps it.'),
      placesSection('being', false),
      { key: 'rels', raw: <WorldbuildRelationships workspaceId={workspaceId} subject={selected} links={rel.relationships || []} options={[...byType.Characters, ...individualCreatures]} api={electronAPI} showToast={showToast} onChanged={() => loadRelations(selected)} /> },
    ];
    // Appearance and personality are part of the Creatures sheet itself, which decides
    // per variant which of the two a being can hold.
    return sectionsFor('Creatures');
  };

  // Template fields for one section. Before the first save the entity has no row to
  // write to, so the inputs feed the draft and ride along with the create payload.
  const customFieldsFor = (sectionId, editing = false, part) => (
    <WorldbuildCustomFields part={part}
      workspaceId={workspaceId} entity={selected} entities={entities} api={electronAPI} showToast={showToast}
      definitions={fieldDefinitions}
      onEntityChange={applyIntegratedEntity} onDraftChange={(customFields) => patchData({ customFields })}
      template={activeTemplate} sectionId={sectionId} embedded editing={editing}
    />
  );
  // What a section holds from the template, and whether any of it is filled.
  const customFieldsIn = (sectionId) => fieldsForSection(fieldDefinitions, activeTemplate, sectionId);
  const customFilledIn = (sectionId) => customFieldsIn(sectionId).some(definition => isFilledValue(selected?.data?.customFields?.[definition.key] ?? definition.defaultValue));
  // Template sections are ordinary sections with no native fields of their own.
  const templateSection = (id, title) => ({ key: id, title, icon: Braces, scalar: true, custom: true, view: null, edit: null });
  const customizeSections = (source) => {
    const loose = charTab === 'data' && customFieldsIn('custom-fields').length ? [templateSection('custom-fields', 'More details')] : [];
    if (!templateSections.length) return [...source, ...loose];
    const positions = new Map(templateSections.map((section, index) => [section.id, index]));
    const custom = charTab === 'data' ? templateSections.filter(section => section.kind === 'custom' && !section.hidden).map(section => templateSection(section.id, section.label)) : [];
    return [...source, ...custom, ...loose]
      .filter(section => !sectionSetting(section.key)?.hidden)
      .map(section => ({ ...section, title: sectionSetting(section.key)?.label || section.title }))
      .sort((left, right) => (positions.get(left.key) ?? 999) - (positions.get(right.key) ?? 999));
  };
  const sections = selected
    ? (charTab === 'knowledge' && hasKnowledgeTab) || (charTab === 'occurrences' && hasOccurrencesTab)
      ? []
      : customizeSections(selected.type === 'Characters' ? characterSections() : isIndividualCreature ? individualCreatureSections() : isFaction ? factionSections() : sectionsFor(selected.type))
    : [];
  const m = selected ? concreteEntityMeta(selected) : null;
  const hasLifeStatus = selected?.type === 'Characters' || isIndividualCreature;
  const reviewSwitcher = charTab === 'review' && hasEntityReview && hasNarrativeReview ? (
    <SegmentedControl label="Kind of suggestion" value={reviewKind} onChange={setReviewKind}
      options={[
        { value: 'entity', label: 'Sheet updates', icon: ScanEye, count: selectedReviewCounts.entityUpdates },
        { value: 'narrative', label: 'Narrative state', icon: AiGlyph, count: selectedReviewCounts.narrative },
      ]} />
  ) : null;
  const sheetBeingRead = !!readingEntityId && readingEntityId === selected?.id;
  const portraitAllowed = !isNew && !!selected?.id && canHavePortrait(selected);
  const sheetPortrait = portraitAllowed ? portraits[selected.id] || null : null;
  const coverAllowed = !isNew && !!selected?.id && selectedIsLocation && selected.status !== 'proposed' && !!electronAPI.uploadRoleplayLocationBackground;
  const coverStyle = coverAllowed ? framedImageStyle(locationCover) : undefined;
  // The shape of this sheet, read beside its type: a unique item, a species, a place's scale.
  // The type line names the kind in the type's colour ("Item · weapon"), then a quieter fact.
  const sheetTypeLabel = !selected ? ''
    : selected.type === 'Creatures' ? `Creature · ${isIndividualCreature ? 'specific being' : 'group or species'}`
    : selected.type === 'Items' && selected.data?.itemType ? `Item · ${String(selected.data.itemType).toLowerCase()}`
    : m?.label;
  const sheetVariantLabel = !selected ? null
    : selected.type === 'Locations' ? (locationSizeLabel(locationSizeOf(selected)) || null)
    : selected.type === 'Events' ? ((selected.data?.eventNature || 'one-time') === 'recurring'
      ? recurrenceText(selected.data?.recurrence, worldCalendar) || 'Recurring'
      : selected.data?.startDate ? formatWorldDate(worldCalendar, selected.data.startDate) : null)
    : null;
  const tabCounts = {
    knowledge: sideCounts.entityId === selected?.id ? sideCounts.knowledge : null,
    occurrences: sideCounts.entityId === selected?.id ? sideCounts.occurrences : null,
    inventory: rel.inventory?.length || 0,
    connections: isFaction
      ? (rel.members?.length || 0)
      : (rel.memberOf?.length || 0) + (rel.connectedTo?.length || 0) + (rel.localTo?.length || 0) + (rel.relationships?.length || 0),
  };
  const nameLabel = selected?.type === 'System' ? 'Title' : 'Name';
  const showAliases = !!selected;

  // The AI's marks on a row, in a fixed order so a list scans the same way every time.
  const entitySignals = (entity) => <>
    {enrichProgress?.entityId === entity.id && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" aria-label="Being read by the AI" />}
    {enrichErrors.some(error => error.entityId === entity.id) && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-status-danger" data-tooltip="The last update failed" />}
    {entity.status === 'proposed' && <AiGlyph className="h-3.5 w-3.5 shrink-0 text-status-warning" data-tooltip="Proposed by the AI" />}
    {entity.status !== 'proposed' && (reviewCounts[entity.id]?.entityUpdates || 0) > 0 && <ScanEye className="h-3.5 w-3.5 shrink-0 text-status-info" data-tooltip={`${reviewCounts[entity.id].entityUpdates} suggested updates`} />}
    {entity.status !== 'proposed' && (reviewCounts[entity.id]?.narrative || 0) > 0 && <AiGlyph className="h-3.5 w-3.5 shrink-0 text-entity-event" data-tooltip={`${reviewCounts[entity.id].narrative} Narrative state suggestions`} />}
    {nameReview.has(entity.id) && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-status-warning" data-tooltip={describeNameReview(nameReview.get(entity.id)[0])} />}
  </>;

  // One row: the type icon, or the checkbox in its place while selecting several. A place
  // with places inside carries its expand toggle at the right edge, so every row starts aligned.
  const entityRow = (entity, { icon, sizeTip, trailing, toggle } = {}) => {
    const t = concreteEntityMeta(entity);
    const Icon = icon || t.icon;
    const active = selected?.id === entity.id;
    const picked = selectedIds.has(entity.id);
    const status = (entity.type === 'Characters' || (entity.type === 'Creatures' && (entity.data?.scope || 'individual') !== 'group')) && STATUS_TONE[entity.data?.status]
      && !hiddenFields(entity.data).includes('status') ? entity.data.status : null;
    return (
      <div className="relative">
        <button type="button" onClick={() => manageMode ? toggleEntitySelection(entity.id) : openEntity(entity)} aria-pressed={manageMode ? picked : undefined}
          className={`group flex min-h-9 w-full items-center gap-2.5 rounded-control py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 pl-2 ${trailing || toggle ? 'pr-9' : 'pr-2'} ${active && !manageMode ? 'bg-accent/[0.13]' : picked ? 'bg-surface-hover/70' : 'hover:bg-surface-hover/60'}`}>
          {manageMode && <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-[1.5px] ${picked ? 'border-accent bg-accent text-on-accent' : 'border-border-strong'}`}>{picked && <Check className="h-3 w-3" strokeWidth={3} />}</span>}
          {portraits[entity.id]?.imagePath && canHavePortrait(entity)
              ? <span aria-hidden="true" className="block h-6 w-6 shrink-0 rounded-md border border-border-default" style={framedImageStyle(portraits[entity.id])} />
              : <span data-tooltip={sizeTip} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${t.medallion}`}><Icon className="h-3.5 w-3.5" /></span>}
          <span className={`min-w-0 flex-1 truncate text-sm font-medium ${active && !manageMode ? 'text-accent' : 'text-text-secondary group-hover:text-text-primary'}`}>{entity.canonicalName}</span>
          {status && <span className={`shrink-0 text-xs ${STATUS_TONE[status]}`}>{STATUS[status].label}</span>}
          {entitySignals(entity)}
        </button>
        {toggle && <span className="absolute right-1 top-1/2 -translate-y-1/2">{toggle}</span>}
        {trailing}
      </div>
    );
  };
  const renderEntityButton = (en) => <React.Fragment key={en.id}>{entityRow(en)}</React.Fragment>;

  const renderLocationNode = (node, isNested = false, isLast = false) => {
    const { entity, children } = node;
    const hasChildren = children.length > 0;
    const isExpanded = expandedLocations[entity.id] !== false;
    const sizeLabel = locationSizeLabel(locationSizeOf(entity));
    return (
      <div key={entity.id} className={`relative ${isNested ? 'pl-4' : ''}`}>
        {isNested && (isLast
          ? <span aria-hidden="true" className="absolute left-0 top-0 h-[1.125rem] w-3 rounded-bl-sm border-b border-l border-entity-location/25" />
          : <>
              <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 border-l border-entity-location/25" />
              <span aria-hidden="true" className="absolute left-0 top-[1.125rem] w-3 border-t border-entity-location/25" />
            </>)}
        {entityRow(entity, {
          sizeTip: sizeLabel ? `${sizeLabel}: ${locationSizeGuide(locationSizeOf(entity))}` : undefined,
          toggle: hasChildren ? <button type="button" onClick={() => toggleLocation(entity.id)} aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${entity.canonicalName}`} aria-expanded={isExpanded}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover/60 hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
          </button> : null,
        })}
        {hasChildren && isExpanded && (
          <div className="relative ml-5 py-0.5">
            {children.map((child, index) => renderLocationNode(child, true, index === children.length - 1))}
          </div>
        )}
      </div>
    );
  };

  // With nothing filtered, the list reads as groups by type, each one foldable.
  const locationParents = (() => {
    const ids = [];
    const walk = (nodes) => nodes.forEach(node => { if (node.children.length) { ids.push(node.entity.id); walk(node.children); } });
    walk(locationTree);
    return ids;
  })();
  const allLocationsCollapsed = locationParents.length > 0 && locationParents.every(id => expandedLocations[id] === false);
  const toggleAllLocations = () => setExpandedLocations(allLocationsCollapsed ? {} : Object.fromEntries(locationParents.map(id => [id, false])));
  const groupOpen = (type) => Boolean(filterType) || !collapsedGroups.has(type);
  const groupHead = (type, count) => {
    const open = groupOpen(type);
    const label = <>
      <span className="eyebrow">{typeMeta(type).plural || `${typeMeta(type).label}s`}</span>
      <span className="text-xs tabular-nums text-text-disabled">{count}</span>
    </>;
    return (
      <div key={`head-${type}`} className="flex items-center gap-1 pr-1">
      {filterType
        ? <div className="flex w-full items-center gap-1.5 px-2 pb-1.5 pt-3.5 text-text-subtle">{label}</div>
        : <button type="button" aria-expanded={open} onClick={() => setCollapsedGroups(current => { const next = new Set(current); if (next.has(type)) next.delete(type); else next.add(type); return next; })}
          className="flex w-full items-center gap-1.5 rounded-md px-2 pb-1.5 pt-3.5 text-left text-text-subtle transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
          {label}
        </button>}
      {type === 'Locations' && open && locationParents.length > 0 && !search.trim() && (
        <button type="button" onClick={toggleAllLocations}
          className="mt-2 inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          {allLocationsCollapsed ? <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden="true" />}
          {allLocationsCollapsed ? 'Expand all' : 'Collapse all'}
        </button>
      )}
      </div>
    );
  };
  const renderSidebarEntities = () => {
    if (search.trim() || reviewFilter) return filtered.map(renderEntityButton);
    return (filterType ? [filterType] : TYPE_ORDER).flatMap((type) => {
      const list = filtered.filter(en => en.type === type);
      if (!list.length) return [];
      const head = groupHead(type, list.length);
      if (!groupOpen(type)) return [head];
      if (type === 'Locations') return [head, ...locationTree.map(node => renderLocationNode(node))];
      return [head, ...list.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName)).map(renderEntityButton)];
    });
  };

  const renderSection = (s) => {
    if (s.raw) return <React.Fragment key={s.key}>{s.raw}</React.Fragment>;
    const editing = editingSection === s.key;
    const withFields = charTab === 'data' && customFieldsIn(s.key).length > 0;
    const empty = !editing && (s.custom ? !customFilledIn(s.key) : s.empty === true && !(withFields && customFilledIn(s.key)));
    // Template values edit as a draft, so a section holding any of them saves like a scalar one.
    const savable = s.scalar || withFields;
    return (
      <Section key={s.key} icon={s.icon} title={s.title} count={s.count} quiet={s.quiet} editing={editing} empty={empty} emptyVerb={s.emptyVerb} emptyNote={s.emptyNote}
        right={editing && s.spoiler ? <>{s.right}<FieldEye field={s.spoiler} className="mr-1" /></> : s.right}
        showPencil={!s.derived} onEdit={() => setEditingSection(s.key)}>
        {editing ? (
          <>
            {s.spoiler ? <SpoilerCover field={s.spoiler}>{s.edit}</SpoilerCover> : s.edit}
            {withFields && customFieldsFor(s.key, true)}
            <div className="flex items-center justify-end gap-2 pt-1">
              {savable ? (
                <>
                  <Button variant="ghost" size="sm" onClick={cancelSection}>Cancel</Button>
                  <Button size="sm" icon={Check} loading={saving} onClick={saveSection}>Save</Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setEditingSection(null)}>Done</Button>
              )}
            </div>
          </>
        ) : (() => {
          // Short template fields join the section's own grid; long ones follow its text.
          const shortFields = withFields && !s.custom ? customFieldsIn(s.key).filter(definition => !isLongField(definition)) : [];
          const cells = shortFields.length ? customFieldsFor(s.key, false, 'short') : null;
          const [view, placed] = cells ? injectIntoGrid(s.view, cells) : [s.view, false];
          return <>
            {s.spoiler ? <SpoilerCover field={s.spoiler}>{view}</SpoilerCover> : view}
            {cells && !placed && <FactGrid>{cells}</FactGrid>}
            {withFields && (s.custom ? customFieldsFor(s.key) : customFieldsFor(s.key, false, 'long'))}
          </>;
        })()}
      </Section>
    );
  };

  // Create form: every native section of the Data tab, opened for editing, plus the
  // template's own fields. Sections made only of relations are left out: links need a
  // saved id, so they are filled once the sheet exists.
  const renderCreateSection = (s) => {
    if (s.raw) return <React.Fragment key={s.key}>{s.raw}</React.Fragment>;
    const withFields = customFieldsIn(s.key).length > 0;
    if ((!s.edit && !withFields) || s.relationalOnly) return null;
    // A new creature starts from its details; the text sections wait folded until asked for.
    const folded = selected?.type === 'Creatures' && s.key !== 'details' && !openCreateSections.has(s.key) && !withFields;
    if (folded) {
      return <Section key={s.key} icon={s.icon} title={s.title} empty showPencil onEdit={() => setOpenCreateSections(current => new Set(current).add(s.key))} />;
    }
    return (
      <Section key={s.key} icon={s.icon} title={s.title}>
        {s.edit}
        {withFields && customFieldsFor(s.key, true)}
      </Section>
    );
  };

  const bulkDialog = (() => {
    if (!bulkConfirm) return null;
    const { action, summary } = bulkConfirm;
    if (action === 'delete') return {
      tone: 'danger',
      title: `Delete ${summary.entities} entities`,
      confirm: 'Delete entities',
      message: `${summary.proposed} proposed and ${summary.entities - summary.proposed} confirmed entities will be permanently deleted, together with ${summary.relationships} relationships and ${summary.storyTags} World Index associations.${describeStoryImpact(summary)} This cannot be undone.`,
    };
    const updateDetails = `${summary.pendingFields} field changes, ${summary.pendingLore} lore updates, ${summary.pendingLinks} relationships, and ${summary.pendingSkills || 0} skill changes`;
    if (action === 'accept-proposed') return {
      tone: 'warning', title: 'Accept proposed entities', confirm: 'Accept proposals',
      message: `${summary.proposed} selected proposals will become confirmed entities. Possible duplicates still need to be merged manually.`,
    };
    if (action === 'accept-updates') return {
      tone: 'warning', title: 'Accept AI updates', confirm: 'Accept updates',
      message: `Accept all pending AI changes for ${summary.pendingUpdates} selected entities: ${updateDetails}.`,
    };
    if (action === 'reject-proposed') return {
      tone: 'danger', title: 'Reject proposed entities', confirm: 'Reject proposals',
      message: `Reject and remove ${summary.proposed} selected proposed entities. Confirmed entities in the selection will not be changed.`,
    };
    if (action === 'reject-updates') return {
      tone: 'danger', title: 'Reject AI updates', confirm: 'Reject updates',
      message: `Discard all pending AI changes for ${summary.pendingUpdates} selected entities: ${updateDetails}. Current canonical data will not be changed.`,
    };
    if (action === 'reject-narrative') return {
      tone: 'danger', title: 'Reject Narrative state suggestions', confirm: 'Reject suggestions',
      message: `Discard ${summary.pendingNarrative || 0} pending Narrative state ${summary.pendingNarrative === 1 ? 'suggestion' : 'suggestions'} for the selected entities: what they know, believe, remember and feel. Nothing already recorded changes.`,
    };
    if (action === 'reprocess') return {
      tone: 'warning', title: 'Reprocess selected entities', confirm: 'Reset progress',
      message: `Clear the processed-evidence status for ${summary.entities - summary.proposed} confirmed entities. Current data and pending reviews will be preserved. The next Update Entities run will read their matching evidence again.`,
    };
    return null;
  })();

  return (
    <div className="ws-clear flex-1 flex flex-col lg:flex-row h-full overflow-hidden bg-surface-canvas/40 select-none relative">
      <input ref={coverFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={pickCover} />
      {imageDialog && selectedId && createPortal(
        <WorldbuildImageDialog
          title={imageDialog === 'portrait' ? `Portrait for ${selected.canonicalName}` : `Background for ${selected.canonicalName}`}
          shape={imageDialog === 'portrait' ? 'square' : 'wide'}
          image={imageDialog === 'portrait' ? sheetPortrait : (locationCover && !locationCover.inherited ? locationCover : null)}
          busy={imageBusy}
          onChoose={(filePath) => chooseImage(imageDialog, filePath)}
          onSaveFocus={saveImageFocus}
          onRemove={() => removeImage(imageDialog)}
          onClose={() => setImageDialog(null)}
        />, document.body)}
      {showExportModal && createPortal(
        <ExportWorldbuildModal
          workspaceId={workspaceId}
          workspaceName={chat?.title}
          api={electronAPI}
          entityCount={exportableCount}
          onClose={() => setShowExportModal(false)}
          onConfirm={({ includeImages, includeCurrentValues }) => { setShowExportModal(false); exportWorld(includeImages, includeCurrentValues); }}
        />, document.body)}
      {worldImport && createPortal(
        <ImportWorldbuildModal
          inspected={worldImport}
          workspaceName={chat?.title}
          currentDate={worldClock && worldCalendar ? formatWorldDate(worldCalendar, worldClock) : null}
          onCancel={() => setWorldImport(null)}
          onImport={finishImport}
        />, document.body)}
      {importDone && createPortal(
        <ImportWorldbuildDone
          {...importDone}
          onClose={() => setImportDone(null)}
          onReview={() => { setImportDone(null); setReviewFilter('proposed'); }}
        />, document.body)}
      {bulkDialog && (
        <ConfirmDialog
          tone={bulkDialog.tone}
          title={bulkDialog.title}
          message={bulkDialog.message}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setBulkConfirm(null) },
            { label: bulkDialog.confirm, variant: bulkDialog.tone === 'danger' ? 'danger' : 'primary', autoFocus: true, loading: bulkSaving, onClick: () => runBulkAction(bulkConfirm.action) },
          ]}
          onClose={() => setBulkConfirm(null)}
        />
      )}
      {showTemplateManager && (
        <WorldbuildTemplateManager
          workspaceId={workspaceId}
          api={electronAPI}
          templates={templates}
          showToast={showToast}
          onClose={() => setShowTemplateManager(false)}
          onSaved={(template) => setTemplates(current => [...current.filter(item => item.typeId !== template.typeId), template])}
        />
      )}
      {mergeDialog && selected?.id && (
        <WorldbuildMergeDialog
          source={selected}
          targets={mergeTargets}
          suggestedId={mergeDialog.suggestedId}
          saving={saving}
          api={electronAPI}
          onClose={() => setMergeDialog(null)}
          onMerge={async (targetId, prefer) => { await mergeInto(targetId, prefer); setMergeDialog(null); }}
        />
      )}
      {confirmDelete && selected && (
        <ConfirmDialog
          tone="danger"
          title="Delete entity"
          message={<>The {typeMeta(selected.type).label.toLowerCase()} <strong className="text-text-secondary">“{selected.canonicalName}”</strong> will be permanently deleted, along with its connections and story tags.{describeStoryImpact(deleteImpact)} This cannot be undone.</>}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setConfirmDelete(false) },
            { label: 'Delete', variant: 'danger', autoFocus: true, loading: saving, onClick: async () => { await remove(); setConfirmDelete(false); } },
          ]}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      <div style={{ '--worldbuild-sidebar-width': `${sidebarWidth}px` }} className="ws-rail relative w-full lg:w-[var(--worldbuild-sidebar-width)] shrink-0 flex flex-col h-full overflow-visible border-r border-border-subtle/40 bg-surface-canvas/35 backdrop-blur-md">
        {/* The whole right edge resizes; no floating handle over the content. */}
        <div role="separator" aria-orientation="vertical" aria-label="Resize Worldbuild sidebar" tabIndex={0} onPointerDown={startSidebarResize} onKeyDown={handleSidebarResizeKey}
          className="absolute -right-1 top-0 bottom-0 z-20 hidden w-2 cursor-col-resize transition-colors hover:bg-accent/25 focus-visible:bg-accent/40 focus-visible:outline-none lg:block" />
        <div className="space-y-3 px-3 pb-1 pt-3.5">
          <div className="flex h-8 items-center gap-1">
            <span className="pl-1 text-[0.9375rem] font-bold text-text-primary">Worldbuild</span>
            <span className="flex-1" />
            <button type="button" disabled={enriching || entities.length === 0 || !hasSystemAi} onClick={() => runEnrichment()}
              data-tooltip={!hasSystemAi ? 'Choose an API connection and a model for System AI in Settings to update entities' : enriching ? undefined : 'Reads the story again and suggests changes. Locked sheets are skipped.'}
              className="mr-0.5 inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control border border-status-info/45 bg-status-info/15 px-2.5 text-xs font-semibold text-text-primary transition-colors hover:bg-status-info/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default disabled:border-status-info/25 disabled:bg-status-info/[0.07] disabled:text-text-muted">
              {enriching ? <Loader2 className="h-3.5 w-3.5 animate-spin text-status-info" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5 text-status-info" aria-hidden="true" />}
              {enriching ? 'Updating…' : 'Update entities'}
            </button>
            <IconButton icon={ListChecks} size="sm" label={manageMode ? 'Stop selecting' : 'Select several'} aria-pressed={manageMode}
              className={manageMode ? '!bg-accent/15 !text-accent' : ''} onClick={() => manageMode ? leaveManageMode() : setManageMode(true)} />
            <IconButton ref={moreMenuRef} icon={MoreHorizontal} size="sm" label="More Worldbuild actions" aria-haspopup="menu" aria-expanded={showMoreMenu} onClick={() => setShowMoreMenu(v => !v)} />
            <Menu anchorRef={moreMenuRef} open={showMoreMenu} onClose={() => setShowMoreMenu(false)} label="Worldbuild actions" className="w-64">
              <MenuItem icon={Upload} label="Import" description="Bring in a .klwb file to review." onSelect={() => { setShowMoreMenu(false); importWorld(); }} />
              <MenuItem icon={Download} label="Export" description={exportableCount ? 'Save this world as a .klwb file.' : 'Nothing to export yet.'} disabled={!exportableCount} onSelect={() => { setShowMoreMenu(false); setShowExportModal(true); }} />
            </Menu>
          </div>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" aria-hidden="true" />
              <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && search) { e.stopPropagation(); setSearch(''); } }} placeholder="Search the world" aria-label="Search the world" aria-keyshortcuts="Control+K" className={`${FIELD} pl-9 ${search || sidebarWidth < 360 ? '' : 'pr-14'}`} />
              {!search && sidebarWidth >= 360 && <kbd aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border-default px-1.5 py-0.5 font-sans text-xs text-text-subtle">Ctrl K</kbd>}
            </div>
            <div ref={createRef} className="shrink-0">
              <Button icon={Plus} onClick={() => setShowCreate(v => !v)} aria-haspopup="menu" aria-expanded={showCreate}>Create</Button>
            </div>
            <Menu anchorRef={createRef} open={showCreate} onClose={() => setShowCreate(false)} label="Create" className="w-64">
              {createOptions.map(option => {
                const t = typeMeta(option.type);
                const Icon = option.id === 'Creatures:group' ? Users : option.id === 'Items:unique' ? Gem : t.icon;
                return (
                  <button key={option.id} type="button" role="menuitem" onClick={() => startNew(option.type, option.data)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${t.medallion}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-text-primary">{option.label || t.label}</span>
                      {option.note && <span className="block truncate text-xs text-text-muted">{option.note}</span>}
                    </span>
                  </button>
                );
              })}
            </Menu>
          </div>
          <div role="radiogroup" aria-label="Filter by type" className="flex items-stretch justify-between gap-0.5">
            <button type="button" role="radio" aria-checked={!filterType} onClick={() => setFilterType(null)}
              className={`flex h-11 min-w-[2.125rem] shrink-0 flex-col items-center justify-center rounded-md px-1.5 text-xs font-semibold leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${!filterType ? 'bg-surface-hover text-text-primary ring-1 ring-inset ring-border-strong' : 'text-text-muted hover:text-text-primary'}`}>
              All<span className="font-normal tabular-nums text-text-muted">{entities.length}</span>
            </button>
            {TYPE_ORDER.map(key => {
              const t = typeMeta(key);
              const Icon = t.icon;
              const on = filterType === key;
              return (
                <Tooltip key={key} content={t.plural || `${t.label}s`}>
                  <button type="button" role="radio" aria-checked={on} aria-label={`${t.plural || `${t.label}s`}, ${typeCounts[key] || 0}`} onClick={() => setFilterType(on ? null : key)}
                    className={`flex h-11 w-[1.875rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${on ? t.medallion : `border-transparent ${t.soft} hover:bg-surface-hover/60`}`}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span className={`text-xs leading-4 tabular-nums ${on ? '' : 'text-text-subtle'}`}>{typeCounts[key] || 0}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>

        <div ref={listScrollRef} onScroll={(e) => { scrollOffsets.current.list = e.currentTarget.scrollTop; }} aria-busy={!registryFresh} className={`flex-1 overflow-y-auto custom-scrollbar px-2 pb-2 ${registryFresh ? '' : 'pointer-events-none'}`}>
          {/* The world's own pages sit above the review card, which comes and goes, so they never move. */}
          {!manageMode && (
            <nav aria-label="World" className="pt-2">
              <div className="flex items-center gap-2.5 px-1 pb-2">
                <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-subtle">World</span>
                <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
              </div>
              {/* Four across, title only; what each holds is in its tooltip. */}
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { key: 'calendar', icon: CalendarDays, label: 'Calendar', meta: (worldClock && worldCalendar && formatWorldDate(worldCalendar, worldClock)) || worldCalendar?.name || 'Not set up' },
                  { key: 'facts', icon: BookCheck, label: 'Facts', meta: String(factCount || 0) },
                  { key: 'rules', icon: Scale, label: 'Rules', meta: rulesMeta || 'None yet' },
                  { key: 'types', icon: LayoutTemplate, label: 'Entity types', meta: `${TYPE_ORDER.length} types`, open: () => setShowTemplateManager(true) },
                ].map(link => {
                  const on = surface === link.key;
                  return (
                    <button key={link.key} type="button" aria-current={on ? 'page' : undefined} onClick={link.open || (() => { setSurface(link.key); setSelected(null); setEditingSection(null); })}
                      data-tooltip={`${link.label}: ${link.meta}`}
                      className={`flex h-[5.25rem] min-w-0 flex-col items-center justify-center gap-2 rounded-control border px-1.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${on ? 'border-accent/35 bg-accent/[0.13] text-accent' : 'border-border-subtle bg-surface-hover/25 text-text-secondary hover:bg-surface-hover/60 hover:text-text-primary'}`}>
                      <link.icon className={`h-[1.125rem] w-[1.125rem] shrink-0 ${on ? '' : 'text-text-muted'}`} aria-hidden="true" />
                      <span className="whitespace-nowrap text-[0.8125rem] font-semibold">{link.label}</span>
                      <span className="sr-only">{link.meta}</span>
                    </button>
                  );
                })}
              </div>
            </nav>
          )}
          {!manageMode && (proposedCount > 0 || pendingUpdateCount > 0 || nameReviewCount > 0) && (
            <div className="pt-3">
              <button ref={reviewMenuRef} type="button" aria-haspopup="menu" aria-expanded={showReviewMenu} onClick={() => setShowReviewMenu(v => !v)}
                className={`flex w-full items-center gap-2.5 rounded-control border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${reviewFilter ? 'border-status-info/40 bg-status-info/[0.12]' : 'border-status-info/20 bg-status-info/[0.06] hover:bg-status-info/10'}`}>
                <AiGlyph className="h-4 w-4 shrink-0 text-status-info" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-text-primary">{reviewFilter ? REVIEW_FILTERS[reviewFilter] : `${proposedCount + pendingUpdateCount + nameReviewCount} waiting for review`}</span>
                  <span className="mt-0.5 flex flex-wrap gap-x-2.5 text-xs text-text-muted">
                    {proposedCount > 0 && <span><span className="tabular-nums text-status-warning">{proposedCount}</span> new</span>}
                    {pendingUpdateCount > 0 && <span><span className="tabular-nums text-status-info">{pendingUpdateCount}</span> updates</span>}
                    {nameReviewCount > 0 && <span><span className="tabular-nums text-status-warning">{nameReviewCount}</span> {nameReviewCount === 1 ? 'name' : 'names'}</span>}
                  </span>
                </span>
                {reviewFilter
                  ? <span role="button" tabIndex={0} aria-label="Show everything" onClick={(event) => { event.stopPropagation(); setReviewFilter(null); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); setReviewFilter(null); } }} className="rounded p-0.5 text-text-muted hover:text-text-primary"><X className="h-3.5 w-3.5" /></span>
                  : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-subtle" aria-hidden="true" />}
              </button>
              <Menu anchorRef={reviewMenuRef} open={showReviewMenu} onClose={() => setShowReviewMenu(false)} label="Review filters" className="w-64">
                <MenuLabel>Show only</MenuLabel>
                {proposedCount > 0 && <MenuItem icon={AiGlyph} iconClassName="text-status-warning" label="Proposed by the AI" trailing={<span className="text-xs tabular-nums text-text-subtle">{proposedCount}</span>} checked={reviewFilter === 'proposed'} onSelect={() => { setShowReviewMenu(false); setReviewFilter(reviewFilter === 'proposed' ? null : 'proposed'); }} />}
                {pendingUpdateCount > 0 && <MenuItem icon={ScanEye} iconClassName="text-status-info" label="With suggested updates" trailing={<span className="text-xs tabular-nums text-text-subtle">{pendingUpdateCount}</span>} checked={reviewFilter === 'updates'} onSelect={() => { setShowReviewMenu(false); setReviewFilter(reviewFilter === 'updates' ? null : 'updates'); }} />}
                {nameReviewCount > 0 && <MenuItem icon={AlertTriangle} iconClassName="text-status-warning" label="Names to check" description="Common words, pieces of other names, or duplicates." trailing={<span className="text-xs tabular-nums text-text-subtle">{nameReviewCount}</span>} checked={reviewFilter === 'names'} onSelect={() => { setShowReviewMenu(false); setReviewFilter(reviewFilter === 'names' ? null : 'names'); }} />}
              </Menu>
            </div>
          )}
          <div className="space-y-px pt-1">
            {loading ? <p className="caption py-8 text-center">Loading…</p>
              : filtered.length === 0 ? <p className="caption py-8 text-center">{search.trim() || filterType || reviewFilter ? 'Nothing matches.' : 'Nothing here yet.'}</p>
              : renderSidebarEntities()}
          </div>
        </div>
        <WorldUpdateStatus
          running={enriching}
          progress={enrichProgress}
          stopping={enrichStopping}
          errors={showEnrichErrors ? enrichErrors : []}
          summary={enrichErrorSummary}
          runTotal={enrichRunTotal}
          typeLabel={(type) => typeMeta(type).label}
          onStop={stopEnrichment}
          onRetry={(entityIds) => runEnrichment(entityIds)}
          onDismiss={dismissEnrichError}
          onDismissAll={dismissAllEnrichErrors}
          onOpenSettings={() => openSettings('engine', 'system-ai')}
          onOpenEntity={openEntityById}
        />
        {manageMode && (
          <WorldSelectionBar
            count={selectedIds.size}
            hiddenCount={hiddenSelectedCount}
            proposedCount={selectedProposedCount}
            updateCount={selectedUpdateCount}
            narrativeCount={selectedNarrativeCount}
            confirmedCount={selectedConfirmedCount}
            busy={bulkSaving}
            selectOptions={[
              { key: 'visible', icon: ListChecks, label: 'Everything visible', count: filtered.length, onSelect: selectVisibleEntities },
              { key: 'proposed', icon: AiGlyph, tone: 'text-status-warning', label: 'Proposed by the AI', count: proposedCount, onSelect: () => selectEntities(entities.filter(entity => entity.status === 'proposed')) },
              { key: 'updates', icon: ScanEye, tone: 'text-status-info', label: 'With suggested updates', count: pendingUpdateCount, onSelect: () => selectEntities(entities.filter(entity => entity.status !== 'proposed' && ((reviewCounts[entity.id]?.entityUpdates || 0) > 0 || (reviewCounts[entity.id]?.narrative || 0) > 0))) },
              { key: 'names', icon: AlertTriangle, tone: 'text-status-warning', label: 'Names to check', count: nameReviewCount, onSelect: () => selectEntities(entities.filter(entity => nameReview.has(entity.id))) },
            ]}
            policyOptions={Object.entries(AI_POLICY).map(([policy, config]) => ({
              key: policy, icon: config.icon, label: config.label, description: config.tip,
              count: entities.filter(entity => entity.status !== 'proposed' && (entity.data?.aiPolicy || 'review') === policy).length,
              onSelectAll: () => selectEntities(entities.filter(entity => entity.status !== 'proposed' && (entity.data?.aiPolicy || 'review') === policy)),
              onApply: () => runBulkAction('policy', policy),
            }))}
            onClear={() => setSelectedIds(new Set())}
            onAction={requestBulkConfirmation}
          />
        )}
      </div>

      <div ref={sheetScrollRef} onScroll={(e) => { scrollOffsets.current.sheet = e.currentTarget.scrollTop; }} className="flex-1 min-w-0 overflow-y-auto custom-scrollbar">
        {surface === 'rules' ? (
          <WorldbuildRules
            workspaceId={workspaceId}
            api={electronAPI}
            showToast={showToast}
            entities={entities}
            worldName={chat?.title}
            onOpenCalendar={() => { setSurface('calendar'); setSelected(null); setEditingSection(null); }}
          />
        ) : surface === 'calendar' ? (
          <WorldbuildCalendar
            workspaceId={workspaceId}
            api={electronAPI}
            showToast={showToast}
            onCalendarChanged={setWorldCalendar}
            onOpenEntity={openEntityById}
          />
        ) : surface === 'facts' ? (
          <WorldbuildFactsRegistry
            workspaceId={workspaceId}
            entities={entities}
            api={electronAPI}
            showToast={showToast}
            onCountChanged={setFactCount}
          />
        ) : !selected ? (
          <WorldOverview
            workspaceName={chat?.name || chat?.title || ''}
            entities={entities}
            typeMeta={typeMeta}
            calendar={worldCalendar}
            storyDate={worldClock}
            counts={{ proposed: proposedCount, updates: pendingUpdateCount, names: nameReviewCount }}
            onFilter={(type) => { setFilterType(type); setReviewFilter(null); }}
            onReview={(filter) => {
              setReviewFilter(filter);
              const first = entities.filter(entity => matchesReviewFilter(entity, filter, { nameReview, reviewCounts }))
                .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))[0];
              if (first) openEntity(first, filter === 'updates' ? { tab: 'review' } : undefined);
            }}
            onOpen={(entity) => openEntity(entity)}
            onCreate={() => setShowCreate(true)}
          />
        ) : (
          <div className="mx-auto max-w-3xl space-y-4 p-6" inert={sheetBeingRead || undefined} aria-busy={sheetBeingRead || undefined}>
            <SpoilerScope key={selected.id || 'new'} data={selected.data} onToggle={toggleHidden}>
            {sheetBeingRead && (
              <SheetNotice busy icon={Loader2} title="The AI is reading this sheet" text="It opens for editing again as soon as this entity is done. Other sheets stay editable." />
            )}
            {selected.status === 'proposed' && (
              <SheetNotice icon={AiGlyph} title={selected.data?._imported ? 'Imported from a Worldbuild package' : 'Proposed by the AI'}
                text={selected.data?._imported
                  ? 'Keep it as a new entity, fold it into one you already have, or dismiss it.'
                  : `${Array.isArray(selected.data?.proposalEvidence) && selected.data.proposalEvidence.length ? `Found in ${selected.data.proposalEvidence.length} ${selected.data.proposalEvidence.length === 1 ? 'passage' : 'passages'} of the story. ` : ''}Keep it, fold it into an entity you already have, or dismiss it.`}>
                <Button size="sm" loading={saving} onClick={() => persist({ accept: true })}>Keep as new</Button>
                <Button size="sm" variant="ghost" icon={Merge} onClick={() => setMergeDialog({ suggestedId: null })}>Merge into…</Button>
                <Button size="sm" variant="subtle" loading={saving} onClick={remove}>Dismiss</Button>
                {!selected.data?._imported && Array.isArray(selected.data?.proposalEvidence) && selected.data.proposalEvidence.length > 0 && <div className="ml-auto"><EvidenceReferences label="See passages" excerpts={selected.data.proposalEvidence.map(item => item.excerpt)} /></div>}
              </SheetNotice>
            )}
            {!isNew && nameReview.has(selected.id) && (
              <SheetNotice icon={AlertTriangle} title={describeNameReview(nameReview.get(selected.id)[0])}
                text={[
                  nameReview.get(selected.id)[0]?.code === 'duplicate' ? `Both names show up in the same passages. Merging keeps ${selected.canonicalName} as an alias of ${nameReview.get(selected.id)[0].relatedName}.` : '',
                  ...nameReview.get(selected.id).slice(1).map(describeNameReview),
                ].filter(Boolean).join(' ')}>
                {nameReview.get(selected.id).filter(reason => reason.relatedId && entities.some(e => e.id === reason.relatedId)).slice(0, 1).map(reason => (
                  <Button key={reason.relatedId} size="sm" variant="ghost" icon={Merge} loading={saving} onClick={() => mergeInto(reason.relatedId, 'target')}>Merge into {reason.relatedName}</Button>
                ))}
                <Button size="sm" variant="subtle" loading={saving} onClick={keepName}>{nameReview.get(selected.id).some(reason => reason.code === 'duplicate' || reason.code === 'fragment') ? 'Keep both' : 'Keep as is'}</Button>
                <Button size="sm" variant="subtle" icon={Trash2} className="!text-status-danger" onClick={() => setConfirmDelete(true)}>Delete</Button>
              </SheetNotice>
            )}
            <div className={`ws-card relative overflow-hidden rounded-surface border ${m.ring} bg-surface-panel-muted/60 backdrop-blur-md`}>
              <div aria-hidden="true" className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${m.wash} via-transparent to-transparent`} />
              <div className="relative p-5">
              {coverStyle && <>
                <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={coverStyle} />
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-r from-surface-panel via-surface-panel/80 to-surface-panel/20" />
              </>}
              <div className="relative">
              {(isNew || editingSection === '__header__') ? (
                <div className="flex items-start gap-4">
                  <SheetMedallion meta={m} portrait={isNew ? null : sheetPortrait} />
                  <div className="min-w-0 flex-1 space-y-3.5">
                    {isNew && <div className={`text-xs font-semibold ${m.soft}`}>New {m.label.toLowerCase()}</div>}
                    <Edit label={nameLabel}><LInput autoFocus placeholder={placeholderName(selected.type)} value={selected.canonicalName} onChange={(e) => patch({ canonicalName: e.target.value })} /></Edit>
                    {showAliases && <Edit label="Other names" hint="Aliases and titles. When the story mentions any of them, it points to this sheet."><AliasInput withEyes={!isNew} value={selected.aliases} placeholder={isNew ? placeholderAlias(selected.type) : 'Type and press Enter'} onChange={(aliases) => patch({ aliases })} /></Edit>}
                    {!isNew && (
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={cancelSection}>Cancel</Button>
                        <Button size="sm" icon={Check} loading={saving} onClick={saveSection}>Save</Button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-4">
                  <SheetMedallion meta={m} portrait={sheetPortrait} onPortrait={portraitAllowed ? () => setImageDialog('portrait') : null} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className={`font-semibold ${m.soft}`}>{sheetTypeLabel}</span>
                      {sheetVariantLabel && <><span className="text-text-disabled" aria-hidden="true">·</span><SpoilerCover field="scope" compact><span className="text-text-secondary">{sheetVariantLabel}</span></SpoilerCover></>}
                      {hasLifeStatus && <><span className="text-text-disabled" aria-hidden="true">·</span><SpoilerCover field="status" compact><StateTag map={STATUS} value={selected.data.status || 'unknown'} /></SpoilerCover></>}
                      {rel.isRace?.entity && <><span className="text-text-disabled" aria-hidden="true">·</span><SpoilerCover field="race" compact><span className="text-text-secondary">{rel.isRace.entity.canonicalName}</span></SpoilerCover></>}
                      {playerEntityId && playerEntityId === selected.id && <span className="ml-1 inline-flex h-5.5 items-center gap-1 rounded-full border border-accent/30 px-2 font-medium text-accent"><Gamepad2 aria-hidden="true" className="h-3.5 w-3.5" />You play them</span>}
                    </div>
                    <h1 className="mt-1 line-clamp-2 break-words text-2xl font-bold leading-tight text-text-primary">{selected.canonicalName}</h1>
                    {coverAllowed && locationCover?.inherited && (() => {
                      const source = entities.find(e => e.id === locationCover.sourceLocationId);
                      return source ? <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-text-subtle"><ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />Background from<EntityChip entity={source} onOpen={openEntityById} /></div> : null;
                    })()}
                    {showAliases && (aliasesArr(selected.aliases).length > 0
                      ? <div className="mt-2.5 flex flex-wrap items-center gap-1.5"><span className="mr-0.5 text-xs text-text-subtle">Also</span>{aliasesArr(selected.aliases).map((a, i) => <SpoilerCover key={i} field={`alias:${a}`} compact><Chip>{a}</Chip></SpoilerCover>)}</div>
                      : <button type="button" onClick={() => setEditingSection('__header__')} className="-ml-2 mt-1.5 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-subtle transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Add other names</button>)}
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    {coverAllowed && <LocationCoverMenu cover={locationCover} parentName={rel.inside?.entity?.canonicalName}
                      childNames={insideLinks.filter(link => link.toId === selected.id).map(link => entities.find(e => e.id === link.fromId)?.canonicalName).filter(Boolean)}
                      onChoose={() => coverFileRef.current?.click()} onFrame={() => setImageDialog('background')} onRemove={() => removeImage('background')} />}
                    {selected.status !== 'proposed' && <AiPolicyControl value={selected.data?.aiPolicy} onChange={setAiPolicy} />}
                    <SheetActionsMenu
                      onPortrait={portraitAllowed ? () => setImageDialog('portrait') : null}
                      hasPortrait={!!sheetPortrait}
                      onEditName={() => setEditingSection('__header__')}
                      onMerge={() => setMergeDialog({ suggestedId: null })}
                      onReprocess={selected.status !== 'proposed' ? reprocessSelected : null}
                      onDelete={() => setConfirmDelete(true)}
                    />
                  </div>
                </div>
              )}
              </div>
              </div>
              {visibleSheetTabs.length > 1 && !isNew && (
                <div role="tablist" aria-label="Sheet sections" className="relative flex gap-1 overflow-x-auto border-t border-border-subtle px-4 [scrollbar-width:none]">
                  {visibleSheetTabs.map(t => {
                    const on = charTab === t;
                    const count = t === 'review' ? selectedReviewCounts.entityUpdates + selectedReviewCounts.narrative : tabCounts[t];
                    return (
                      <button key={t} type="button" role="tab" aria-selected={on} onClick={() => { setCharTab(t); setEditingSection(null); }}
                        className={`relative inline-flex h-11 shrink-0 items-center gap-1.5 px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${on ? 'font-semibold text-text-primary' : 'font-medium text-text-muted hover:text-text-primary'}`}>
                        {SheetTabIcon[t] && React.createElement(SheetTabIcon[t], { className: `h-4 w-4 ${on ? 'text-accent' : ''}`, 'aria-hidden': true })}
                        {sheetTabLabel(t)}
                        {t !== 'data' && count != null && (t !== 'review' || count > 0) && <span className={`rounded-full px-1.5 py-px text-xs tabular-nums ${t === 'review' ? 'bg-status-info/15 text-status-info' : 'bg-surface-hover/70 text-text-muted'}`}>{count}</span>}
                        {on && <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {!isNew && selected.status !== 'proposed' && charTab === 'data' && (selected.type === 'Characters' || (selected.type === 'Creatures' && (selected.data?.scope || 'individual') !== 'group')) && (
              <>
                <WorldbuildRoleplayResources workspaceId={workspaceId} entity={selected} entities={entities} api={electronAPI} showToast={showToast} onOpen={openEntityById} />
                <WorldbuildEntitySkills workspaceId={workspaceId} entity={selected} api={electronAPI} showToast={showToast} />
              </>
            )}


            {/* Staged AI enrichment (review policy): per-field accept/reject */}
            {charTab === 'review' && hasEntityReview && reviewKind === 'entity' && !isNew && selected.status !== 'proposed' && (selected.data?._enrichPending || reviewSkillChanges.length > 0) && (() => {
              const pending = selected.data?._enrichPending || {};
              const hasStagedUpdate = Boolean(selected.data?._enrichPending);
              const pData = (pending.data && typeof pending.data === 'object') ? pending.data : {};
              const proposalValue = proposal => proposal && typeof proposal === 'object' && 'value' in proposal ? proposal.value : proposal;
              const proposalEvidence = proposal => {
                const ids = proposal && typeof proposal === 'object' && Array.isArray(proposal.evidence) ? proposal.evidence : [];
                return ids.map(id => pending.evidence?.[id]?.excerpt).filter(Boolean);
              };
              const proposalSupport = proposal => proposal && typeof proposal === 'object' ? String(proposal.support || '').trim() : '';
              const fields = Object.keys(pData);
              const hasLore = selected.type !== 'System' && pending.lore != null && String(pending.lore).trim() !== '';
              const links = Array.isArray(pending.links) ? pending.links : [];
              const chapters = Array.isArray(pending.chapters) ? pending.chapters : [];
              const linkKey = (l) => `${l.relKey}:${l.targetId}:${l.label || ''}`;
              const allFields = fields.slice();
              const allLinks = links.map(linkKey);
              const allChapters = chapters.map(c => c.id);
              return (
                <section className="ws-card rounded-card border border-border-default bg-surface-panel-muted/60 px-4 pb-2 pt-3.5 backdrop-blur-md">
                  <div className="flex flex-wrap items-center gap-2">
                    {reviewSwitcher || <><ScanEye className="h-4 w-4 shrink-0 text-status-info" aria-hidden="true" /><h2 className="text-sm font-semibold text-text-primary">Suggested updates</h2></>}
                    <span className="flex-1" />
                    <Button size="sm" variant="subtle" loading={saving} onClick={() => resolveWholeReview(false, hasStagedUpdate ? { fields: allFields, lore: true, links: allLinks, chapters: allChapters } : null)}>Reject all</Button>
                    <Button size="sm" variant="ghost" icon={Check} loading={saving} onClick={() => resolveWholeReview(true, hasStagedUpdate ? { fields: allFields, lore: true, links: allLinks, chapters: allChapters } : null)}>Accept all</Button>
                  </div>
                  <p className="caption mt-1.5">The AI read new passages and suggests these changes. Nothing changes until you accept.</p>
                  <div className="mt-2 divide-y divide-border-subtle">
                    {fields.map(f => {
                      const customFieldKey = f.startsWith('customFields.') ? f.slice('customFields.'.length) : null;
                      const cur = customFieldKey ? selected.data?.customFields?.[customFieldKey] : selected.data?.[f];
                      const empty = cur == null || String(cur).trim() === '';
                      const curStr = empty ? '' : customFieldKey ? String(cur) : displayNativeValue(f, cur);
                      return (
                        <div key={f} className="flex items-start gap-4 py-3.5">
                          <div className="min-w-0 flex-1">
                            <span className="block text-xs font-medium text-text-muted">{pData[f]?.fieldLabel || fieldLabel(f)}</span>
                            <SpoilerCover field={customFieldKey ? null : f}><div className="mt-1 flex flex-wrap items-baseline gap-2 text-sm">
                              {!empty && <><span className="text-text-subtle line-through"><SpoilerText text={curStr} /></span><ChevronRight className="h-3.5 w-3.5 self-center text-text-subtle" aria-hidden="true" /></>}
                              <span className="text-text-primary"><SpoilerText text={displayProposalValue(f, pData[f], fieldDefinitions, entities)} /></span>
                            </div></SpoilerCover>
                            <EvidenceReferences excerpts={proposalEvidence(pData[f])} support={proposalSupport(pData[f])} />
                          </div>
                          <div className="flex shrink-0 items-start gap-1.5">
                            <Button size="sm" variant="subtle" icon={X} disabled={saving} onClick={() => resolveReview({}, { fields: [f] })}>Reject</Button>
                            <Button size="sm" variant="ghost" icon={Check} disabled={saving} className="!border-status-success/35 !text-status-success" onClick={() => resolveReview({ fields: [f] }, {})}>Accept</Button>
                          </div>
                        </div>
                      );
                    })}
                    {hasLore && (
                      <div className="flex items-start gap-4 py-3.5">
                        <div className="min-w-0 flex-1">
                          <span className="block text-xs font-medium text-text-muted">Lore</span>
                          <SpoilerCover field="lore"><p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-text-primary"><SpoilerText text={String(proposalValue(pending.lore))} /></p></SpoilerCover>
                          <EvidenceReferences excerpts={proposalEvidence(pending.lore)} support={proposalSupport(pending.lore)} />
                        </div>
                        <div className="flex shrink-0 items-start gap-1.5">
                            <Button size="sm" variant="subtle" icon={X} disabled={saving} onClick={() => resolveReview({}, { lore: true })}>Reject</Button>
                            <Button size="sm" variant="ghost" icon={Check} disabled={saving} className="!border-status-success/35 !text-status-success" onClick={() => resolveReview({ lore: true }, {})}>Accept</Button>
                          </div>
                      </div>
                    )}
                    {links.map(l => { const k = linkKey(l); return (
                      <div key={k} className="flex items-start gap-4 py-3.5">
                        <div className="min-w-0 flex-1 text-sm">
                          <span className="block text-xs font-medium text-text-muted">{l.relLabel || l.relKey}</span>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-text-primary">{entities.find(e => e.id === l.targetId) ? <EntityChip entity={entities.find(e => e.id === l.targetId)} onOpen={openEntityById} /> : <span>{l.targetName}</span>}{l.label && <span>{l.label}</span>}</div>
                          {l.metadata && <p className="mt-1 text-xs text-text-muted"><span className="font-semibold text-text-secondary">How {selected.canonicalName} sees {l.targetName}:</span> {l.metadata.value}{l.metadata.description ? <> · <SpoilerText text={l.metadata.description} /></> : ''}</p>}
                          <EvidenceReferences excerpts={proposalEvidence(l)} support={proposalSupport(l)} />
                        </div>
                        <div className="flex shrink-0 items-start gap-1.5">
                            <Button size="sm" variant="subtle" icon={X} disabled={saving} onClick={() => resolveReview({}, { links: [k] })}>Reject</Button>
                            <Button size="sm" variant="ghost" icon={Check} disabled={saving} className="!border-status-success/35 !text-status-success" onClick={() => resolveReview({ links: [k] }, {})}>Accept</Button>
                          </div>
                      </div>
                    ); })}
                    {reviewSkillChanges.map(change => (
                      <div key={change.id} className="flex items-start gap-4 py-3.5">
                        <div className="min-w-0 flex-1 text-sm">
                          <span className="block text-xs font-medium text-text-muted">Skill</span>
                          <div className="mt-1 text-text-primary">{describeSkillChange(change, selected.canonicalName)}</div>
                          {change.reason && <p className="mt-1 text-xs leading-relaxed text-text-muted">{change.reason}</p>}
                        </div>
                        <div className="flex shrink-0 items-start gap-1.5">
                            <Button size="sm" variant="subtle" icon={X} disabled={saving} onClick={() => resolveSkillReview([change], 'rejected')}>Reject</Button>
                            <Button size="sm" variant="ghost" icon={Check} disabled={saving} className="!border-status-success/35 !text-status-success" onClick={() => resolveSkillReview([change], 'approved')}>Accept</Button>
                          </div>
                      </div>
                    ))}
                    {chapters.map(c => (
                      <div key={c.id} className="flex items-start gap-4 py-3.5">
                        <div className="min-w-0 flex-1 text-sm">
                          <span className="block text-xs font-medium text-text-muted">Writing Desk chapter</span>
                          <div className="mt-1 text-text-primary">{c.title || 'Untitled'}</div>
                        </div>
                        <div className="flex shrink-0 items-start gap-1.5">
                            <Button size="sm" variant="subtle" icon={X} disabled={saving} onClick={() => resolveReview({}, { chapters: [c.id] })}>Reject</Button>
                            <Button size="sm" variant="ghost" icon={Check} disabled={saving} className="!border-status-success/35 !text-status-success" onClick={() => resolveReview({ chapters: [c.id] }, {})}>Accept</Button>
                          </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })()}

            {/* Body: create form (all sections in edit) or rendered sheet */}
            {isNew ? (
              <>
                {sections.map(renderCreateSection)}
                {/* Links need a saved sheet, so the footer says what opens next beside the only two actions. */}
                <div className="sticky bottom-4 z-10 flex items-center gap-3 rounded-card border border-border-default bg-surface-panel/95 px-4 py-3 shadow-overlay backdrop-blur-xl">
                  {createRelationHint(selected.type) ? <p className="caption flex min-w-0 flex-1 items-center gap-1.5"><Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{createRelationHint(selected.type)}</p> : <span className="flex-1" />}
                  <Button variant="ghost" onClick={() => setSelected(null)}>Discard</Button>
                  <Button icon={Check} loading={saving} onClick={() => persist()}>Create {typeMeta(selected.type).label.toLowerCase()}</Button>
                </div>
              </>
            ) : (
              <>
                {charTab === 'review' && hasReview ? (
                  <div className="space-y-4">
                    {reviewKind === 'narrative' && hasNarrativeReview && (
                      <WorldbuildNarrativeReview
                        workspaceId={workspaceId}
                        proposals={subjectReview.proposals || []}
                        entities={entities}
                        api={electronAPI}
                        showToast={showToast}
                        switcher={reviewSwitcher}
                        onChanged={async () => { await load(); await loadSubjectReview(); await loadRelations(selected); }}
                      />
                    )}
                  </div>
                ) : charTab === 'knowledge' && hasKnowledgeTab ? (
                  <WorldbuildKnowledgeTab
                    workspaceId={workspaceId}
                    entity={selected}
                    entities={entities}
                    api={electronAPI}
                    showToast={showToast}
                    calendar={worldCalendar}
                    clock={worldClock}
                    onOpenEntity={openEntityById}
                  />
                ) : charTab === 'occurrences' && hasOccurrencesTab ? (
                  // Each occurrence carries its date, so a hidden date keeps the whole list closed.
                  <SpoilerCover field="date">
                  <WorldbuildEventOccurrences
                    workspaceId={workspaceId}
                    eventEntity={selected}
                    entities={entities}
                    calendar={worldCalendar}
                    api={electronAPI}
                    showToast={showToast}
                  />
                  </SpoilerCover>
                ) : (
                  <>
                    {sections.map(renderSection)}
                  </>
                )}
              </>
            )}
            </SpoilerScope>
          </div>
        )}
      </div>
    </div>
  );
}

const MEMBER_PAGE = 8;
// A race can gather many characters, so its roster is searchable and shows a page at a time.
function KnownMembers({ links, portraits, onOpen }) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const needle = query.trim().toLowerCase();
  const matches = needle ? links.filter(link => link.entity.canonicalName.toLowerCase().includes(needle)) : links;
  const shown = showAll || needle ? matches : matches.slice(0, MEMBER_PAGE);
  return (
    <div className="space-y-3">
      {links.length > MEMBER_PAGE && (
        <label className="flex h-8 items-center gap-2 rounded-control border border-border-default bg-surface-input/70 px-2.5 focus-within:border-accent/60">
          <Search className="h-3.5 w-3.5 shrink-0 text-text-subtle" aria-hidden="true" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${links.length} members`} aria-label="Search members"
            className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-subtle focus:outline-none" />
        </label>
      )}
      {shown.length === 0 ? <p className="text-sm text-text-disabled">Nobody matches.</p> : (
        <div className="grid gap-1 sm:grid-cols-2">
          {shown.map(link => {
            const entity = link.entity;
            const portrait = portraits?.[entity.id];
            const status = STATUS_TONE[entity.data?.status] && !hiddenFields(entity.data).includes('status') ? entity.data.status : null;
            const typeInfo = meta(entity.type);
            return (
              <button key={link.linkId} type="button" onClick={() => onOpen(entity.id)}
                className="flex min-h-9 items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                {portrait?.imagePath
                  ? <span aria-hidden="true" className="block h-6 w-6 shrink-0 rounded-md border border-border-default" style={framedImageStyle(portrait)} />
                  : <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${typeInfo.medallion}`}>{React.createElement(typeInfo.icon, { className: 'h-3.5 w-3.5' })}</span>}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-secondary">{entity.canonicalName}</span>
                {status && <span className={`shrink-0 text-xs ${STATUS_TONE[status]}`}>{STATUS[status].label}</span>}
              </button>
            );
          })}
        </div>
      )}
      {!needle && matches.length > MEMBER_PAGE && (
        <button type="button" onClick={() => setShowAll(v => !v)}
          className="rounded text-xs font-semibold text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          {showAll ? 'Show fewer' : `Show ${matches.length - MEMBER_PAGE} more`}<ChevronDown className={`ml-1 inline h-3.5 w-3.5 transition-transform ${showAll ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function ChipList({ links, empty, onOpen }) {
  if (!links || links.length === 0) return <p className="text-sm text-text-disabled">{empty}</p>;
  return <div className="flex flex-wrap gap-1.5">{links.map(l => (
    <SpoilerCover key={l.linkId} field={`link:${l.linkId}`} compact><EntityChip entity={l.entity} label={l.label} onOpen={onOpen} /></SpoilerCover>
  ))}</div>;
}

// Every name on a sheet is the same reference: a neutral chip whose dot carries the type.
function EntityChip({ entity, label, onOpen }) {
  const body = <>
    <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta(entity.type).dot || 'bg-text-subtle'}`} />
    {entity.canonicalName}{label && <span className="text-text-subtle">· {label}</span>}
  </>;
  const cls = 'inline-flex min-h-6 items-center gap-1.5 rounded-full border border-border-subtle bg-surface-hover/35 px-2.5 py-0.5 text-xs font-medium text-text-secondary';
  if (!onOpen) return <span className={cls}>{body}</span>;
  return (
    <button type="button" onClick={() => onOpen(entity.id)} data-tooltip={`Open ${entity.canonicalName}`}
      className={`${cls} transition-colors duration-200 ease-standard hover:border-border-strong hover:bg-surface-hover/70 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 cursor-pointer`}>
      {body}
    </button>
  );
}

// What each type gains once it exists: links always need a saved id, and the
// relational tabs (inventory, connections, knowledge, occurrences) open with it.
function createRelationHint(type) {
  return {
    System: '',
    Locations: 'Its parent place and its owner can be set once the location exists.',
    Items: 'Creator, owner, and where it is found or sold can be set once the item exists.',
    Races: 'Members are filled in automatically as you assign this race to characters.',
    Factions: 'Leader, territory, members, and knowledge open once the faction exists.',
    Characters: 'Race, inventory, connections, and knowledge open once the character exists.',
    Creatures: 'Habitat, inventory, connections, and knowledge open once it exists.',
    Events: 'Places, participants, and recorded occurrences open once the event exists.',
  }[type] || 'Connections can be added once this entity exists.';
}

function placeholderName(type) {
  return { System: 'e.g. The Three Laws of Aether', Locations: 'e.g. Thornhall', Items: 'e.g. Stormglass Lantern', Races: 'e.g. Tidewalkers', Factions: 'e.g. The Ember Concord', Characters: 'e.g. Captain Aldric Venn', Creatures: 'e.g. The Gloamwyrm', Events: 'e.g. The Siege of Thornhall' }[type] || 'Name';
}
function placeholderAlias(type) {
  return { System: 'e.g. Assimilation, The Assimilation Protocol', Locations: 'e.g. The Bramble Keep', Items: 'e.g. The Tempest Lamp', Races: 'e.g. Brinekin', Factions: 'e.g. The Concord', Characters: 'e.g. Captain, The Grey Wolf', Creatures: 'e.g. The Bog Serpent', Events: 'e.g. The Long Night' }[type] || '';
}
