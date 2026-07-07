import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

// Built as CommonJS (.cjs), so __dirname is provided natively.

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

ipcMain.handle('fs:mkdir', async (_e, dir: string, name: string) => {
  const p = path.join(dir, name)
  await fs.mkdir(p, { recursive: false })
  return p
})

ipcMain.handle('fs:delete', async (_e, target: string) => {
  await fs.rm(target, { recursive: true, force: true })
  return true
})

// ---- Cross-file search (like VS Code "Find in Files") ----------------------
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|md|py|rs|go|java|c|cpp|h|sh|yml|yaml|sql|toml|txt|vue|svelte|rb|php|xml|env|gitignore)$/i
async function searchDir(root: string, dir: string, q: string, out: Array<{ file: string; rel: string; line: number; text: string }>, cap: number) {
  if (out.length >= cap) return
  let entries: import('node:fs').Dirent[]
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (out.length >= cap) return
    if (IGNORE.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) { await searchDir(root, full, q, out, cap) }
    else if (TEXT_EXT.test(e.name)) {
      try {
        const content = await fs.readFile(full, 'utf8')
        if (content.length > 2_000_000) continue
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(q)) {
            out.push({ file: full, rel: path.relative(root, full), line: i + 1, text: lines[i].trim().slice(0, 200) })
            if (out.length >= cap) return
          }
        }
      } catch { /* skip unreadable */ }
    }
  }
}
ipcMain.handle('fs:search', async (_e, root: string, query: string) => {
  const q = (query || '').toLowerCase().trim()
  if (!q || !root) return []
  const out: Array<{ file: string; rel: string; line: number; text: string }> = []
  await searchDir(root, root, q, out, 300)
  return out
})

// ---- Git integration (spawn the system git) --------------------------------
function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const p = spawn('git', args, { cwd })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => resolve({ ok: code === 0, out }))
    p.on('error', () => resolve({ ok: false, out: 'git not found' }))
  })
}
ipcMain.handle('git:status', async (_e, cwd: string) => {
  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!branch.ok) return { repo: false }
  const status = await git(cwd, ['status', '--porcelain=v1'])
  const files = status.out.split('\n').filter(Boolean).map((l) => ({ x: l[0], y: l[1], path: l.slice(3) }))
  return { repo: true, branch: branch.out.trim(), files }
})
ipcMain.handle('git:diff', async (_e, cwd: string, file?: string) =>
  (await git(cwd, file ? ['diff', 'HEAD', '--', file] : ['diff', 'HEAD'])).out)
ipcMain.handle('git:stage', async (_e, cwd: string, file: string) => (await git(cwd, ['add', '--', file])).ok)
ipcMain.handle('git:unstage', async (_e, cwd: string, file: string) => (await git(cwd, ['reset', 'HEAD', '--', file])).ok)
ipcMain.handle('git:commit', async (_e, cwd: string, msg: string) => (await git(cwd, ['commit', '-m', msg])).out)
// total added/removed lines across all changes (staged + unstaged), for the
// "Changes +X −Y" pill.
ipcMain.handle('git:stat', async (_e, cwd: string) => {
  const r = await git(cwd, ['diff', 'HEAD', '--numstat'])
  let added = 0, removed = 0
  for (const line of r.out.split('\n')) {
    const m = line.match(/^(\d+)\t(\d+)\t/)
    if (m) { added += +m[1]; removed += +m[2] }
  }
  return { added, removed }
})
ipcMain.handle('git:commitPush', async (_e, cwd: string, msg: string) => {
  await git(cwd, ['add', '-A'])
  const c = await git(cwd, ['commit', '-m', msg])
  const p = await git(cwd, ['push'])
  return { commit: c.out, push: p.out, ok: p.ok }
})

// ---- One-shot command exec (for the AI agent to run + capture output) ------
ipcMain.handle('sys:exec', async (_e, cwd: string, command: string) => {
  return await new Promise<{ code: number; output: string }>((resolve) => {
    const sh = process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh'
    const args = process.platform === 'win32' ? ['-Command', command] : ['-lc', command]
    const p = spawn(sh, args, { cwd: cwd || os.homedir(), env: process.env })
    let out = ''
    const cap = (d: Buffer) => { if (out.length < 40000) out += d.toString() }
    p.stdout.on('data', cap)
    p.stderr.on('data', cap)
    const timer = setTimeout(() => { p.kill(); resolve({ code: 124, output: out + '\n[timed out after 60s]' }) }, 60000)
    p.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 0, output: out.slice(0, 40000) }) })
    p.on('error', (err) => { clearTimeout(timer); resolve({ code: 1, output: String(err) }) })
  })
})

