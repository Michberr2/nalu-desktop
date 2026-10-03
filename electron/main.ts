import { ChromeBrowser } from './chromeBrowser'
import { inspectBrowserPage } from './browserPage'
import { desktopCompanion } from './companion'
import { randomUUID } from 'node:crypto'
import { runCommand } from './commandRunner'
import { app, autoUpdater as nativeUpdater, BrowserWindow, ipcMain as rawIpcMain, dialog, shell, systemPreferences } from 'electron'
import { pathToFileURL } from 'node:url'
import { trustedIpc, isRendererEntry, isExternalWebUrl } from './rendererSecurity'
import { promises as fs } from 'node:fs'
import * as fsSync from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { workspaceStatus, workspaceDiff } from './gitWorkspace'
import { installDesktopCli } from './cliInstall'
import { TerminalSessions } from './terminalSessions'
import { SessionJournal } from './sessionJournal'
import { renameEntry } from './renameEntry'
import { createEntry } from './createEntry'
import { readTextFile } from './readTextFile'
import { searchFiles } from './fileSearch'
import { commitAndPush } from './commitAndPush'
import { parseSession } from '../src/lib/workspaceSession'
import { UpdateController, type DesktopUpdateState } from './updateController'

// Built as CommonJS (.cjs), so __dirname is provided natively.

// ---------------------------------------------------------------------------
// Nalu Desktop — Electron main. Security-hardened: contextIsolation on,
// nodeIntegration off. The renderer reaches the OS ONLY through the audited
// IPC channels below (exposed via preload's contextBridge).
// ---------------------------------------------------------------------------

const isDev = !!process.env.VITE_DEV_SERVER_URL
let win: BrowserWindow | null = null
let companion: ReturnType<typeof desktopCompanion> | null = null
let quitting = false
const rendererEntry = process.env.VITE_DEV_SERVER_URL || pathToFileURL(path.join(__dirname, '../dist/index.html')).href
const ipcMain = trustedIpc(rawIpcMain, () => win, () => rendererEntry)
const chromeBrowser = new ChromeBrowser(path.join(app.getPath('userData'), 'Chrome'), state => { if (win && !win.isDestroyed()) win.webContents.send('pc:preview', state) })
const browserResult = async (work: () => Promise<string>) => { try { return { ok: true, out: await work() } } catch (error) { return { ok: false, out: error instanceof Error ? error.message : 'Browser action failed.' } } }
const sessionJournal = new SessionJournal(path.join(app.getPath('userData'), 'workspace-recovery.json'))
let workspaceSaved = false
let updater: UpdateController | null = null
let updateActivity = { blocked: true, idleMs: 0, seen: 0 }
ipcMain.handle('updates:get', (): DesktopUpdateState => updater?.state ?? { phase: 'disabled' })
ipcMain.handle('updates:check', () => updater?.check())
ipcMain.on('updates:activity', (_event, blocked: boolean, idleMs: number) => {
  if (typeof blocked !== 'boolean' || !Number.isFinite(idleMs) || idleMs < 0) return
  updateActivity = { blocked, idleMs, seen: Date.now() }
})
ipcMain.handle('workspace:load', () => sessionJournal.read())
ipcMain.handle('workspace:save', async (_event, raw: string) => {
  parseSession(raw)
  await sessionJournal.write(raw)
  workspaceSaved = true
})

// ---------------------------------------------------------------------------
// Nalu in the terminal. The full CLI ships with the desktop app.
//   nalu                 — full interactive coding agent
//   nalu-claude <prompt>  — optional Claude API helper
//   nalu-gpt <prompt>     — optional OpenAI API helper
// Every frontier answer is appended to ~/.nalu/training/capture.jsonl so Nalu can
// train off it (continuous distillation toward the frontier). Config (Nalu token +
// your frontier keys) lives in ~/.nalu/cli.json, synced from the app on login.
// ---------------------------------------------------------------------------
const NALU_HOME = path.join(os.homedir(), '.nalu')
const NALU_BIN = path.join(NALU_HOME, 'bin')

const CLI_FRONTIER = (vendor: 'claude' | 'gpt') => `#!/usr/bin/env node
const fs=require('fs'),os=require('os'),path=require('path'),https=require('https');
const V='${vendor}';
const cfg=(()=>{try{return JSON.parse(fs.readFileSync(path.join(os.homedir(),'.nalu','cli.json'),'utf8'))}catch{return{}}})();
const prompt=process.argv.slice(2).join(' ');
if(!prompt){console.log(V+' <prompt> — answer with your frontier model; Nalu supercharges the answer and learns from it.');process.exit(0)}
const key=V==='claude'?cfg.anthropicKey:cfg.openaiKey;
if(!key){console.error('\\x1b[33m'+V+':\\x1b[0m no API key set. Add it in Nalu → Settings → Supercharge.');process.exit(1)}
let host,pathname,headers,payload,pick;
if(V==='claude'){host='api.anthropic.com';pathname='/v1/messages';headers={'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'};payload=JSON.stringify({model:cfg.claudeModel||'claude-sonnet-5',max_tokens:1500,stream:true,messages:[{role:'user',content:prompt}]});pick=j=>j.type==='content_block_delta'&&j.delta&&j.delta.text}
else{host='api.openai.com';pathname='/v1/chat/completions';headers={'Authorization':'Bearer '+key,'content-type':'application/json'};payload=JSON.stringify({model:cfg.openaiModel||'gpt-5.6',stream:true,messages:[{role:'user',content:prompt}]});pick=j=>j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content}
let answer='';
const req=https.request({hostname:host,path:pathname,method:'POST',headers:{...headers,'Content-Length':Buffer.byteLength(payload)}},res=>{let b='';res.setEncoding('utf8');res.on('data',d=>{b+=d;let i;while((i=b.indexOf('\\n'))>=0){const l=b.slice(0,i).trim();b=b.slice(i+1);if(l.startsWith('data:')){const s=l.slice(5).trim();if(s==='[DONE]')continue;try{const j=JSON.parse(s);const t=pick(j)||'';if(t){answer+=t;process.stdout.write(t)}}catch{}}}});res.on('end',()=>{process.stdout.write('\\n');
  // Nalu supercharge + learn: capture the frontier exchange as distillation data.
  try{const dir=path.join(os.homedir(),'.nalu','training');fs.mkdirSync(dir,{recursive:true});fs.appendFileSync(path.join(dir,'capture.jsonl'),JSON.stringify({user:prompt,assistant:answer,teacher:V,ts:Date.now()})+'\\n');process.stdout.write('\\x1b[90m[nalu: captured for training ('+answer.length+' chars)]\\x1b[0m\\n')}catch{}
})});
req.on('error',e=>console.error('\\x1b[31m'+V+':\\x1b[0m',e.message));req.end(payload);
`

