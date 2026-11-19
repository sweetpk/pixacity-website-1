import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function cleanRootAssetsPlugin() {
  return {
    name: 'clean-root-assets',
    buildStart() {
      const assetsDir = path.resolve(__dirname, 'assets');
      if (fs.existsSync(assetsDir)) {
        fs.rmSync(assetsDir, { recursive: true, force: true });
      }
    }
  };
}

export default defineConfig({
  root: 'src',
  base: './',
  publicDir: '../public',
  plugins: [
    react(),
    tailwindcss(),
    cleanRootAssetsPlugin()
  ],
  build: {
    outDir: '..',
    emptyOutDir: false
  },
  server: {
    port: 3000,
    open: false
  }
});
