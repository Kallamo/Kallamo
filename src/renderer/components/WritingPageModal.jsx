import React, { useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import ColorPicker from './ui/ColorPicker';
import { FileCog } from 'lucide-react';
import { PAGE_PRESETS, PAPER_THEMES, pxToPt, ptToPx } from './WritingEditor';

function Segmented({ value, options, onChange }) {
  return (
    <div className="flex bg-[#011419] border border-gray-700 rounded-lg p-1 gap-1">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer transition-all ${value === opt
            ? 'bg-[#1a2d32] text-white border border-accent/30 shadow'
            : 'text-gray-500 hover:text-white'}`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function NumberField({ label, value, onChange, min = 0, step = 1 }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-gray-400">
      {label}
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(e) => onChange(step < 1 ? parseFloat(e.target.value) || 0 : parseInt(e.target.value, 10) || 0)}
        className="bg-[#00080B] border border-gray-800 text-gray-200 text-xs rounded-md px-2.5 py-2 focus:outline-none focus:border-accent"
      />
    </label>
  );
}

// Page setup for the current chapter. Each chapter keeps its own page settings.
export default function WritingPageModal({ config, onChange, onClose }) {
  const orientation = config.orientation || 'portrait';
  const [showColorPicker, setShowColorPicker] = useState(false);

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

  return (
    <Modal onClose={onClose} size="lg" title="Page Setup" icon={FileCog}>
      <div className="p-5 space-y-5 overflow-y-auto custom-scrollbar max-h-[70vh]">
        <p className="caption">These settings apply to this chapter.</p>

        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-gray-200">Orientation</span>
          <Segmented value={orientation === 'landscape' ? 'Landscape' : 'Portrait'} options={['Portrait', 'Landscape']} onChange={(v) => setOrientation(v.toLowerCase())} />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-gray-200">Paper Size</span>
          <Segmented value={config.pageSize || 'A4'} options={['A4', 'Letter', 'Custom']} onChange={setSize} />
        </div>

        {config.pageSize === 'Custom' && (
          <div className="grid grid-cols-2 gap-4">
            <NumberField label="Width (px)" min={200} value={config.pageWidth || 794} onChange={(v) => onChange({ pageWidth: v })} />
            <NumberField label="Height (px)" min={200} value={config.pageHeight || 1123} onChange={(v) => onChange({ pageHeight: v })} />
          </div>
        )}

        <div>
          <span className="text-sm font-bold text-gray-200 block mb-2">Margins (px)</span>
          <div className="grid grid-cols-4 gap-3">
            <NumberField label="Top" value={config.marginTop ?? 96} onChange={(v) => onChange({ marginTop: v })} />
            <NumberField label="Bottom" value={config.marginBottom ?? 96} onChange={(v) => onChange({ marginBottom: v })} />
            <NumberField label="Left" value={config.marginLeft ?? 96} onChange={(v) => onChange({ marginLeft: v })} />
            <NumberField label="Right" value={config.marginRight ?? 96} onChange={(v) => onChange({ marginRight: v })} />
          </div>
        </div>

        <div>
          <span className="text-sm font-bold text-gray-200 block mb-2">Paragraph</span>
          <div className="grid grid-cols-2 gap-4">
            <NumberField label="First-line indent (pt)" value={pxToPt(config.firstLineIndent ?? 0)} onChange={(v) => onChange({ firstLineIndent: ptToPx(v) })} />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-gray-200">Paper Color</span>
            <div className="flex items-center gap-2">
              {PAPER_THEMES.map(t => (
                <button
                  key={t.label}
                  type="button"
                  title={t.label}
                  onClick={() => onChange({ sheetColor: t.color })}
                  className={`w-6 h-6 rounded-full border ${(config.sheetColor || '#ffffff').toLowerCase() === t.color.toLowerCase() ? 'border-accent ring-1 ring-accent' : 'border-gray-700'}`}
                  style={{ backgroundColor: t.color }}
                />
              ))}
              <button
                type="button"
                onClick={() => setShowColorPicker(s => !s)}
                title="Custom color"
                className={`w-7 h-7 rounded-md border ${showColorPicker ? 'border-accent ring-1 ring-accent' : 'border-gray-700'}`}
                style={{ backgroundColor: config.sheetColor || '#ffffff' }}
              />
            </div>
          </div>
          {showColorPicker && (
            <div className="mt-3 max-w-[220px] ml-auto">
              <ColorPicker value={config.sheetColor || '#ffffff'} onChange={(c) => onChange({ sheetColor: c })} />
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 flex justify-end gap-2 px-5 py-3 border-t border-gray-800/50 bg-[#0a161d]/40">
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}
