// 読み上げ(Web Speech API の speechSynthesis)。en-US の声を優先して選ぶ。
// iPhone は最初の再生がタップ操作の中でないと鳴らないので、speak はクリック処理の中から同期的に呼ぶ。

const RATE_NORMAL = 1.0;

let voice: SpeechSynthesisVoice | null = null;

function pickVoice(): void {
  const voices = speechSynthesis.getVoices();
  const lang = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-');
  voice =
    voices.find((v) => lang(v) === 'en-US' && v.localService) ??
    voices.find((v) => lang(v) === 'en-US') ??
    voices.find((v) => lang(v).startsWith('en')) ??
    null;
}

export const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window;

if (speechAvailable) {
  pickVoice();
  // 声の一覧は後から届くことがある
  speechSynthesis.addEventListener('voiceschanged', pickVoice);
}

/** 今の読み上げを止めて、texts を順番に読み上げる */
export function speak(...texts: string[]): void {
  if (!speechAvailable) return;
  speechSynthesis.cancel();
  for (const text of texts) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    if (voice) u.voice = voice;
    u.rate = RATE_NORMAL;
    speechSynthesis.speak(u);
  }
}

export function stopSpeaking(): void {
  if (speechAvailable) speechSynthesis.cancel();
}
