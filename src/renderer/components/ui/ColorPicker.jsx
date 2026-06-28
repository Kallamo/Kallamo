import React, { useEffect, useRef, useState } from 'react';

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHex(r, g, b) {
  const h = (n) => Math.round(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

// Self-contained color picker (saturation/value square + hue slider + hex field) in the
// app's design, replacing the OS-native color dialog. onChange fires live; onChangeEnd
// fires when an interaction settles (good for recording recent colors).
export default function ColorPicker({ value, onChange, onChangeEnd }) {
  const lastEmitted = useRef(value);
  const [hsv, setHsv] = useState(() => { const { r, g, b } = hexToRgb(value || '#000000'); return rgbToHsv(r, g, b); });
  const [hexText, setHexText] = useState(value || '#000000');
  const svRef = useRef(null);
  const hueRef = useRef(null);

  // Resync from an external value change (e.g. a swatch picked elsewhere), but ignore
  // the echo of this component's own emits.
  useEffect(() => {
    if (!value || value.toLowerCase() === (lastEmitted.current || '').toLowerCase()) return;
    const { r, g, b } = hexToRgb(value);
    setHsv(rgbToHsv(r, g, b));
    setHexText(value);
  }, [value]);

  const emit = (h, s, v, end) => {
    const { r, g, b } = hsvToRgb(h, s, v);
    const hex = rgbToHex(r, g, b);
    lastEmitted.current = hex;
    setHexText(hex);
    onChange?.(hex);
    if (end) onChangeEnd?.(hex);
  };

  const dragSv = (e) => {
    const rect = svRef.current.getBoundingClientRect();
    const s = clamp01((e.clientX - rect.left) / rect.width);
    const v = 1 - clamp01((e.clientY - rect.top) / rect.height);
    setHsv(prev => { emit(prev.h, s, v, false); return { ...prev, s, v }; });
  };
  const dragHue = (e) => {
    const rect = hueRef.current.getBoundingClientRect();
    const h = clamp01((e.clientX - rect.left) / rect.width) * 360;
    setHsv(prev => { emit(h, prev.s, prev.v, false); return { ...prev, h }; });
  };

  const startDrag = (handler) => (e) => {
    e.preventDefault();
    handler(e);
    const move = (ev) => handler(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setHsv(prev => { emit(prev.h, prev.s, prev.v, true); return prev; });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const commitHex = () => {
    const t = hexText.startsWith('#') ? hexText : `#${hexText}`;
    if (/^#[a-f\d]{6}$/i.exec(t)) {
      const { r, g, b } = hexToRgb(t);
      setHsv(rgbToHsv(r, g, b));
      lastEmitted.current = t;
      onChange?.(t);
      onChangeEnd?.(t);
    } else {
      setHexText(value || '#000000');
    }
  };

  return (
    <div className="w-full select-none">
      <div
        ref={svRef}
        onPointerDown={startDrag(dragSv)}
        className="relative w-full h-28 rounded-md cursor-crosshair overflow-hidden"
        style={{ backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }}
      >
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, #fff, rgba(255,255,255,0))' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #000, rgba(0,0,0,0))' }} />
        <div
          className="absolute w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-full border-2 border-white shadow pointer-events-none"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
        />
      </div>

      <div
        ref={hueRef}
        onPointerDown={startDrag(dragHue)}
        className="relative w-full h-3 rounded-full mt-3 cursor-pointer"
        style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
      >
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 -ml-[7px] rounded-full border-2 border-white shadow pointer-events-none"
          style={{ left: `${(hsv.h / 360) * 100}%` }}
        />
      </div>

      <div className="flex items-center gap-2 mt-3">
        <span className="w-7 h-7 rounded-md border border-gray-700 shrink-0" style={{ backgroundColor: value }} />
        <input
          value={hexText}
          onChange={(e) => setHexText(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => { if (e.key === 'Enter') commitHex(); }}
          spellCheck={false}
          className="w-full bg-[#00080B] border border-gray-800 text-gray-200 text-xs rounded-md px-2.5 py-1.5 focus:outline-none focus:border-accent uppercase"
        />
      </div>
    </div>
  );
}
