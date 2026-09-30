import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Minus, Plus, Trash2, Upload } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import { framedImageStyle } from './portraits';

const DEFAULT_FOCUS = { x: 50, y: 50, zoom: 1 };

// Choosing and framing an entity image. The frame is saved as a focus point and a zoom,
// so every size the image appears in shows the same part of it.
export default function WorldbuildImageDialog({ title, image, shape = 'square', busy = false, onChoose, onSaveFocus, onRemove, onClose }) {
  const inputRef = useRef(null);
  const frameRef = useRef(null);
  const drag = useRef(null);
  const [focus, setFocus] = useState(() => ({ ...DEFAULT_FOCUS, ...(image?.focus || {}) }));
  useEffect(() => { setFocus({ ...DEFAULT_FOCUS, ...(image?.focus || {}) }); }, [image?.imagePath]); // eslint-disable-line react-hooks/exhaustive-deps
  const framed = image?.imagePath ? { ...image, focus } : null;
  const wide = shape === 'wide';

  const pick = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file?.path) onChoose(file.path);
  };
  // Dragging moves the image under the frame, so the focus moves the opposite way.
  const onPointerDown = (event) => {
    if (!framed) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, start: focus };
  };
  const onPointerMove = (event) => {
    if (!drag.current || !frameRef.current) return;
    const { width, height } = frameRef.current.getBoundingClientRect();
    const dx = ((event.clientX - drag.current.x) / width) * 100 / Math.max(1, focus.zoom);
    const dy = ((event.clientY - drag.current.y) / height) * 100 / Math.max(1, focus.zoom);
    setFocus(current => ({ ...current, x: clamp(drag.current.start.x - dx), y: clamp(drag.current.start.y - dy) }));
  };
  const onPointerUp = () => { drag.current = null; };
  const onKeyDown = (event) => {
    const step = event.shiftKey ? 10 : 2;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!moves[event.key]) return;
    event.preventDefault();
    setFocus(current => ({ ...current, x: clamp(current.x + moves[event.key][0]), y: clamp(current.y + moves[event.key][1]) }));
  };

  return (
    <Modal onClose={onClose} size={wide ? 'xl' : 'lg'} title={title} icon={ImageIcon} iconClassName="text-text-muted">
      <div className={`flex gap-5 p-5 ${wide ? 'flex-col' : 'flex-col sm:flex-row sm:items-center'}`}>
        <div ref={frameRef} role="img" aria-label={framed ? 'Drag or use the arrow keys to frame the image' : 'No image yet'} tabIndex={framed ? 0 : -1}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onKeyDown={onKeyDown}
          style={framedImageStyle(framed)}
          className={`relative shrink-0 overflow-hidden rounded-card border border-border-default bg-surface-canvas/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${framed ? 'cursor-grab active:cursor-grabbing' : ''} ${wide ? 'aspect-[16/6] w-full' : 'h-64 w-64'}`}>
          {!framed && <button type="button" onClick={() => inputRef.current?.click()} className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm font-semibold text-text-muted hover:text-text-primary"><Upload className="h-5 w-5" aria-hidden="true" />Choose an image</button>}
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          {framed && !wide && (
            <div className="flex items-end gap-3" aria-hidden="true">
              <span className="h-16 w-16 rounded-card border border-border-default" style={framedImageStyle(framed)} />
              <span className="h-9 w-9 rounded-full border border-border-default" style={framedImageStyle(framed)} />
              <span className="h-6 w-6 rounded-full border border-border-default" style={framedImageStyle(framed)} />
            </div>
          )}
          {framed && <p className="caption">{wide ? 'Drag to frame it. The header and the scene use the same framing.' : 'Drag to frame the face. The same crop is used in every size.'}</p>}
          {framed && (
            <label className="flex items-center gap-2.5">
              <span className="sr-only">Zoom</span>
              <Minus className="h-3.5 w-3.5 text-text-subtle" aria-hidden="true" />
              <input type="range" min="1" max="3" step="0.05" value={focus.zoom} onChange={event => setFocus(current => ({ ...current, zoom: Number(event.target.value) }))} className="min-w-0 flex-1 accent-[var(--color-accent)]" aria-label="Zoom" />
              <Plus className="h-3.5 w-3.5 text-text-subtle" aria-hidden="true" />
            </label>
          )}
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={pick} />
          <Button size="sm" variant="ghost" icon={Upload} loading={busy} className="whitespace-nowrap" onClick={() => inputRef.current?.click()}>{framed ? 'Choose another image' : 'Choose an image'}</Button>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border-subtle px-5 py-3.5">
        {framed && onRemove && <Button variant="subtle" icon={Trash2} className="!text-status-danger" onClick={onRemove}>Remove</Button>}
        <span className="flex-1" />
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!framed} loading={busy} onClick={() => onSaveFocus(focus)}>{wide ? 'Save background' : 'Save portrait'}</Button>
      </div>
    </Modal>
  );
}

function clamp(value) { return Math.max(0, Math.min(100, Math.round(value * 10) / 10)); }
