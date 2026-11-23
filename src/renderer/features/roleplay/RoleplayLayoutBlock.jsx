import { createContext, useContext } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, EyeOff, GripVertical } from 'lucide-react';
import IconButton from '../../components/ui/IconButton';

// While editing, a block's own section title becomes its header (grip, collapse, move, hide),
// so the block does not show its name twice.
const BlockHeaderContext = createContext(null);
// Marks a block being moved, so the workspace's file drop leaves the drag alone.
export const BLOCK_DRAG_TYPE = 'application/x-kallamo-layout-block';
export const useBlockHeader = () => useContext(BlockHeaderContext);

export function BlockHeader({ block, title }) {
  const { label, collapsed, editing, canMoveUp, canMoveDown, onToggle, onStep, onHide } = block;
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <div className={`flex min-h-7 items-center justify-between gap-2 px-1 ${collapsed && !editing ? '' : 'mb-2'}`}>
      <span className="flex min-w-0 items-center gap-1">
        {editing && <GripVertical aria-hidden="true" className="h-4 w-4 shrink-0 cursor-grab text-text-subtle" />}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
          className="inline-flex min-w-0 items-center gap-1 rounded-md px-0.5 text-text-subtle transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <span className="eyebrow truncate">{title || label}</span>
          <Chevron aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        </button>
      </span>
      {editing && (
        <span className="flex shrink-0 items-center">
          <IconButton icon={ArrowUp} label={`Move ${label} up`} size="sm" disabled={!canMoveUp} onClick={() => onStep(-1)} />
          <IconButton icon={ArrowDown} label={`Move ${label} down`} size="sm" disabled={!canMoveDown} onClick={() => onStep(1)} />
          <IconButton icon={EyeOff} label={`Hide ${label}`} size="sm" onClick={onHide} />
        </span>
      )}
    </div>
  );
}

// `titled` blocks carry a SectionHead that takes the header role; the others get one drawn here.
export function LayoutBlock({ block, titled = false, dropEdge = null, dragging = false, dragHandlers, children }) {
  if (block.hidden) return null;
  const header = block.collapsed || (block.editing && !titled);
  const body = !block.collapsed && children;
  if (!block.editing) {
    return (
      <div>
        {block.collapsed && <BlockHeader block={block} />}
        {body}
      </div>
    );
  }
  return (
    <div
      draggable
      {...dragHandlers}
      className={`relative rounded-card border border-dashed p-2 transition-colors [&_a]:[-webkit-user-drag:none] [&_img]:[-webkit-user-drag:none] ${dragging ? 'border-accent/55 bg-accent/[0.05] opacity-70' : 'border-tint/20 bg-tint/[0.02]'}`}
    >
      {dropEdge && <span aria-hidden="true" className={`pointer-events-none absolute inset-x-2 h-[3px] rounded-full bg-accent ${dropEdge === 'before' ? '-top-2' : '-bottom-2'}`} />}
      {header && <BlockHeader block={block} />}
      <BlockHeaderContext.Provider value={header ? null : block}>{body}</BlockHeaderContext.Provider>
    </div>
  );
}
