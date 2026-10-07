import React, { useMemo } from 'react';

// A workspace without a cover image gets a topographic map drawn from its title:
// the same title always yields the same map and hue.
function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function contourHue(title = '') {
  return hashString(title || 'Kallamo') % 360;
}

function buildContours(title, width, height, lines) {
  const random = seededRandom(hashString(title || 'Kallamo'));
  const cx = width * (0.55 + random() * 0.25);
  const cy = height * (0.2 + random() * 0.3);
  const phase = [random() * 6.28, random() * 6.28, random() * 6.28];
  const paths = [];
  for (let k = 0; k < lines; k += 1) {
    const radius = 26 + k * 34;
    const points = [];
    for (let s = 0; s < 48; s += 1) {
      const angle = (s / 48) * Math.PI * 2;
      const wobble = 1 + 0.16 * Math.sin(3 * angle + phase[0] + k * 0.2)
        + 0.09 * Math.sin(5 * angle + phase[1])
        + 0.05 * Math.sin(2 * angle + phase[2] - k * 0.3);
      points.push(`${(cx + Math.cos(angle) * radius * 1.35 * wobble).toFixed(1)},${(cy + Math.sin(angle) * radius * wobble).toFixed(1)}`);
    }
    paths.push({ d: `M${points.join(' L')}Z`, opacity: Math.max(0.08, 0.55 - k * 0.04) });
  }
  return paths;
}

export default function ContourCover({ title, className = '', lines = 9, width = 600, height = 400, dim = false }) {
  const hue = contourHue(title);
  const paths = useMemo(() => buildContours(title, width, height, lines), [title, width, height, lines]);
  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 overflow-hidden ${className}`}
      style={{ background: `radial-gradient(90% 90% at 75% 25%, hsl(${hue} 45% ${dim ? 14 : 22}%), hsl(${hue} 40% ${dim ? 6 : 9}%) 70%)` }}
    >
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        {paths.map((path, index) => (
          <path key={index} d={path.d} fill="none" stroke={`hsl(${hue} 70% 70%)`} strokeOpacity={dim ? path.opacity * 0.45 : path.opacity} strokeWidth="1.2" />
        ))}
      </svg>
    </div>
  );
}
