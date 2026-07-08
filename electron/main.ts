import { app, BrowserWindow, ipcMain, dialog, shell, systemPreferences } from 'electron'
import { promises as fs } from 'node:fs'
import * as fsSync from 'node:fs'
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
ipcMain.handle('git:diff', async (_e, cwd: string, file?: string) => {
  if (!file) return (await git(cwd, ['diff', 'HEAD'])).out
  // Tracked file: normal diff vs HEAD. If empty, it may be a NEW/untracked file —
  // show its whole content as an added diff (like VS Code does).
  const tracked = (await git(cwd, ['diff', 'HEAD', '--', file])).out
  if (tracked.trim()) return tracked
  const untracked = await git(cwd, ['diff', '--no-index', '--', '/dev/null', file])
  return untracked.out || tracked
})
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
      if (m && !codeShown) { codeShown = true; e.sender.send('github:loginCode', m[1]); shell.openExternal('https://github.com/login/device') }
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
  await git(cwd, ['add', '-A'])
  const c = await git(cwd, ['commit', '-m', msg])
  const hasRemote = (await git(cwd, ['remote'])).out.trim()
  if (!hasRemote) return { commit: c.out, push: 'No remote — connect/clone a GitHub repo to push.', ok: false }
  const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim() || 'main'
  const p = await git(cwd, ['push', '-u', 'origin', `HEAD:${branch}`])
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

// App version (for the auto-update check) + open the download page.
ipcMain.handle('app:version', () => app.getVersion())

// ---- Permissions — Accessibility (keystrokes/clicks/menu automation) and
// Screen Recording (screenshots). Both are one-time macOS grants. ------------
ipcMain.handle('pc:permissions', (_e, prompt: boolean) => {
  if (process.platform !== 'darwin') return { accessibility: true, screen: true }
  const accessibility = systemPreferences.isTrustedAccessibilityClient(!!prompt) // `true` opens the System Settings pane
  const screen = systemPreferences.getMediaAccessStatus('screen') === 'granted'
  return { accessibility, screen }
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
// Locate cliclick (Homebrew installs to /opt/homebrew/bin on Apple Silicon,
// /usr/local/bin on Intel), auto-installing it once via brew if missing so
// precise pixel-clicks work out of the box.
let cliclickPath: string | null = null
let triedInstall = false
async function ensureCliclick(): Promise<string | null> {
  if (cliclickPath) return cliclickPath
  for (const p of ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick', 'cliclick']) {
    if (p === 'cliclick' || fsSync.existsSync(p)) { if (p === 'cliclick' || fsSync.existsSync(p)) { cliclickPath = p; if (p !== 'cliclick') return p } }
  }
  if (fsSync.existsSync('/opt/homebrew/bin/cliclick')) { cliclickPath = '/opt/homebrew/bin/cliclick'; return cliclickPath }
  if (fsSync.existsSync('/usr/local/bin/cliclick')) { cliclickPath = '/usr/local/bin/cliclick'; return cliclickPath }
  if (!triedInstall) {
    triedInstall = true
    const brew = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find((b) => fsSync.existsSync(b))
    if (brew) {
      await new Promise<void>((res) => { const p = spawn(brew, ['install', 'cliclick'], { env: process.env }); p.on('close', () => res()); p.on('error', () => res()) })
      for (const p of ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick']) if (fsSync.existsSync(p)) { cliclickPath = p; return p }
    }
  }
  return null
}
ipcMain.handle('pc:click', async (_e, x: number, y: number, dbl?: boolean) => {
  const bin = await ensureCliclick()
  if (!bin) return false // no cliclick and couldn't install → caller uses keys/DOM
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
  const script = special[key] != null
    ? `tell application "System Events" to key code ${special[key]}${usingClause}`
    : `tell application "System Events" to keystroke "${key}"${usingClause}`
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
  if (!webWin || webWin.isDestroyed()) return { ok: false, out: lastBrowserError || 'no Nalu Browser open — use webOpen first' }
  try {
    const out = await webWin.webContents.executeJavaScript(code, true)
    return { ok: true, out: wantResult ? String(out ?? '').slice(0, 8000) : 'done' }
  } catch (e) { return { ok: false, out: e instanceof Error ? e.message : 'js error' } }
})
ipcMain.handle('pc:webShot', async () => {
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
  if (!webWin || webWin.isDestroyed()) return { ok: false, out: 'no browser' }
  const wc = webWin.webContents
  for (const ch of String(text)) {
    wc.sendInputEvent({ type: 'char', keyCode: ch } as Electron.KeyboardInputEvent)
    await sleep(18)
  }
  return { ok: true, out: `typed ${text.length} chars` }
})
// Press a named key (Return, Tab, Escape, Backspace, arrows…) as real events.
ipcMain.handle('pc:webKey', async (_e, key: string) => {
  if (!webWin || webWin.isDestroyed()) return { ok: false, out: 'no browser' }
  const wc = webWin.webContents
  wc.sendInputEvent({ type: 'keyDown', keyCode: key } as Electron.KeyboardInputEvent)
  wc.sendInputEvent({ type: 'char', keyCode: key } as Electron.KeyboardInputEvent)
  wc.sendInputEvent({ type: 'keyUp', keyCode: key } as Electron.KeyboardInputEvent)
  await sleep(60)
  return { ok: true, out: `pressed ${key}` }
})

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PtyProc = { write(d: string): void; resize(c: number, r: number): void; kill(): void; onData(cb: (d: string) => void): void; onExit(cb: (e: { exitCode: number }) => void): void }
const shells: Record<string, PtyProc> = {}

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
  const pty = await import('node-pty')
  const { path: shellPath, args } = resolveShell(shellKind)
  const proc = pty.spawn(shellPath, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: cwd || os.homedir(),
    // Silence bash's macOS deprecation banner (in case bash is chosen) and point
    // $SHELL at the actual shell so subshells behave.
    env: { ...process.env, TERM: 'xterm-256color', SHELL: shellPath, BASH_SILENCE_DEPRECATION_WARNING: '1', COLORTERM: 'truecolor' } as Record<string, string>,
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
