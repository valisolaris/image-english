import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages は https://<ユーザー名>.github.io/image-english/ に公開されるため
  base: '/image-english/',
  server: {
    // 同じ Wi-Fi の iPhone から開けるように LAN に公開する
    host: true,
  },
  plugins: [
    VitePWA({
      // 新しい版を公開すると、起動時に裏で取り込まれ、その次の起動から新しい版になる
      // (公開後2回目の起動で反映。開いている画面が学習途中で勝手に再読み込みされることはない)
      registerType: 'autoUpdate',
      manifest: {
        name: 'Image English',
        short_name: 'Image English',
        description: '画像と例文で英単語を覚える単語カード',
        lang: 'ja',
        display: 'standalone',
        background_color: '#fafaf7',
        theme_color: '#2563eb',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // アプリ本体とカードデータ(deck.json)は初回に保存する(SPEC 6章 オフライン)。アイコンは manifest から自動で入る
        globPatterns: ['**/*.{js,css,html,json}'],
        // 画像は数千枚になるので事前保存せず、表示したものから保存する
        runtimeCaching: [
          {
            // このサイトの画像だけを対象にする
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/image-english/images/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'card-images',
              // 端末の容量が足りなくなったら、この画像キャッシュから消してよい
              expiration: { maxEntries: 5000, purgeOnQuotaError: true },
            },
          },
        ],
      },
    }),
  ],
});
