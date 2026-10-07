import React, { useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Tooltip from './ui/Tooltip';
import ColorPicker from './ui/ColorPicker';
import NumberInput from './ui/NumberInput';
import SegmentedControl from './ui/SegmentedControl';
import { FileCog } from 'lucide-react';
import { PAGE_PRESETS, PAPER_THEMES, pxToPt, ptToPx, isLightColor } from './WritingEditor';

function NumberField({ label, unit, value, onChange, min = 0 }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs font-medium text-text-subtle">{label}</span>
      <span className="flex h-9 items-center gap-1.5 rounded-control border border-border-default bg-surface-input px-2.5 focus-within:border-accent/70">
        <NumberInput
          min={min}
          value={value}
          onChange={onChange}
          className="min-w-0 flex-1 bg-transparent text-sm tabular-nums text-text-primary focus:outline-none"
        />
        <span className="text-xs text-text-subtle">{unit}</span>
      </span>
    </label>
  );
}

// A scaled sketch of the sheet, so every change reads before it is applied to the prose.
function PagePreview({ config }) {
  const w = config.pageWidth || 794;
  const h = config.pageHeight || 1123;
  const scale = Math.min(200 / w, 270 / h);
  const color = config.sheetColor || '#ffffff';
  const ink = isLightColor(color) ? 'rgba(40,40,40,.35)' : 'rgba(230,230,230,.35)';
  const indent = Math.round((config.firstLineIndent || 0) * scale);
  const lines = [[100, 100, 88], [100, 100, 70], [100, 94, 82]];
  return (
    <div aria-hidden="true" className="relative rounded-sm shadow-overlay" style={{ width: w * scale, height: h * scale, backgroundColor: color }}>
      <div
        className="absolute flex flex-col gap-1.5 border border-dashed"
        style={{
          left: (config.marginLeft ?? 96) * scale,
          right: (config.marginRight ?? 96) * scale,
          top: (config.marginTop ?? 96) * scale,
          bottom: (config.marginBottom ?? 96) * scale,
          borderColor: ink,
          padding: 4,
        }}
      >
        <span className="h-1.5 w-1/2 rounded-sm" style={{ backgroundColor: ink }} />
        {lines.map((paragraph, p) => (
          <span key={p} className="mt-1 flex flex-col gap-1">
            {paragraph.map((width, i) => (
              <span key={i} className="h-1 rounded-sm" style={{ backgroundColor: ink, width: i === 0 ? `calc(${width}% - ${indent}px)` : `${width}%`, marginLeft: i === 0 ? indent : 0 }} />
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}

const Section = ({ title, children }) => (
  <section>
    <h3 className="mb-3 text-sm font-bold text-text-primary">{title}</h3>
    {children}
  </section>
);

// Page setup for the current chapter. Each chapter keeps its own page settings.
export default function WritingPageModal({ config, chapterTitle, onChange, onClose }) {
  const orientation = config.orientation || 'portrait';
  const [showColorPicker, setShowColorPicker] = useState(false);
  const sheet = (config.sheetColor || '#ffffff').toLowerCase();
  const isPreset = PAPER_THEMES.some(t => t.color.toLowerCase() === sheet);

  const setOrientation = (o) => {
    if (o === orientation) return;
    onChange({ orientation: o, pageWidth: config.pageHeight, pageHeight: config.pageWidth });
  };

  const setSize = (size) => {
    if (size === 'Custom') { onChange({ pageSize: 'Custom' }); return; }
    const p = PAGE_PRESETS[size];
    const [w, h] = orientation === 'landscape' ? [p.pageHeight, p.pageWidth] : [p.pageWidth, p.pageHeight];
    onChange({ pageSize: size, pageWidth: w, pageHeight: h });
  };

  const row = 'flex items-center justify-between gap-4';

  return (
    <Modal onClose={onClose} size="wide" title="Page setup" subtitle={chapterTitle || null} icon={FileCog}>
      <div className="flex min-h-0">
        <div className="hidden w-64 shrink-0 items-center justify-center bg-shade/25 p-6 sm:flex">
          <PagePreview config={config} />
        </div>
        <div className="custom-scrollbar flex max-h-[70vh] min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
          <Section title="Paper">
            <div className="flex flex-col gap-3">
              <div className={row}>
                <span className="text-sm text-text-secondary">Size</span>
                <SegmentedControl label="Paper size" value={config.pageSize || 'A4'} onChange={setSize} options={['A4', 'Letter', 'Custom'].map(v => ({ value: v, label: v }))} />
              </div>
              {config.pageSize === 'Custom' && (
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label="Width" unit="px" min={200} value={config.pageWidth || 794} onChange={(v) => onChange({ pageWidth: v })} />
                  <NumberField label="Height" unit="px" min={200} value={config.pageHeight || 1123} onChange={(v) => onChange({ pageHeight: v })} />
                </div>
              )}
              <div className={row}>
                <span className="text-sm text-text-secondary">Orientation</span>
                <SegmentedControl label="Orientation" value={orientation} onChange={setOrientation} options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
              </div>
              <div className={row}>
                <span className="text-sm text-text-secondary">Colour</span>
                <div className="flex items-center gap-2">
                  {PAPER_THEMES.map(t => (
                    <Tooltip key={t.label} content={t.label}>
                      <button
                        type="button"
                        aria-label={`${t.label} paper`}
                        aria-pressed={sheet === t.color.toLowerCase()}
                        onClick={() => onChange({ sheetColor: t.color })}
                        className={`h-7 w-7 rounded-full border border-tint/20 transition-transform hover:scale-105 ${sheet === t.color.toLowerCase() ? 'ring-2 ring-text-primary ring-offset-2 ring-offset-surface-canvas' : ''}`}
                        style={{ backgroundColor: t.color }}
                      />
                    </Tooltip>
                  ))}
                  <Tooltip content="Custom colour">
                    <button
                      type="button"
                      aria-label="Custom paper colour"
                      aria-expanded={showColorPicker}
                      onClick={() => setShowColorPicker(s => !s)}
                      className={`h-7 w-7 rounded-full border border-tint/20 transition-transform hover:scale-105 ${!isPreset || showColorPicker ? 'ring-2 ring-text-primary ring-offset-2 ring-offset-surface-canvas' : ''}`}
                      style={{ background: isPreset ? 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' : config.sheetColor }}
                    />
                  </Tooltip>
                </div>
              </div>
              {showColorPicker && (
                <div className="ml-auto w-56">
                  <ColorPicker value={config.sheetColor || '#ffffff'} onChange={(c) => onChange({ sheetColor: c })} />
                </div>
              )}
            </div>
          </Section>

          <Section title="Margins">
            <div className="grid grid-cols-4 gap-3">
              <NumberField label="Top" unit="px" value={config.marginTop ?? 96} onChange={(v) => onChange({ marginTop: v })} />
              <NumberField label="Bottom" unit="px" value={config.marginBottom ?? 96} onChange={(v) => onChange({ marginBottom: v })} />
              <NumberField label="Left" unit="px" value={config.marginLeft ?? 96} onChange={(v) => onChange({ marginLeft: v })} />
              <NumberField label="Right" unit="px" value={config.marginRight ?? 96} onChange={(v) => onChange({ marginRight: v })} />
            </div>
          </Section>

          <Section title="Paragraph">
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="First-line indent" unit="pt" value={pxToPt(config.firstLineIndent ?? 0)} onChange={(v) => onChange({ firstLineIndent: ptToPx(v) })} />
            </div>
          </Section>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-5 py-3.5">
        <span className="text-xs text-text-subtle">Changes apply to this chapter as you make them.</span>
        <span className="flex-1" />
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}
