// Place and time labels for a roleplay turn frame, shared by the chat and the archive log.

export const formatFrameDate = point => {
  if (!point?.position) return '';
  const { position, display } = point;
  return `${position.day} ${display?.monthName || `Month ${position.month}`} ${position.year}${display?.eraShortName ? ` ${display.eraShortName}` : ''}`;
};

export const formatFrameTime = point => point?.position
  ? `${String(point.position.hour ?? 0).padStart(2, '0')}:${String(point.position.minute ?? 0).padStart(2, '0')}`
  : '';

export const formatFrameWeekday = point => point?.display?.weekdayName || '';

export const sameFrameDate = (left, right) => left?.position && right?.position
  && left.position.eraId === right.position.eraId
  && left.position.year === right.position.year
  && left.position.month === right.position.month
  && left.position.day === right.position.day;

// Short dialogue beats move the clock a little; only a real jump earns a visible transition.
export const shouldShowTimeTransition = frame => {
  if (!frame?.advance) return false;
  const duration = frame.advance.duration || {};
  return !sameFrameDate(frame.start, frame.end)
    || Number(duration.years) > 0
    || Number(duration.months) > 0
    || Number(duration.days) > 0
    || Number(duration.hours) > 0
    || Number(duration.minutes) >= 30;
};

export const framePlaceKey = point => point?.locationId || point?.locationName || null;

const spanAmount = (amount, unit) => `${amount} ${amount === 1 ? String(unit).replace(/s$/, '') : unit}`;

const SPAN_CHECK_FAILURES = {
  'excerpt-not-found': () => 'the cited excerpt is not in this turn',
  'amount-mismatch': check => `${spanAmount(check.amount, check.unit)} does not match "${check.excerpt}"`,
  incomplete: () => 'the cited span has no amount or unit'
};

// One line on a time skip the turn cited: what it did to the clock, or why it was not trusted.
export const describeSpanCheck = check => {
  if (!check) return null;
  if (!check.verified) {
    const reason = (SPAN_CHECK_FAILURES[check.reason] || SPAN_CHECK_FAILURES.incomplete)(check);
    return { warning: true, text: `Time skip not verified: ${reason}. Held to a week.` };
  }
  const cited = `cited "${check.excerpt}"`;
  if (check.asserts === 'framing') return { warning: false, text: `Framing only · ${cited} · clock not forced` };
  if (check.asserts === 'history') return { warning: false, text: `Recounted history · ${cited} · clock not moved` };
  return { warning: false, text: `Skip of ${spanAmount(check.amount, check.unit)} · ${cited} · verified` };
};