function prepareDesktopCli() {
  return installDesktopCli({
    sourcePath: app.isPackaged ? path.join(process.resourcesPath, 'cli', 'nalu.mjs') : path.join(app.getAppPath(), 'cli', 'nalu.mjs'),
    binDir: NALU_BIN,
    runtime: process.execPath,
    appPath: app.isPackaged ? '' : app.getAppPath(),
  })
}

function ensureNaluCli(): void {
  try {
    fsSync.mkdirSync(NALU_BIN, { recursive: true })
    const write = (name: string, body: string) => {
      const p = path.join(NALU_BIN, name)
      fsSync.writeFileSync(p, body, { mode: 0o755 })
      try { fsSync.chmodSync(p, 0o755) } catch { /* */ }
    }
    prepareDesktopCli()
    // The frontier "supercharge" helpers live under nalu-* names so they can NEVER
    // shadow the user's real `claude` (Claude Code) / `gpt` / `codex` on PATH.
    write('nalu-claude', CLI_FRONTIER('claude'))
    write('nalu-gpt', CLI_FRONTIER('gpt'))
    // Self-heal: delete any `claude`/`gpt` shadow wrappers an OLD build wrote here.
    for (const shadow of ['claude', 'gpt']) {
      try {
        const sp = path.join(NALU_BIN, shadow)
        if (fsSync.existsSync(sp) && /Nalu supercharges|captured for training/.test(fsSync.readFileSync(sp, 'utf8'))) fsSync.unlinkSync(sp)
      } catch { /* */ }
    }
  } catch (error) { console.error('Could not prepare the Nalu CLI:', error) }
}

// Renderer syncs the Nalu token + optional frontier keys so the CLIs can auth.
ipcMain.handle('nalu:cli-sync', (_e, cfg: Record<string, unknown>) => {
  try {
    fsSync.mkdirSync(NALU_HOME, { recursive: true })
    const file = path.join(NALU_HOME, 'cli.json')
    let cur: Record<string, unknown> = {}
    try { cur = JSON.parse(fsSync.readFileSync(file, 'utf8')) } catch { /* */ }
    fsSync.writeFileSync(file, JSON.stringify({ ...cur, ...cfg }, null, 2), { mode: 0o600 })
    fsSync.chmodSync(file, 0o600)
    // The full terminal agent and remote worker read config.json. Keep its
    // session in sync while preserving standalone settings and repo mappings.
    const fullFile = path.join(NALU_HOME, 'config.json')
    let full: Record<string, unknown> = {}
    try { full = JSON.parse(fsSync.readFileSync(fullFile, 'utf8')) } catch { /* */ }
    if (typeof cfg.token === 'string') full.token = cfg.token
    if (typeof cfg.apiBase === 'string') full.api = cfg.apiBase
    if (['none', 'low', 'medium', 'high'].includes(String(cfg.reasoning))) full.reasoning = cfg.reasoning
    if (typeof cfg.maxTokens === 'number' && Number.isInteger(cfg.maxTokens) && cfg.maxTokens >= 256 && cfg.maxTokens <= 32000) full.maxTokens = cfg.maxTokens
    if (typeof cfg.webSearch === 'boolean') full.webSearch = cfg.webSearch
    fsSync.writeFileSync(fullFile, JSON.stringify(full, null, 2), { mode: 0o600 })
    fsSync.chmodSync(fullFile, 0o600)
    return true
  } catch { return false }
})

function createWindow() {
  updateActivity = { blocked: true, idleMs: 0, seen: 0 }
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#101217',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: '#14171d', symbolColor: '#e9ebf0', height: 64 },
    // Keep native window controls aligned with the single desktop header.
    trafficLightPosition: { x: 14, y: 25 },
    icon: path.join(__dirname, '../dist/nalu-avatar.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // preload only exposes IPC; filesystem and PTY live in main
      backgroundThrottling: false, // keep tasks and safety heartbeats live when hidden
    },
  })

  win.once('ready-to-show', () => win?.show())
  win.on('close', event => { if (!quitting && companion?.keepAlive()) { event.preventDefault(); win?.hide() } })
  win.on('closed', () => { win = null })

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
  win.webContents.on('will-navigate', (event, url) => {
    if (!isRendererEntry(url, rendererEntry)) event.preventDefault()
  })
  win.webContents.on('will-redirect', (event, url) => {
    if (!isRendererEntry(url, rendererEntry)) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url)) void shell.openExternal(url).catch(error => console.error('Could not open external link:', error))
    return { action: 'deny' }
  })
}

