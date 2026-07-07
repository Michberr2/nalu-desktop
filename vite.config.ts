import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

// With no "type":"module" in package.json, vite-plugin-electron emits CommonJS
// for the Electron main + preload (its default) — which is what Electron needs
// so the preload's contextBridge (window.nalu) actually loads.
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
        onstart: (args) => args.reload(),
        vite: { build: { outDir: 'dist-electron', rollupOptions: { external: ['electron'] } } },
      },
    ]),
    renderer(),
  ],
  base: './', // relative asset URLs so everything loads under file:// (packaged app)
  build: { outDir: 'dist' },
  clearScreen: false,
})
