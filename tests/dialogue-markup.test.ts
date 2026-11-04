import { describe, expect, test } from 'vitest';
import { markDialogue, parseMarkdown, parseMarkdownCached } from '../src/renderer/utils/markdown';

const span = (mark: string, html: string) => `<span class="dialogue" data-mark="${mark}">${html}</span>`;

describe('colored dialogue markup', () => {
  test('marks closed quotes, straight and curly', () => {
    expect(markDialogue('She said &quot;close the door&quot; and left.'))
      .toBe(`She said ${span('quotes', '&quot;close the door&quot;')} and left.`);
    expect(markDialogue('He whispered “not yet”.')).toBe(`He whispered ${span('quotes', '“not yet”')}.`);
    expect(markDialogue('«Bonsoir», dit-il.')).toBe(`${span('guillemets', '«Bonsoir»')}, dit-il.`);
  });

  test('leaves quotes that never close', () => {
    expect(markDialogue('She said &quot;close the door and left.')).toBe('She said &quot;close the door and left.');
    expect(markDialogue('He whispered “not yet.')).toBe('He whispered “not yet.');
  });

  test('a line that opens with a dash is speech until the line ends', () => {
    expect(markDialogue('— Fecha a porta.')).toBe(`— ${span('dash', 'Fecha a porta.')}`);
  });

  test('spaced dashes switch between speech and narration', () => {
    expect(markDialogue('— Fecha — disse ele. — Agora.'))
      .toBe(`— ${span('dash', 'Fecha')} — disse ele. — ${span('dash', 'Agora.')}`);
  });

  test('a mid-line dash needs a closing dash', () => {
    expect(markDialogue('ele hesitou — e saiu')).toBe('ele hesitou — e saiu');
    expect(markDialogue('Ela falou — vem cá — e sorriu.')).toBe(`Ela falou —${span('dash', ' vem cá ')}— e sorriu.`);
  });

  test('quotes inside dash speech are marked inside it, never across it', () => {
    expect(markDialogue('— Ele disse “não” ontem.'))
      .toBe(`— ${span('dash', `Ele disse ${span('quotes', '“não”')} ontem.`)}`);
  });

  test('the parser leaves code, links and images alone', () => {
    const html = parseMarkdown('Run `say "hi"` now.\n\n```js\nconst a = "x";\n```\n\n![a "b"](pic.png)', false, { dialogue: true });
    expect(html).not.toContain('class="dialogue"');
  });

  test('only marks when asked, and keeps the two results apart in the cache', () => {
    expect(parseMarkdown('“Hi.”')).not.toContain('dialogue');
    expect(parseMarkdown('“Hi.”', false, { dialogue: true })).toContain(span('quotes', '“Hi.”'));
    expect(parseMarkdownCached('“Cached.”')).not.toContain('dialogue');
    expect(parseMarkdownCached('“Cached.”', { dialogue: true })).toContain('dialogue');
  });
});