// ---- Filesystem IPC --------------------------------------------------------

const IGNORE = new Set(['.git', 'node_modules', '.DS_Store', 'dist', 'dist-electron', '.next', 'release', 'build'])

ipcMain.handle('dialog:openFolder', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('dialog:saveFile', async (_event, defaultPath: string) => {
  const result = await dialog.showSaveDialog(win!, { defaultPath, properties: ['createDirectory', 'showOverwriteConfirmation'] })
  return result.canceled ? null : result.filePath ?? null
})

ipcMain.handle('fs:readDir', async (_e, dir: string) => {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => !IGNORE.has(e.name))
    .map((e) => ({ name: e.name, path: path.join(dir, e.name), dir: e.isDirectory() }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
})

ipcMain.handle('fs:readFile', async (_e, file: string) => {
  return await readTextFile(file)
})

ipcMain.handle('fs:writeFile', async (_e, file: string, content: string) => {
  await fs.writeFile(file, content, 'utf8')
  return true
})

ipcMain.handle('fs:createFile', async (_e, dir: string, name: string) => {
  return await createEntry(dir, name, 'file')
})

ipcMain.handle('fs:rename', async (_e, from: string, to: string) => {
  return await renameEntry(from, to)
})

ipcMain.handle('fs:mkdir', async (_e, dir: string, name: string) => {
  return await createEntry(dir, name, 'folder')
})

ipcMain.handle('fs:delete', async (_e, target: string) => {
  await shell.trashItem(target)
  return true
})

// ---- Cross-file search (like VS Code "Find in Files") ----------------------
const searchJobs = new Map<number, AbortController>()
const searchOwners = new WeakSet<Electron.WebContents>()
ipcMain.on('fs:cancelSearch', event => searchJobs.get(event.sender.id)?.abort())
ipcMain.handle('fs:search', async (event, root: string, query: string) => {
  const owner = event.sender
  const ownerId = owner.id
  if (!searchOwners.has(owner)) {
    searchOwners.add(owner)
    const stop = () => { searchJobs.get(ownerId)?.abort(); searchJobs.delete(ownerId) }
    owner.once('destroyed', stop)
    owner.on('render-process-gone', stop)
  }
  searchJobs.get(ownerId)?.abort()
  const controller = new AbortController()
  searchJobs.set(ownerId, controller)
  try { return await searchFiles(root, query, controller.signal) }
  finally { if (searchJobs.get(ownerId) === controller) searchJobs.delete(ownerId) }
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
ipcMain.handle('git:status', (_e, cwd: string) => workspaceStatus(git, cwd))
ipcMain.handle('git:diff', (_e, cwd: string, file?: string, staged?: boolean) => workspaceDiff(git, cwd, file, staged))
ipcMain.handle('git:stage', async (_e, cwd: string, file: string) => (await git(cwd, ['add', '--', file])).ok)
ipcMain.handle('git:unstage', async (_e, cwd: string, file: string) => (await git(cwd, ['reset', 'HEAD', '--', file])).ok)
ipcMain.handle('git:commit', async (_e, cwd: string, msg: string) => {
  const result = await git(cwd, ['commit', '-m', msg])
  if (!result.ok) throw new Error(result.out || 'Git commit failed.')
  return result.out
})
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
// ---- GitHub via the gh CLI (real OAuth login, no manual tokens) ------------
function gh(args: string[], cwd?: string): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    // Prepend common install dirs so gh is found even when launched from Finder
    // (GUI apps don't inherit the shell PATH).
    const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` }
    const p = spawn('gh', args, { cwd, env })
    let out = ''
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => resolve({ ok: code === 0, out }))
    p.on('error', () => resolve({ ok: false, out: '__no_gh__' }))
  })
}
let ghGitReady = false
async function ensureGhGit() { if (!ghGitReady) { await gh(['auth', 'setup-git']); ghGitReady = true } }
ipcMain.handle('github:status', async () => {
  const r = await gh(['auth', 'status'])
  if (r.out === '__no_gh__') return { loggedIn: false, login: '', hasGh: false }
  const m = r.out.match(/Logged in to github\.com account (\S+)/) || r.out.match(/account (\S+)/)
  return { loggedIn: /Logged in/.test(r.out), login: m ? m[1] : '', hasGh: true }
})
ipcMain.handle('github:repos', async () => {
  const r = await gh(['api', 'user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member', '--jq', '.[] | {full_name: .full_name, clone_url: .clone_url, private: .private}'])
  if (!r.ok) return []
  return r.out.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
})
// Browser OAuth login (device flow) for ANY user — shows a one-time code, opens
// github.com/login/device, and completes when they authorize. No manual token.
ipcMain.handle('github:login', async (e) => {
  return await new Promise<{ ok: boolean; out: string }>((resolve) => {
    const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` }
    const p = spawn('gh', ['auth', 'login', '--web', '--git-protocol', 'https', '--hostname', 'github.com'], { env })
    let out = '', codeShown = false, enterSent = false
    const onData = (d: Buffer) => {
      out += d.toString()
      const m = out.match(/([A-Z0-9]{4}-[A-Z0-9]{4})/)
      if (m && !codeShown) { codeShown = true; try { if (!e.sender.isDestroyed()) e.sender.send('github:loginCode', m[1]) } catch { /* window gone */ } shell.openExternal('https://github.com/login/device') }
      if (/Press Enter/i.test(out) && !enterSent) { enterSent = true; try { p.stdin.write('\n') } catch { /* ignore */ } }
      if (/already logged in/i.test(out)) { try { p.stdin.write('y\n') } catch { /* ignore */ } }
    }
    p.stdout.on('data', onData); p.stderr.on('data', onData)
    p.on('close', (code) => { void gh(['auth', 'setup-git']); resolve({ ok: code === 0, out: out.replace(/[A-Z0-9]{4}-[A-Z0-9]{4}/g, '') }) })
    p.on('error', () => resolve({ ok: false, out: '__no_gh__' }))
  })
})
ipcMain.handle('github:logout', async () => (await gh(['auth', 'logout', '--hostname', 'github.com'])).ok)
ipcMain.handle('git:clone', async (_e, repoOrUrl: string, destParent: string) => {
  await ensureGhGit()
  const repo = repoOrUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/^\/+/, '')
  const name = (repo.match(/([^/]+)$/) || [])[1] || 'repo'
  const dest = path.join(destParent, name)
  const r = await gh(['repo', 'clone', repo, dest], destParent)
  return { ok: r.ok, out: r.out === '__no_gh__' ? 'GitHub CLI (gh) not found.' : r.out, dir: r.ok ? dest : null }
})
ipcMain.handle('git:remote', async (_e, cwd: string) => {
  const r = await git(cwd, ['remote', 'get-url', 'origin'])
  return r.ok ? r.out.trim() : ''
})
ipcMain.handle('git:setRemote', async (_e, cwd: string, url: string) => {
  await git(cwd, ['remote', 'remove', 'origin'])
  return (await git(cwd, ['remote', 'add', 'origin', url])).ok
})
ipcMain.handle('git:initRepo', async (_e, cwd: string) => (await git(cwd, ['init'])).ok)
ipcMain.handle('git:pull', async (_e, cwd: string) => {
  await ensureGhGit()
  const r = await git(cwd, ['pull'])
  return { ok: r.ok, out: r.out }
})
ipcMain.handle('git:commitPush', async (_e, cwd: string, msg: string) => {
  await ensureGhGit()
  return await commitAndPush(args => git(cwd, args), msg)
})

