import React, { useRef } from 'react';
import { useEditor } from '@tiptap/react';
import { Check, ChevronDown, Download, FileCog, PanelLeftClose, Pin, Search, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';
import { Menu, MenuItem, MenuNote, MenuSeparator } from '../../components/ui/Menu';
import { AiGlyph, IndexOutdatedGlyph, NoteGlyph, SuggestionPendingGlyph, WorldbuildGlyph } from '../../components/ui/glyphs';
import {
  DEFAULT_WRITING_DESK, Divider, MEMORY_NOTES, MEMORY_PILL, PanelToggle, Toolbar, sheetStyleFor,
} from '../../components/WritingEditor';
import { getEditorExtensions, suggestionWordDelta } from '../../components/writingExtensions';
import ExampleChip from './ExampleChip';
import LIGHTHOUSE from '../../../shared/lighthouse-sample.json';

const { chapter } = LIGHTHOUSE;
const noop = () => {};

// The Lighthouse sample's first sentences, split where each step selects.
const [opening] = chapter.paragraphs;
const SELECTED_SENTENCE = opening.slice(opening.indexOf('Mara left'));
const SELECTED_NAME = 'Mara';

// Paints part of a paragraph the way the editor paints a selection it is not focused on.
function withSelection(text, part) {
  const at = text.indexOf(part);
  if (!part || at < 0) return text;
  return <>{text.slice(0, at)}<span className="wd-blur-selection">{part}</span>{text.slice(at + part.length)}</>;
}

// The Writing Desk tour's chapter, drawn with the editor's own parts. Nothing here is saved, read
// or sent, and its controls do nothing, so a workspace's own chapters never show in the tour.
export default function WritingTourExample({ stage, toolbarMode }) {
  const { writingProfiles } = useApp();
  const memoryRef = useRef(null);
  // Only the toolbar reads this editor; the sheet below is drawn directly.
  const editor = useEditor({ extensions: getEditorExtensions(), content: '', editable: false });

  const editing = writingProfiles.find(profile => profile.name === 'Editing');
  const original = chapter.paragraphs[chapter.suggestion.paragraph];
  const delta = suggestionWordDelta({ channel: 'replacement', originalText: original, proposedText: chapter.suggestion.proposed });
  const pill = MEMORY_PILL.never;
  const selection = stage === 'invoke' ? SELECTED_SENTENCE : stage === 'link' ? SELECTED_NAME : null;
  const reviewing = stage === 'review';

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden" aria-label="Example chapter">
      <div className="@container ws-clear glass-panel flex h-[3.25rem] shrink-0 items-center gap-1 border-b border-border-subtle pl-3 pr-3">
        <IconButton icon={PanelLeftClose} label="Hide chapters" size="sm" tooltipSide="bottom" onClick={noop} />
        <span className="ml-1 flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 truncate px-1 py-1 text-base font-bold text-text-primary">{chapter.title}</span>
          <ExampleChip />
        </span>

        <button
          type="button"
          ref={memoryRef}
          data-tour="wd-memory"
          aria-haspopup="menu"
          aria-expanded={stage === 'memory'}
          className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border pl-2 pr-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${pill.cls}`}
        >
          <pill.Icon className="h-3.5 w-3.5 shrink-0" />
          {pill.label}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
        </button>
        <Menu anchorRef={memoryRef} open={stage === 'memory'} onClose={noop} label="AI memory" className="w-72" tourId="wd-memory-menu">
          <MenuNote>{MEMORY_NOTES.never}</MenuNote>
          <div className="px-1 pb-2 pt-1">
            <Button fullWidth role="menuitem" onClick={noop} icon={IndexOutdatedGlyph}>Update the AI's memory</Button>
            <p className="mt-1.5 px-1.5 text-xs leading-snug text-text-muted">Reads the paragraphs you added or changed. Do this after writing.</p>
          </div>
          <MenuSeparator />
          <MenuItem label="Refresh entity tags" description="Re-tags what the AI already has, without reading it again. Use after changing your Worldbuild entities." onSelect={noop} />
        </Menu>

        <Divider />
        <IconButton icon={Search} label="Find and replace (Ctrl F)" size="sm" tooltipSide="bottom" onClick={noop} />
        <IconButton icon={FileCog} label="Page setup" size="sm" tooltipSide="bottom" onClick={noop} />
        <IconButton icon={Download} label="Export" size="sm" tooltipSide="bottom" onClick={noop} />
        <Divider />
        <span data-tour="wd-panels" className="flex shrink-0 items-center gap-1">
          <PanelToggle icon={NoteGlyph} label="Notes" count={0} active={false} onClick={noop} />
          <PanelToggle icon={AiGlyph} label="Analyses" count={0} active={false} onClick={noop} />
          <PanelToggle icon={Pin} label="Directives" count={0} active={false} onClick={noop} />
        </span>
      </div>

      {toolbarMode === 'fixed' && (
        <div className="ws-clear glass-panel flex min-h-[2.875rem] shrink-0 items-center border-b border-border-subtle px-3.5 py-1.5">
          <Toolbar editor={editor} pageConfig={DEFAULT_WRITING_DESK} />
        </div>
      )}

      <div className="custom-scrollbar relative flex-1 overflow-y-auto px-4 py-7">
        <div
          className="wd-sheet-locked relative mx-auto rounded-xl shadow-[0_2rem_4rem_-1.5rem_color-mix(in_srgb,var(--theme-shade)_75%,transparent)] ring-1 ring-shade/30"
          style={sheetStyleFor(DEFAULT_WRITING_DESK)}
        >
          <div className="writing-prose select-none">
            <h1>{chapter.heading}</h1>
            <div className="relative">
              <p>{withSelection(opening, selection)}</p>
              {selection && (
                <div className="absolute left-0 top-full z-10 mt-1.5 flex gap-1 rounded-card border border-border-default bg-surface-panel p-1 font-sans shadow-overlay">
                  <button
                    type="button"
                    data-tour="wd-invoke"
                    onClick={noop}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold leading-none text-on-accent transition-[filter] hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <AiGlyph className="h-4 w-4" /> Invoke AI
                  </button>
                  <button
                    type="button"
                    data-tour="wd-link"
                    aria-haspopup="menu"
                    onClick={noop}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-tint/[0.06] px-2.5 text-xs font-semibold leading-none text-text-secondary transition-colors hover:bg-tint/10 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <WorldbuildGlyph className="h-4 w-4" /> Link to world
                    <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-text-subtle" />
                  </button>
                </div>
              )}
            </div>
            {chapter.paragraphs.slice(1).map((text, index) => (index + 1 === chapter.suggestion.paragraph && reviewing ? (
              <div key={index} data-tour="wd-suggestion">
                <p><span className="wd-diff-removed">{text}</span></p>
                <div className="wd-diff-block-added">
                  <div className="wd-diff-block-tag">Suggested replacement</div>
                  <div><p>{chapter.suggestion.proposed}</p></div>
                </div>
              </div>
            ) : <p key={index}>{text}</p>))}
          </div>
        </div>

        {reviewing && (
          <div className="pointer-events-none sticky bottom-4 z-20 mt-4 flex flex-col items-center gap-2">
            <div data-tour="wd-review" role="group" aria-label="Review suggestion" className="pointer-events-auto flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border-default bg-surface-panel/95 py-1 pl-3 pr-1 shadow-overlay">
              <SuggestionPendingGlyph className="h-4 w-4" style={{ color: editing?.color || undefined }} />
              <span className="text-xs font-semibold text-text-primary">{editing?.name || 'Editing'}</span>
              <span className="text-xs text-text-subtle">· Replace</span>
              <span aria-hidden="true" className="mx-1 h-4 w-px bg-border-default" />
              <span className="text-xs tabular-nums">
                <span className="text-status-success">+{delta.added}</span>
                <span className="ml-1.5 text-status-danger">−{delta.removed}</span>
                <span className="ml-1 text-text-subtle">words</span>
              </span>
              <span aria-hidden="true" className="mx-1 h-4 w-px bg-border-default" />
              <button type="button" onClick={noop} className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold text-text-secondary transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Reject
              </button>
              <button type="button" onClick={noop} className="inline-flex h-8 items-center gap-1 rounded-full bg-accent px-3 text-xs font-semibold text-on-accent transition-[filter] hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> Accept
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
