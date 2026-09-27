import { describe, expect, it } from 'vitest';
import { blankSentence, splitSentence, targetPattern } from '../src/card';

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

  it('記号で終わる語(a.m.)も強調・穴埋めできる', () => {
    const s = 'I get up at seven a.m. every day.';
    expect(splitSentence(s, 'a.m.').filter((p) => p.target).map((p) => p.text)).toEqual(['a.m.']);
    expect(blankSentence(s, 'a.m.')).toBe('I get up at seven a____ every day.');
  });

  it("記号で始まる語('m)は I'm の中でも一致し、穴埋めは最初の英字まで出す", () => {
    const s = "I'm hungry, so I'm going to eat now.";
    expect(splitSentence(s, "'m").filter((p) => p.target)).toHaveLength(2);
    expect(blankSentence(s, "'m")).toBe("I'm____ hungry, so I'm____ going to eat now.");
  });

  it('文頭の語や、同じ語が続けて出てくる場合も強調できる(後読みを使わない書き方の確認)', () => {
    expect(splitSentence('Do you do it?', 'Do')).toEqual([
      { text: 'Do', target: true },
      { text: ' you do it?', target: false },
    ]);
    expect(splitSentence('I had had enough.', 'had').filter((p) => p.target)).toHaveLength(2);
    expect(splitSentence('I had had enough.', 'had').map((p) => p.text).join('')).toBe('I had had enough.');
  });

  it('正規表現に後読み (?<) を使わない(iOS 16.4 より前の Safari 対策)', () => {
    expect(targetPattern('apple').source).not.toContain('(?<');
  });

  it('記号で始まる語でも、後ろに英字が続く場合は一致しない', () => {
    expect(splitSentence("I'mm", "'m").filter((p) => p.target)).toHaveLength(0);
  });
});