// ---- One-shot command exec (for the AI agent to run + capture output) ------
const commandJobs = new Map<string, AbortController>()
const commandOwners = new Set<number>()
ipcMain.handle('sys:exec', async (e, cwd: string, command: string, id?: string) => {
  const owner = e.sender.id
  const key = `${owner}:${id || randomUUID()}`
  if (commandJobs.has(key)) throw new Error('Command ID is already running.')
  const controller = new AbortController()
  commandJobs.set(key, controller)
  if (!commandOwners.has(owner)) {
    commandOwners.add(owner)
    e.sender.once('destroyed', () => {
      for (const [key, job] of commandJobs) if (key.startsWith(`${owner}:`)) job.abort()
      commandOwners.delete(owner)
    })
  }
  try { return await runCommand(cwd, command, { signal: controller.signal }) }
  finally { commandJobs.delete(key) }
})
ipcMain.on('sys:cancel', (e, id: string) => commandJobs.get(`${e.sender.id}:${id}`)?.abort())

// App version (for the auto-update check) + open the download page.
ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('workspace:close', () => { win?.close(); return !win || win.isDestroyed() || !win.isVisible() })

// ---- Permissions — Accessibility (keystrokes/clicks/menu automation) and
// Screen Recording (screenshots). Both are one-time macOS grants. ------------
ipcMain.handle('pc:permissions', (_e, prompt: boolean) => {
  if (process.platform !== 'darwin') return { accessibility: false, screen: false, platform: process.platform }
  const accessibility = systemPreferences.isTrustedAccessibilityClient(!!prompt) // `true` opens the System Settings pane
  const screen = systemPreferences.getMediaAccessStatus('screen') === 'granted'
  return { accessibility, screen, platform: process.platform }
})
ipcMain.handle('pc:openSettings', (_e, pane: string) => {
  const url = pane === 'screen'
    ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  shell.openExternal(url)
  return true
})

// ---- Computer control (screen + mouse + keyboard + AppleScript) ------------
// The AI operates the Mac like a person: it SEES via screenshots and ACTS via
// osascript (System Events) — mouse, keyboard, and full AppleScript automation.
// Requires macOS Screen Recording + Accessibility permissions (granted once).
const osa = (script: string): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => {
    const p = spawn('osascript', ['-e', script])
    let out = ''
    const timer = setTimeout(() => { p.kill('SIGKILL'); resolve({ ok: false, out: 'AppleScript timed out after 30 seconds.' }) }, 30000)
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, out: out.trim() }) })
    p.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, out: String(err) }) })
  })

