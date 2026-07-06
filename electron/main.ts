import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
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
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: '#11141c', symbolColor: '#ededed', height: 36 },
    trafficLightPosition: { x: 14, y: 12 },
    icon: path.join(__dirname, '../build/wolf.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs node built-ins for fs/pty bridges
    },
  })

  win.once('ready-to-show', () => win?.show())

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

// ---- Terminal IPC (a real shell via child_process) -------------------------
// Uses a login shell with piped stdio — no native pty module, so it installs
// and builds everywhere. (node-pty is the v1+ upgrade for full interactivity.)

const shells: Record<string, ChildProcessWithoutNullStreams> = {}

ipcMain.handle('term:create', (e, id: string, cwd: string) => {
  const shellPath = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh'
  const args = process.platform === 'win32' ? [] : ['-i']
  const child = spawn(shellPath, args, {
    cwd: cwd || os.homedir(),
    env: { ...process.env, TERM: 'xterm-256color' },
  })
  shells[id] = child
  const send = (data: Buffer) => e.sender.send(`term:data:${id}`, data.toString())
  child.stdout.on('data', send)
  child.stderr.on('data', send)
  child.on('exit', (code) => {
    e.sender.send(`term:exit:${id}`, code)
    delete shells[id]
  })
  return true
})

ipcMain.on('term:input', (_e, id: string, data: string) => {
  shells[id]?.stdin.write(data)
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
