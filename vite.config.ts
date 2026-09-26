import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // 同じ Wi-Fi の iPhone から開けるように LAN に公開する
    host: true,
  },
});