ipcMain.handle('pc:screenshot', async () => {
  const raw = path.join(os.tmpdir(), `nalu-shot-${Date.now()}.png`)
  const small = raw.replace('.png', '.jpg')
  await new Promise<void>((res) => { const p = spawn('screencapture', ['-x', '-C', raw]); p.on('close', () => res()); p.on('error', () => res()) })
  // Downscale to a compact JPEG (max 1512px wide) — small payload = fast vision
  // and well under the serverless body limit.
  await new Promise<void>((res) => { const p = spawn('sips', ['-Z', '1512', '-s', 'format', 'jpeg', '-s', 'formatOptions', '72', raw, '--out', small]); p.on('close', () => res()); p.on('error', () => res()) })
  try {
    let mime = 'image/jpeg'
    const buf = await fs.readFile(small).catch(() => { mime = 'image/png'; return fs.readFile(raw) })
    await fs.rm(raw, { force: true }); await fs.rm(small, { force: true })
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch { return '' }
})
ipcMain.handle('pc:screenSize', async () => {
  const r = await osa('tell application "Finder" to get bounds of window of desktop')
  const m = r.out.match(/(\d+), (\d+), (\d+), (\d+)/)
  return m ? { w: +m[3], h: +m[4] } : { w: 0, h: 0 }
})
// Locate an installed click helper; dependency installation is a separate task.
async function ensureCliclick(): Promise<string | null> {
  const candidates = ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick', ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, 'cliclick'))]
  for (const candidate of candidates) try { await fs.access(candidate, fsSync.constants.X_OK); return candidate } catch { /* try next installed path */ }
  return null
}
ipcMain.handle('pc:click', async (_e, x: number, y: number, dbl?: boolean) => {
  if (process.platform !== 'darwin' || !Number.isFinite(x) || !Number.isFinite(y)) return false
  const bin = await ensureCliclick()
  if (!bin) return false
  const cmd = dbl ? `dc:${x},${y}` : `c:${x},${y}`
  return await new Promise<boolean>((res) => {
    const p = spawn(bin, [cmd]); p.on('close', (c) => res(c === 0)); p.on('error', () => res(false))
  })
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
  if (special[key] == null && key.length !== 1) return false
  const escapedKey = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const script = special[key] != null
    ? `tell application "System Events" to key code ${special[key]}${usingClause}`
    : `tell application "System Events" to keystroke "${escapedKey}"${usingClause}`
  return (await osa(script)).ok
})
ipcMain.handle('pc:applescript', async (_e, script: string) => await osa(script))
ipcMain.handle('pc:open', async (_e, target: string) => {
  // A URL (http, tel:, mailto:, facetime:, or anything with a scheme) opens with
  // its default handler; a bare name is treated as an app.
  const isUrl = /^[a-z][a-z0-9+.-]*:/i.test(target)
  const args = isUrl ? [target] : ['-a', target]
  return await new Promise<boolean>((res) => { const p = spawn('open', args); p.on('close', c => res(c === 0)); p.on('error', () => res(false)) })
})

// ---- Nalu Browser: an IN-APP Chromium window the agent fully controls via
// executeJavaScript. No Chrome toggle, no permissions — it's our own browser,
// visible so the user watches (and can solve a login/captcha in it). This is the
// reliable path for real web tasks (reservations, posting, email). ------------
let webWin: BrowserWindow | null = null
let lastBrowserError = ''
function naluBrowser(): BrowserWindow {
  if (webWin && !webWin.isDestroyed()) return webWin
  webWin = new BrowserWindow({
    width: 1200, height: 900, show: true, title: 'Nalu Browser',
    webPreferences: {
      partition: 'persist:nalu-web', // persists logins across tasks
      preload: path.join(__dirname, 'webpreload.js'), // masks automation fingerprints
      contextIsolation: false,
    },
  })
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  webWin.webContents.setUserAgent(UA)
  webWin.webContents.session.setUserAgent(UA, 'en-US')
  webWin.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
    details.requestHeaders['Accept-Language'] = 'en-US,en;q=0.9'
    cb({ requestHeaders: details.requestHeaders })
  })
  webWin.webContents.on('render-process-gone', (_e, d) => { lastBrowserError = `the page crashed the browser (${d.reason}) — almost always aggressive bot protection` })
  webWin.on('closed', () => { webWin = null })
  return webWin
}
ipcMain.handle('pc:webOpen', async (_e, url: string) => {
  if (chromeBrowser.available) return browserResult(() => chromeBrowser.navigate(url))
  lastBrowserError = ''
  const w = naluBrowser()
  const full = /^https?:\/\//.test(url) ? url : `https://${url}`
  try {
    await w.loadURL(full)
  } catch (e) {
    // Sites behind Akamai/Cloudflare (OpenTable, LinkedIn) return a 403 challenge:
    // loadURL REJECTS on the HTTP code, but the page content is actually there.
    // Don't report a false failure ("404") — wait for the challenge/page to settle
    // and report what really loaded so the agent can read or solve it.
    await new Promise((r) => setTimeout(r, 2000))
    const cur = w.webContents.getURL()
    if (!cur || cur === 'about:blank') { return { ok: false, out: `Could not reach ${full}: ${e instanceof Error ? e.message : 'load error'}` }
    }
    w.focus()
    return { ok: true, out: `Opened ${cur} (the site guards against automation, so it may show a check — the page is loaded; read it or interact via the browser).` }
  }
  await new Promise((r) => setTimeout(r, 1800)) // let client JS settle
  if (w.isDestroyed() || lastBrowserError) {
    return { ok: false, out: lastBrowserError || `${full} closed the browser — it actively blocks automated browsers (Akamai/Cloudflare). Try the site's public API, a Google-cached copy, or ask the user to open it.` }
  }
  w.focus()
  return { ok: true, out: `Opened ${w.webContents.getURL() || full}` }
})
ipcMain.handle('pc:webJs', async (_e, code: string, wantResult: boolean) => {
  if (chromeBrowser.available) return browserResult(async () => { const result = await chromeBrowser.evaluate(code); return wantResult ? result.slice(0,14000) : 'Done' })
  if (!webWin || webWin.isDestroyed()) return { ok: false, out: lastBrowserError || 'no Nalu Browser open — use webOpen first' }
  try {
    const out = await webWin.webContents.executeJavaScript(code, true)
    return { ok: true, out: wantResult ? String(out ?? '').slice(0, 8000) : 'done' }
  } catch (e) { return { ok: false, out: e instanceof Error ? e.message : 'js error' } }
})
ipcMain.handle('pc:webShot', async () => {
  if (chromeBrowser.available) return chromeBrowser.capture()
  if (!webWin || webWin.isDestroyed()) return ''
  try { const img = await webWin.webContents.capturePage(); return img.toDataURL() } catch { return '' }
})

