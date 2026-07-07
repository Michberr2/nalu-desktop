import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

// Electron main + preload are built by vite-plugin-electron; the renderer is a
// normal Vite React app. In dev, the plugin launches Electron pointed at the
// Vite dev server.
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: { build: { outDir: 'dist-electron', rollupOptions: { external: ['electron', 'node-pty'] } } },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload()
        },
        vite: { build: { outDir: 'dist-electron', rollupOptions: { external: ['electron', 'node-pty'] } } },
      },
    ]),
    renderer(),
  ],
  base: './', // relative asset URLs so everything loads under file:// (packaged app)
  build: { outDir: 'dist' },
  clearScreen: false,
})
