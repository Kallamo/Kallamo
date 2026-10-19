const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function toneFor(percentage) {
  if (percentage >= 95) return 'text-status-danger';
  if (percentage >= 75) return 'text-orange-400';
  return 'text-accent';
}

export default function ContextMeter({ tokens, threshold }) {
  const percentage = Math.min(Math.round((tokens / threshold) * 100), 100);
  const tone = toneFor(percentage);
  return (
    <span
      role="img"
      aria-label={`Active context ${percentage}% used`}
      data-tooltip={`Active context: ~${tokens.toLocaleString()} / ${threshold.toLocaleString()} tokens`}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium tabular-nums text-text-secondary select-none"
    >
      <svg viewBox="0 0 18 18" className={`h-[1.125rem] w-[1.125rem] -rotate-90 ${tone}`} aria-hidden="true">
        <circle cx="9" cy="9" r={RADIUS} fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2.5" />
        <circle
          cx="9"
          cy="9"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${(CIRCUMFERENCE * percentage) / 100} ${CIRCUMFERENCE}`}
          className="transition-[stroke-dasharray] duration-500"
        />
      </svg>
      {percentage}% context
    </span>
  );
}