// TRUSTED input into the Nalu Browser via Chromium's input pipeline. These
// produce isTrusted=true events (real mouse/keyboard), so bot-walls like Akamai
// that reject JS-dispatched events accept them. This is how fortified sites
// (OpenTable, LinkedIn) get driven without a human.
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }
// Click the center of the element matching `selector` with a real mouse event.
ipcMain.handle('pc:webClickSel', async (_e, selector: string) => {
  if (chromeBrowser.available) return browserResult(() => chromeBrowser.click(selector))
  if (!webWin || webWin.isDestroyed()) return { ok: false, out: 'no browser' }
  try {
    const box = await webWin.webContents.executeJavaScript(
      `(function(){var el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.scrollIntoView({block:'center'});var r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,t:(el.innerText||el.value||el.placeholder||'').slice(0,40)};})()`, true,
    )
    if (!box) return { ok: false, out: 'element not found' }
    const wc = webWin.webContents
    wc.focus()
    wc.sendInputEvent({ type: 'mouseMove', x: Math.round(box.x), y: Math.round(box.y) } as Electron.MouseInputEvent)
    await sleep(40)
    wc.sendInputEvent({ type: 'mouseDown', x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 } as Electron.MouseInputEvent)
    wc.sendInputEvent({ type: 'mouseUp', x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 } as Electron.MouseInputEvent)
    return { ok: true, out: `clicked "${box.t}"` }
  } catch (e) { return { ok: false, out: e instanceof Error ? e.message : 'err' } }
})
// Type text as real key events into whatever is focused.
ipcMain.handle('pc:webType', async (_e, text: string) => {
  if (chromeBrowser.available) return browserResult(() => chromeBrowser.type(text))
  if (!webWin || webWin.isDestroyed()) return { ok: false, out: 'no browser' }
  const wc = webWin.webContents
  wc.focus()
  await wc.insertText(String(text))
  return { ok: true, out: `typed ${text.length} chars` }
})
// Press a named key (Return, Tab, Escape, Backspace, arrows…) as real events.
ipcMain.handle('pc:webKey', async (_e, key: string) => {
  if (chromeBrowser.available) return browserResult(() => chromeBrowser.key(key))
  if (!webWin || webWin.isDestroyed()) return { ok: false, out: 'no browser' }
  const wc = webWin.webContents
  wc.focus()
  wc.sendInputEvent({ type: 'keyDown', keyCode: key } as Electron.KeyboardInputEvent)
  if (key === 'Return' || key.length === 1) wc.sendInputEvent({ type: 'char', keyCode: key } as Electron.KeyboardInputEvent)
  wc.sendInputEvent({ type: 'keyUp', keyCode: key } as Electron.KeyboardInputEvent)
  await sleep(60)
  return { ok: true, out: `pressed ${key}` }
})

ipcMain.handle('pc:preview', () => chromeBrowser.preview)
ipcMain.handle('pc:browserShow', () => browserResult(async () => { await chromeBrowser.show(); return 'Chrome opened' }))
ipcMain.handle('pc:browserCancel', () => { chromeBrowser.cancel() })
ipcMain.handle('pc:previewClick', (_event, x: number, y: number) => browserResult(async () => { await chromeBrowser.clickAt(x,y); return 'Clicked in Chrome' }))
ipcMain.handle('pc:webSnapshot', () => browserResult(async () => {
  if (chromeBrowser.available) return JSON.stringify(await chromeBrowser.inspect({ action: 'snapshot' }))
  if (!webWin || webWin.isDestroyed()) throw Error('Open a website first.')
  return JSON.stringify(await webWin.webContents.executeJavaScriptInIsolatedWorld(999,[{code:`(${inspectBrowserPage.toString()})({action:'snapshot'})`}]))
}))
ipcMain.handle('pc:webFill', (_event, selector: string, text: string) => browserResult(async () => {
  if (chromeBrowser.available) return chromeBrowser.fill(selector,text)
  if (!webWin || webWin.isDestroyed()) throw Error('Open a website first.')
  const focused = await webWin.webContents.executeJavaScriptInIsolatedWorld(999,[{code:`(${inspectBrowserPage.toString()})(${JSON.stringify({action:'focus',selector})})`}])
  if (!focused.focused) throw Error('The field could not receive focus.')
  await webWin.webContents.insertText(text)
  return `Filled ${selector}`
}))
ipcMain.handle('pc:webScroll', (_event, x: number, y: number) => browserResult(async () => {
  if (chromeBrowser.available) return chromeBrowser.scroll(x,y)
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x)>2000 || Math.abs(y)>2000) throw Error('Scroll must be at most 2000 pixels per step.')
  if (!webWin || webWin.isDestroyed()) throw Error('Open a website first.')
  webWin.webContents.sendInputEvent({type:'mouseWheel',x:100,y:100,deltaX:-x,deltaY:-y})
  return 'Scrolled the page'
}))

