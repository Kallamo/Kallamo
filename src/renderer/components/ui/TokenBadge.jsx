import React from 'react';
import Badge from './Badge';

// Compact token count formatter: 1290000 -> "1.29M", 1300 -> "1.3k".
export function formatTokens(n) {
  if (!n || n < 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k';
  return (n / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
}

/**
 * Approximate token-count pill. Colors by severity: gray (small), amber (large),
 * red (very large / over `max` when a context window is provided).
 */
export default function TokenBadge({ tokens = 0, max = 0, className = '', severity = 'auto' }) {
  let tone = 'gray';
  if (severity === 'neutral') {
    tone = 'gray';
  } else if (max > 0) {
    const ratio = tokens / max;
    if (ratio >= 1) tone = 'red';
    else if (ratio >= 0.6) tone = 'amber';
  } else if (tokens >= 100000) {
    tone = 'red';
  } else if (tokens >= 20000) {
    tone = 'amber';
  }

  return (
    <span title={`~${tokens.toLocaleString()} tokens`} className={`inline-flex ${className}`}>
      <Badge tone={tone}>~{formatTokens(tokens)} tok</Badge>
    </span>
  );
}
