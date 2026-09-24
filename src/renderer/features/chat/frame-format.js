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