// ---- Browser automation (drive Chrome/Safari via JS in the real page) -------
// Reading and acting on the actual DOM is FAR more reliable than pixel-clicking
// for web tasks (reservations, email, forms). Requires the browser to allow JS
// from Apple Events (Chrome: on by default via AppleScript; Safari: Develop →
// "Allow JavaScript from Apple Events").
async function whichBrowser(): Promise<'Google Chrome' | 'Safari' | ''> {
  const r = await osa('tell application "System Events" to get name of (processes where background only is false)')
  if (/Google Chrome/.test(r.out)) return 'Google Chrome'
  if (/Safari/.test(r.out)) return 'Safari'
  return ''
}
function jsForApplescript(code: string): string {
  // embed JS as an AppleScript string literal
  return code.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')
}
// Chrome/Safari block "execute JavaScript via AppleScript" by default. Turn it
// on by toggling the menu item (View→Developer→Allow JS from Apple Events for
// Chrome; Develop→Allow JavaScript from Apple Events for Safari). We toggle,
// test, and if we turned it OFF we toggle back — leaving it ON.
async function ensureBrowserJs(browser: 'Google Chrome' | 'Safari'): Promise<boolean> {
  const test = browser === 'Google Chrome'
    ? `tell application "Google Chrome" to execute front window's active tab javascript "1+1"`
    : `tell application "Safari" to do JavaScript "1+1" in current tab of front window`
  if ((await osa(test)).ok) return true
  const clickItem = browser === 'Google Chrome'
    ? `tell application "Google Chrome" to activate
delay 0.2
tell application "System Events" to tell process "Google Chrome" to click menu item "Allow JavaScript from Apple Events" of menu 1 of menu item "Developer" of menu 1 of menu bar item "View" of menu bar 1`
    : `tell application "Safari" to activate
delay 0.2
tell application "System Events" to tell process "Safari" to click menu item "Allow JavaScript from Apple Events" of menu 1 of menu bar item "Develop" of menu bar 1`
  for (let i = 0; i < 2; i++) {
    await osa(clickItem)
    await new Promise((r) => setTimeout(r, 300))
    if ((await osa(test)).ok) return true
  }
  return false
}

ipcMain.handle('pc:browserRun', async (_e, code: string, wantResult: boolean) => {
  let browser = await whichBrowser()
  if (!browser) { await new Promise<void>((r) => { const p = spawn('open', ['-a', 'Google Chrome']); p.on('close', () => r()); p.on('error', () => r()) }); await new Promise((r) => setTimeout(r, 1500)); browser = 'Google Chrome' }
  const js = jsForApplescript(code)
  const script = browser === 'Google Chrome'
    ? `tell application "Google Chrome" to execute front window's active tab javascript "${js}"`
    : `tell application "Safari" to do JavaScript "${js}" in current tab of front window`
  let r = await osa(script)
  if (!r.ok && /turned off|not allowed|Apple Events/i.test(r.out)) {
    if (await ensureBrowserJs(browser)) r = await osa(script)
    else return { ok: false, out: `Browser JS is disabled. Enable it once: ${browser === 'Google Chrome' ? 'Chrome menu → View → Developer → "Allow JavaScript from Apple Events"' : 'Safari → Develop → "Allow JavaScript from Apple Events"'} (and grant this app Accessibility in System Settings → Privacy).` }
  }
  return { ok: r.ok, out: wantResult ? r.out.slice(0, 8000) : (r.ok ? 'done' : r.out) }
})
// open a URL in a browser tab and wait for it to load
ipcMain.handle('pc:browserOpen', async (_e, url: string) => {
  let browser = await whichBrowser()
  if (!browser) browser = 'Google Chrome'
  const script = browser === 'Google Chrome'
    ? `tell application "Google Chrome"\n activate\n if (count of windows) = 0 then make new window\n set URL of active tab of front window to "${url}"\nend tell`
    : `tell application "Safari"\n activate\n if (count of windows) = 0 then make new document\n set URL of current tab of front window to "${url}"\nend tell`
  const r = await osa(script)
  await new Promise((res) => setTimeout(res, 2200)) // let it load
  return r.ok
})

// ---- Terminal IPC — a REAL pseudo-terminal via node-pty --------------------
// A true pty gives a proper prompt, character echo, colors, and interactive
// programs (vim, top, npm prompts…) — everything a piped child_process can't.

const terminalSessions = new TerminalSessions()
const terminalOwners = new Set<number>()

// Resolve a friendly shell name ('zsh','bash','fish','powershell','git-bash',
// 'sh') to an executable + login args, only if it exists on this machine.
function resolveShell(kind?: string): { path: string; args: string[] } {
  const win = process.platform === 'win32'
  const exists = (p: string) => { try { return fsSync.existsSync(p) } catch { return false } }
  const candidates: Record<string, { path: string; args: string[] }[]> = {
    zsh: [{ path: '/bin/zsh', args: ['-l'] }, { path: '/usr/bin/zsh', args: ['-l'] }],
    bash: [{ path: '/bin/bash', args: ['-l'] }, { path: '/usr/bin/bash', args: ['-l'] }, { path: '/opt/homebrew/bin/bash', args: ['-l'] }],
    fish: [{ path: '/opt/homebrew/bin/fish', args: ['-l'] }, { path: '/usr/local/bin/fish', args: ['-l'] }, { path: '/usr/bin/fish', args: ['-l'] }],
    sh: [{ path: '/bin/sh', args: [] }],
    powershell: [{ path: 'powershell.exe', args: [] }, { path: 'pwsh', args: [] }, { path: '/opt/homebrew/bin/pwsh', args: [] }, { path: '/usr/local/bin/pwsh', args: [] }],
    'git-bash': [{ path: 'C:/Program Files/Git/bin/bash.exe', args: ['-l', '-i'] }],
    cmd: [{ path: 'cmd.exe', args: [] }],
  }
  const list = candidates[kind || ''] || []
  for (const c of list) if (c.path.includes('.exe') || c.path === 'pwsh' || c.path === 'cmd.exe' || exists(c.path)) return c
  // Default: prefer zsh (macOS's modern default — avoids bash's noisy
  // "default interactive shell is now zsh" deprecation notice), then the user's
  // $SHELL, then bash/sh.
  if (win) return { path: 'powershell.exe', args: [] }
  const def = ['/bin/zsh', '/usr/bin/zsh', process.env.SHELL || '', '/bin/bash', '/bin/sh'].find((p) => p && exists(p)) || '/bin/zsh'
  return { path: def, args: def.endsWith('/sh') ? [] : ['-l'] }
}

