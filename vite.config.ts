import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(
      ['/api', '/dns-query'].map((path) => [
        path,
        {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
          configure(proxy) {
            proxy.on('proxyReq', (outgoing, incoming) => {
              // Translate only our own dev origin; foreign origins must still fail CSRF checks.
              if (incoming.headers.origin === 'http://127.0.0.1:5173')
                outgoing.setHeader('origin', 'http://127.0.0.1:8787');
            });
          },
        },
      ]),
    ),
  },
});
