import { describe, expect, it } from 'vitest';
import { blankSentence, splitSentence } from '../src/card';

describe('例文の強調と穴埋め(D5)', () => {
  it('変化形(target_form)で強調する', () => {
    const parts = splitSentence('We ate pizza together at the party last night.', 'ate');
    expect(parts).toEqual([
      { text: 'We ', target: false },
      { text: 'ate', target: true },
      { text: ' pizza together at the party last night.', target: false },
    ]);
  });

  it('単語の一部には一致しない(and は hand の中では強調しない)', () => {
    const parts = splitSentence('Give me your hand and smile.', 'and');
    expect(parts.filter((p) => p.target)).toHaveLength(1);
    expect(parts.map((p) => p.text).join('')).toBe('Give me your hand and smile.');
  });

  it('穴埋めは最初の1文字 + ____', () => {
    expect(blankSentence('The baby is sleeping on the bed right now.', 'sleeping')).toBe(
      'The baby is s____ on the bed right now.',
    );
  });
});
