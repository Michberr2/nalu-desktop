import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

// This bundle is ESM (package.json "type": "module"), so __dirname doesn't
// exist — derive it from import.meta.url.
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Nalu Desktop — Electron main. Security-hardened: contextIsolation on,
// nodeIntegration off. The renderer reaches the OS ONLY through the audited
// IPC channels below (exposed via preload's contextBridge).
// ---------------------------------------------------------------------------

const isDev = !!process.env.VITE_DEV_SERVER_URL
let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0c10',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: '#11141c', symbolColor: '#ededed', height: 30 },
    // Traffic lights live in their own thin strip at the very top; the app header
    // sits on the row below them.
    trafficLightPosition: { x: 14, y: 9 },
    icon: path.join(__dirname, '../build/wolf.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs node built-ins for fs/pty bridges
    },
  })

  win.once('ready-to-show', () => win?.show())

  // Show the Nalu wolf logo in the macOS dock (dev + packaged).
  if (process.platform === 'darwin') {
    try { app.dock?.setIcon(path.join(__dirname, '../build/icon.png')) } catch { /* icon optional */ }
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // open external links in the browser, not a new Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

// ---- Filesystem IPC --------------------------------------------------------

const IGNORE = new Set(['.git', 'node_modules', '.DS_Store', 'dist', 'dist-electron', '.next', 'release', 'build'])

ipcMain.handle('dialog:openFolder', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('fs:readDir', async (_e, dir: string) => {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => !IGNORE.has(e.name))
    .map((e) => ({ name: e.name, path: path.join(dir, e.name), dir: e.isDirectory() }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
})

ipcMain.handle('fs:readFile', async (_e, file: string) => {
  return await fs.readFile(file, 'utf8')
})

ipcMain.handle('fs:writeFile', async (_e, file: string, content: string) => {
  await fs.writeFile(file, content, 'utf8')
  return true
})

ipcMain.handle('fs:createFile', async (_e, dir: string, name: string) => {
  const p = path.join(dir, name)
  await fs.writeFile(p, '', { flag: 'wx' })
  return p
})

ipcMain.handle('fs:rename', async (_e, from: string, to: string) => {
  await fs.rename(from, to)
  return true
})

// ---- Terminal IPC — a REAL pseudo-terminal via node-pty --------------------
// A true pty gives a proper prompt, character echo, colors, and interactive
// programs (vim, top, npm prompts…) — everything a piped child_process can't.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PtyProc = { write(d: string): void; resize(c: number, r: number): void; kill(): void; onData(cb: (d: string) => void): void; onExit(cb: (e: { exitCode: number }) => void): void }
const shells: Record<string, PtyProc> = {}

ipcMain.handle('term:create', async (e, id: string, cwd: string) => {
  const pty = await import('node-pty')
  const shellPath = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh'
  const proc = pty.spawn(shellPath, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: cwd || os.homedir(),
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
  }) as unknown as PtyProc
  shells[id] = proc
  proc.onData((data) => e.sender.send(`term:data:${id}`, data))
  proc.onExit(({ exitCode }) => { e.sender.send(`term:exit:${id}`, exitCode); delete shells[id] })
  return true
})

ipcMain.on('term:input', (_e, id: string, data: string) => {
  shells[id]?.write(data)
})

ipcMain.on('term:resize', (_e, id: string, cols: number, rows: number) => {
  try { shells[id]?.resize(cols, rows) } catch { /* ignore transient resize */ }
})

ipcMain.handle('term:kill', (_e, id: string) => {
  shells[id]?.kill()
  delete shells[id]
  return true
})

// ---- App lifecycle ---------------------------------------------------------

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  Object.values(shells).forEach((c) => c.kill())
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

void isDev
