// 開発時だけ使う操作(spec P5・T9)。main.ts から import.meta.env.DEV のときだけ読み込むので、
// 本番ビルド(npm run build)の成果物には含まれない。

export function devPanel(today: string, offset: number, onAdvance: () => void): HTMLElement {
  const box = document.createElement('div');
  box.className = 'dev-panel';

  const info = document.createElement('p');
  info.textContent = `開発用: 学習日 ${today}(+${offset}日)`;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '日付を1日進める';
  btn.addEventListener('click', onAdvance);

  box.append(info, btn);
  return box;
}