// ---- Computer control (screen + mouse + keyboard + AppleScript) ------------
// The AI operates the Mac like a person: it SEES via screenshots and ACTS via
// osascript (System Events) — mouse, keyboard, and full AppleScript automation.
// Requires macOS Screen Recording + Accessibility permissions (granted once).
const osa = (script: string): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => {
    const p = spawn('osascript', ['-e', script])
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => resolve({ ok: code === 0, out: out.trim() }))
    p.on('error', (err) => resolve({ ok: false, out: String(err) }))
  })

ipcMain.handle('pc:screenshot', async () => {
  const raw = path.join(os.tmpdir(), `nalu-shot-${Date.now()}.png`)
  const small = raw.replace('.png', '.jpg')
  await new Promise<void>((res) => { const p = spawn('screencapture', ['-x', '-C', raw]); p.on('close', () => res()); p.on('error', () => res()) })
  // Downscale to a compact JPEG (max 1512px wide) — small payload = fast vision
  // and well under the serverless body limit.
  await new Promise<void>((res) => { const p = spawn('sips', ['-Z', '1512', '-s', 'format', 'jpeg', '-s', 'formatOptions', '72', raw, '--out', small]); p.on('close', () => res()); p.on('error', () => res()) })
  try {
    const buf = await fs.readFile(small).catch(() => fs.readFile(raw))
    await fs.rm(raw, { force: true }); await fs.rm(small, { force: true })
    const mime = buf.length && small ? 'image/jpeg' : 'image/png'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch { return '' }
})
ipcMain.handle('pc:screenSize', async () => {
  const r = await osa('tell application "Finder" to get bounds of window of desktop')
  const m = r.out.match(/(\d+), (\d+), (\d+), (\d+)/)
  return m ? { w: +m[3], h: +m[4] } : { w: 1440, h: 900 }
})
ipcMain.handle('pc:click', async (_e, x: number, y: number, dbl?: boolean) => {
  // uses cliclick if present (precise), else AppleScript fallback
  const cmd = dbl ? `dc:${x},${y}` : `c:${x},${y}`
  const r = await new Promise<{ ok: boolean; out: string }>((res) => {
    const p = spawn('cliclick', [cmd]); let o = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d)
    p.on('close', c => res({ ok: c === 0, out: o })); p.on('error', () => res({ ok: false, out: 'no-cliclick' }))
  })
  if (r.ok) return true
  // fallback: AppleScript can't move the cursor natively; report so the model uses keys/menus instead
  return false
})
ipcMain.handle('pc:type', async (_e, text: string) => {
  const esc = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return (await osa(`tell application "System Events" to keystroke "${esc}"`)).ok
})
ipcMain.handle('pc:key', async (_e, combo: string) => {
  // e.g. "cmd+t", "return", "tab"
  const parts = combo.toLowerCase().split('+')
  const key = parts.pop() || ''
  const mods = parts.map((m) => ({ cmd: 'command down', ctrl: 'control down', alt: 'option down', opt: 'option down', shift: 'shift down' }[m])).filter(Boolean)
  const special: Record<string, number> = { return: 36, enter: 36, tab: 48, space: 49, esc: 53, escape: 53, delete: 51, left: 123, right: 124, down: 125, up: 126 }
  const usingClause = mods.length ? ` using {${mods.join(', ')}}` : ''
  const script = special[key] != null
    ? `tell application "System Events" to key code ${special[key]}${usingClause}`
    : `tell application "System Events" to keystroke "${key}"${usingClause}`
  return (await osa(script)).ok
})
ipcMain.handle('pc:applescript', async (_e, script: string) => await osa(script))
ipcMain.handle('pc:open', async (_e, target: string) => {
  // an app name or a URL
  return await new Promise<boolean>((res) => { const p = spawn('open', /^https?:\/\//.test(target) ? [target] : ['-a', target]); p.on('close', c => res(c === 0)); p.on('error', () => res(false)) })
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
