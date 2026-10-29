// One age rule for the sheet, the calendar service and the AI context: a birth date makes the
// age follow the story clock, or stop at the death date. Without a birth date the stored age stands.

interface CalendarEra { id?: string; offset?: number; direction?: string }
interface WorldCalendar { eras?: CalendarEra[] }
interface WorldDate { eraId?: unknown; year?: unknown; month?: unknown; day?: unknown }

function absoluteYear(calendar: WorldCalendar, date: WorldDate): number {
  const era = calendar.eras?.find(item => item.id === date.eraId);
  const year = Number(date.year) || 1;
  return era?.direction === 'backward'
    ? Number(era.offset || 0) - (year - 1)
    : Number(era?.offset || 0) + (year - 1);
}

export function ageAt(calendar: WorldCalendar | null, birthDate: WorldDate | null | undefined, date: WorldDate | null | undefined): number | null {
  if (!calendar || !birthDate || !date) return null;
  let years = absoluteYear(calendar, date) - absoluteYear(calendar, birthDate);
  const month = Number(date.month), day = Number(date.day);
  const birthMonth = Number(birthDate.month), birthDay = Number(birthDate.day);
  if (month < birthMonth || (month === birthMonth && day < birthDay)) years -= 1;
  return years >= 0 ? years : null;
}

export function derivedAge(calendar: WorldCalendar | null, clock: WorldDate | null | undefined, data: Record<string, any> | null | undefined): string | null {
  if (!data?.birthDate) return data?.age ? String(data.age) : null;
  const reference = data.status === 'deceased' ? data.deathDate : clock;
  const age = ageAt(calendar, data.birthDate, reference);
  return age == null ? null : String(age);
}

// The birth date that gives this age on the clock's date, so turning an age into a birthday keeps the number.
export function birthDateForAge(calendar: WorldCalendar | null, clock: WorldDate | null | undefined, age: unknown): WorldDate | null {
  const years = Math.trunc(Number(age));
  if (!calendar || !clock || age === '' || age == null || !Number.isFinite(years) || years < 0) return null;
  const era = calendar.eras?.find(item => item.id === clock.eraId);
  const year = era?.direction === 'backward' ? Number(clock.year) + years : Number(clock.year) - years;
  return year >= 1 ? { eraId: clock.eraId, year, month: 1, day: 1 } : null;
}