// Report which shells are actually installed, for the UI picker.
ipcMain.handle('term:shells', () => {
  const win = process.platform === 'win32'
  const all = win ? ['powershell', 'cmd', 'git-bash'] : ['zsh', 'bash', 'fish', 'sh']
  return all.filter((k) => {
    const r = resolveShell(k)
    return win ? true : (() => { try { return fsSync.existsSync(r.path) } catch { return false } })()
  })
})

ipcMain.handle('term:create', async (e, id: string, cwd: string, shellKind?: string) => {
  const owner = e.sender.id
  if (!terminalOwners.has(owner)) {
    terminalOwners.add(owner)
    e.sender.once('destroyed', () => { terminalSessions.killOwner(owner); terminalOwners.delete(owner) })
  }
  return terminalSessions.create(`${owner}:${id}`, async () => {
    const pty = await import('node-pty')
    const isNalu = shellKind === 'nalu'
    const { path: shellPath, args } = isNalu
      ? { path: process.execPath, args: [prepareDesktopCli().script] }
      : resolveShell(shellKind)
    return pty.spawn(shellPath, args, {
      name: 'xterm-256color', cols: 80, rows: 24, cwd: cwd || os.homedir(),
      env: { ...process.env, NALU_DESKTOP_RUNTIME: process.execPath, NALU_DESKTOP_APP: app.isPackaged ? '' : app.getAppPath(), ...(isNalu ? { ELECTRON_RUN_AS_NODE: '1' } : {}), PATH: [NALU_BIN, '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || '/usr/bin:/bin'].join(path.delimiter), TERM: 'xterm-256color', SHELL: isNalu ? resolveShell().path : shellPath, BASH_SILENCE_DEPRECATION_WARNING: '1', COLORTERM: 'truecolor' } as Record<string, string>,
    })
  }, (event, payload) => {
    try { if (!e.sender.isDestroyed()) e.sender.send(`term:${event}:${id}`, payload) } catch { /* window closed */ }
  })
})

ipcMain.on('term:input', (e, id: string, data: string) => {
  terminalSessions.input(`${e.sender.id}:${id}`, data)
})
ipcMain.on('term:resize', (e, id: string, cols: number, rows: number) => {
  terminalSessions.resize(`${e.sender.id}:${id}`, cols, rows)
})
ipcMain.handle('term:kill', (e, id: string) => {
  terminalSessions.kill(`${e.sender.id}:${id}`)
  return true
})

// ---- App lifecycle ---------------------------------------------------------

function openWorkspace() {
  if (!win || win.isDestroyed()) createWindow()
  else { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
}
app.whenReady().then(() => {
  createWindow()
  companion = desktopCompanion({ entry: rendererEntry, preload: path.join(__dirname, 'companionPreload.js'), icon: path.join(__dirname, '../dist/wolf-icon.png'), workspace: () => win, openWorkspace })
  if (app.isPackaged && process.platform === 'darwin' && process.env.NALU_DISABLE_UPDATES !== '1') {
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowDowngrade = false
    autoUpdater.allowPrerelease = false
    let stagedVersion = ''
    autoUpdater.on('update-downloaded', info => { stagedVersion = info.version })
    autoUpdater.on('error', error => { quitting = false; console.error('Nalu update failed:', error.message) })
    // electron-updater emits downloaded before Squirrel finishes signature validation.
    // Only the native event is safe to start our restart countdown.
    const transport = {
      on: (event: string, listener: (...args: any[]) => void) => event === 'update-downloaded'
        ? nativeUpdater.on('update-downloaded', () => listener({ version: stagedVersion }))
        : autoUpdater.on(event as any, listener),
      checkForUpdates: () => autoUpdater.checkForUpdates(),
      quitAndInstall: () => autoUpdater.quitAndInstall(),
    }
    updater = new UpdateController(transport, {
      broadcast: state => { if (win && !win.isDestroyed()) win.webContents.send('updates:state', state) },
      blocked: () => {
        if (commandJobs.size || companion?.updateBlocked()) return 'Waiting for your tasks and conversation to finish.'
        if (terminalSessions.count) return 'Close your terminal sessions to let Nalu restart, or quit Nalu when ready.'
        if (!workspaceSaved || sessionJournal.busy) return 'Waiting for your workspace to finish saving.'
        if (win && (updateActivity.blocked || Date.now() - updateActivity.seen > 8000)) return 'Waiting for unsaved work and drafts to be saved or closed.'
        if (win && updateActivity.idleMs < 60000) return 'Ready to install when you take a break.'
        return null
      },
      flush: () => sessionJournal.flush(),
      prepareQuit: () => { quitting = true },
    })
    setTimeout(() => void updater?.check(), 20000).unref()
    setInterval(() => void updater?.check(), 30 * 60 * 1000).unref()
    setInterval(() => void updater?.tick(), 1000).unref()
  }
})
app.whenReady().then(() => ensureNaluCli())
// Make git authenticated up front so the AI agent can `git push` via its run tool
// (using the user's gh login) even as its very first action.
app.whenReady().then(() => { void ensureGhGit() })

let waitingForCommands = false
app.on('before-quit', event => {
  quitting = true
  companion?.quit()
  void chromeBrowser.close()
  if (!commandJobs.size && !sessionJournal.busy) return
  event.preventDefault()
  if (waitingForCommands) return
  waitingForCommands = true
  for (const job of commandJobs.values()) job.abort()
  const timer = setInterval(() => {
    if (!commandJobs.size && !sessionJournal.busy) { clearInterval(timer); app.quit() }
  }, 50)
})

app.on('window-all-closed', () => {
  terminalSessions.killAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  openWorkspace()
})

void isDev
