import { describe, expect, test } from 'vitest';

const { DEFAULT_CALENDAR, extractClockTarget } = require('../../src/main/features/worldbuild/calendar-service.js');

const clock = (hour: number, minute = 0) => ({ eraId: 'ce', year: 997, month: 5, day: 15, hour, minute });
const time = (text: string, futureOnly = false, start = clock(0)) => {
  const target = extractClockTarget(text, start, DEFAULT_CALENDAR, futureOnly);
  return target ? `${target.hour}:${String(target.minute).padStart(2, '0')}` : null;
};

describe('explicit clock in the text', () => {
  test('ignores a count that only looks like a time', () => {
    expect(time('O veterano crava a vara no chão e apoia as duas mãos no topo.')).toBeNull();
    expect(time('Quebrou as 3 varas de treino.')).toBeNull();
    expect(time('He looked at 2 doors.')).toBeNull();
  });

  test('reads a time of day once something marks it as one', () => {
    expect(time('Chegaram às três horas.')).toBe('3:00');
    expect(time('Saíram às 16h.')).toBe('16:00');
    expect(time('Às 14:30 o sino tocou.')).toBe('14:30');
    expect(time('Às duas e meia ele voltou.')).toBe('2:30');
    expect(time('O relógio marcava cinco.')).toBe('5:00');
    expect(time('They met at 9 pm.')).toBe('21:00');
  });

  test('places the afternoon and the night after noon', () => {
    expect(time('Partiram às duas da tarde.')).toBe('14:00');
    expect(time('Voltaram às 9 da noite.')).toBe('21:00');
    expect(time('Acordou às quatro da madrugada.')).toBe('4:00');
  });

  test('reads noon', () => {
    expect(time('Ao meio-dia a praça encheu.')).toBe('12:00');
  });

  test('treats a time already behind the clock as a recollection', () => {
    const text = 'Ele estava vagando pela colina às seis e meia da manhã. Voltaram às 15h.';
    expect(time(text, false, clock(14, 5))).toBe('15:00');
    expect(time('Ele estava vagando pela colina às seis e meia da manhã.', false, clock(14, 5))).toBeNull();
  });

  test('takes only a deadline from the player', () => {
    expect(time('Espero até as 18h.', true)).toBe('18:00');
    expect(time('Chego às 18h.', true)).toBeNull();
  });
});
