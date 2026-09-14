import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron, { type ElectronOptions } from 'vite-plugin-electron'
import path from 'node:path'

const startDevelopment: NonNullable<ElectronOptions['onstart']> = async ({ startup }) => {
  const profile = process.env.NALU_DEV_PROFILE
  await startup(['.', ...(profile ? ['--user-data-dir=' + path.resolve(profile)] : [])])
}

const reloadPreload: NonNullable<ElectronOptions['onstart']> = async ({ startup, reload }) => {
  const child = (process as NodeJS.Process & { electronApp?: import('node:child_process').ChildProcess }).electronApp
  if (child && child.exitCode === null && child.signalCode === null) reload()
  else await startDevelopment({ startup, reload })
}

// With no "type":"module" in package.json, vite-plugin-electron emits CommonJS
// for the Electron main + preload (its default) — which is what Electron needs
// so the preload's contextBridge (window.nalu) actually loads.
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/entry.ts',
        onstart: startDevelopment,
        // Production entries build sequentially. Clear old main/worker chunks
        // once here; the preload entries then add their files to the same dir.
        vite: { build: { outDir: 'dist-electron', emptyOutDir: true, rolldownOptions: { external: ['electron', 'node-pty', 'electron-updater'], output: { entryFileNames: 'main.js' } } } },
      },
      {
        entry: 'electron/preload.ts',
        onstart: reloadPreload,
        vite: { build: { outDir: 'dist-electron', rolldownOptions: { external: ['electron'] } } },
      },
      {
        entry: 'electron/companionPreload.ts',
        onstart: reloadPreload,
        vite: { build: { outDir: 'dist-electron', rolldownOptions: { external: ['electron'] } } },
      },
      {
        // Preload for the Nalu Browser window — masks automation signals so real
        // web tasks aren't wrongly flagged as bots.
        entry: 'electron/webpreload.ts',
        onstart: reloadPreload,
        vite: { build: { outDir: 'dist-electron', rolldownOptions: { external: ['electron'] } } },
      },
    ]),
  ],
  base: './', // relative asset URLs so everything loads under file:// (packaged app)
  build: { outDir: 'dist' },
  clearScreen: false,
})
