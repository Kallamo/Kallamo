// One folding rule for names, evidence and categories, in any script.
// Drops only what carries no identity here: case, optional diacritics, typographic variants.

const ZERO_WIDTH = /[​-‍⁠﻿]/;

// Diacritics that writers add or omit freely: Latin/Greek/Cyrillic accents,
// Hebrew points, Arabic harakat and tatweel. Marks that change the letter stay.
const OPTIONAL_MARKS = /[̀-֑ͯ-ׇؐ-ًؚ-ٰٟۖ-ۭـ]/g;

const PUNCTUATION_MAP = new Map([
  ['‐', '-'], ['‑', '-'], ['‒', '-'], ['–', '-'],
  ['—', '-'], ['―', '-'], ['−', '-'],
  ['“', '"'], ['”', '"'], ['„', '"'], ['‟', '"'],
  ['«', '"'], ['»', '"'],
  ['‘', '"'], ['’', '"'], ['‚', '"'], ['‛', '"'], ['ʼ', '"'],
  ["'", '"'], ['`', '"'], ['´', '"'],
  ['…', '...'],
  ['ς', 'σ']
]);

const cache = new Map();

function foldChar(char) {
  let folded = cache.get(char);
  if (folded !== undefined) return folded;
  if (ZERO_WIDTH.test(char)) folded = '';
  else if (/\s/u.test(char)) folded = ' ';
  else {
    const mapped = PUNCTUATION_MAP.get(char) ?? char;
    folded = mapped.toLowerCase().normalize('NFKD').replace(OPTIONAL_MARKS, '').normalize('NFC');
    folded = [...folded].map(unit => PUNCTUATION_MAP.get(unit) ?? unit).join('');
  }
  if (cache.size < 20000) cache.set(char, folded);
  return folded;
}

const isUpper = char => /[\p{Lu}\p{Lt}]/u.test(char);

// Folds `text` and keeps, for every folded unit, where it came from and whether it was
// upper case there, so a match can be traced back to the original surface.
function foldWithMap(value) {
  const text = String(value == null ? '' : value);
  let out = '';
  const starts = [];
  const ends = [];
  const upper = [];
  let index = 0;
  for (const char of text) {
    const folded = foldChar(char);
    const end = index + char.length;
    for (const unit of folded) {
      if (unit === ' ' && (out.length === 0 || out[out.length - 1] === ' ')) continue;
      out += unit;
      for (let k = 0; k < unit.length; k++) { starts.push(index); ends.push(end); upper.push(isUpper(char)); }
    }
    index = end;
  }
  while (out.endsWith(' ')) { out = out.slice(0, -1); starts.pop(); ends.pop(); upper.pop(); }
  return { text: out, starts, ends, upper };
}

function foldText(value) {
  return foldWithMap(value).text;
}

module.exports = { foldText, foldWithMap, isUpper };
