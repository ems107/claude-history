import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // The dev instance's port, never the release's 7433: `pnpm dev` is the
      // source checkout talking to the source server. `PORT` overrides both.
      '/api': {
        target: `http://127.0.0.1:${process.env.PORT || 7434}`,
        changeOrigin: false,
        // The embedded terminal's socket lives under /api too, and without this
        // the upgrade is answered with the SPA's index.html instead of being
        // forwarded — which reads as a terminal that never connects.
        ws: true,
      },
    },
  },
});
