import { app, BrowserWindow, session } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { inspectBrowserPage, type BrowserCommand } from './browserPage'

const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-browser-'))
const profile = path.join(evidence, 'profile')
fs.mkdirSync(profile, { mode: 0o700 })
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.setPath('crashDumps', profile)
for (const flag of ['disable-background-networking', 'disable-component-update', 'disable-sync', 'disable-breakpad']) app.commandLine.appendSwitch(flag)
let win: BrowserWindow | null = null, origin = '', origins = new Set<string>(), closing = false, sequence = 0
const errors: string[] = [], blocked: string[] = []
const remember = (list: string[], value: string) => { if (list.length < 40 && !list.includes(value)) list.push(value.slice(0, 1500)) }
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function localUrl(raw: unknown) {
  if (typeof raw !== 'string') throw Error('Open requires a local HTTP(S) URL.')
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw Error('Only explicit loopback HTTP(S) URLs are allowed (localhost, 127.0.0.1, or [::1]).')
  }
  return url
}
function resourceAllowed(raw: string) {
  try {
    const url = new URL(raw)
    if (url.protocol === 'data:' || url.protocol === 'blob:') return true
    if (url.protocol === 'ws:') url.protocol = 'http:'
    if (url.protocol === 'wss:') url.protocol = 'https:'
    return origins.has(url.origin) && ['http:', 'https:'].includes(url.protocol)
  } catch { return false }
}
function navigationAllowed(raw: string) {
  try { return localUrl(raw).origin === origin } catch { return false }
}
async function page(command: BrowserCommand): Promise<any> {
  if (!win || win.isDestroyed() || !navigationAllowed(win.webContents.getURL())) throw Error('Open a local app first.')
  const response = await win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `(() => { try { return { ok: true, result: (${inspectBrowserPage.toString()})(${JSON.stringify(command)}) } } catch (error) { return { ok: false, error: error.message } } })()` }])
  if (!response.ok) throw Error(response.error)
  return response.result
}
async function snapshot() {
  return { ...await page({ action: 'snapshot' }), errors: [...errors], blockedRequests: [...blocked], evidenceDirectory: evidence }
}
async function createBrowser() {
  const partition = session.fromPartition(`nalu-browser-${randomUUID()}`, { cache: false })
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  partition.setPermissionCheckHandler(() => false)
  partition.on('will-download', event => { event.preventDefault(); remember(blocked, 'Download blocked') })
  partition.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const allowed = resourceAllowed(details.url) && (details.resourceType !== 'mainFrame' || navigationAllowed(details.url))
    if (!allowed) remember(blocked, details.url)
    callback({ cancel: !allowed })
  })
  win = new BrowserWindow({ show: false, width: 1280, height: 800, useContentSize: true,
    webPreferences: { session: partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, safeDialogs: true, disableDialogs: true },
  })
  const contents = win.webContents
  contents.setWindowOpenHandler(({ url }) => { remember(blocked, url); return { action: 'deny' } })
  contents.on('will-navigate', (event, url) => { if (!navigationAllowed(url)) { event.preventDefault(); remember(blocked, url) } })
  contents.on('will-redirect', (event, url) => { if (!resourceAllowed(url)) { event.preventDefault(); remember(blocked, url) } })
  contents.on('console-message', ({ level, message }) => { if (level === 'error') remember(errors, message) })
  contents.on('render-process-gone', (_event, details) => remember(errors, `Renderer exited: ${details.reason}`))
  contents.debugger.attach('1.3')
  contents.debugger.on('message', (_event, method, params) => {
    if (method === 'Runtime.exceptionThrown') remember(errors, params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'Uncaught browser exception')
  })
}
async function keypress(key: string) {
  const keys: Record<string, number> = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, ' ': 32 }
  if (!(key in keys)) throw Error('Supported keys: Enter, Tab, Escape, Backspace, Delete, ArrowLeft/Up/Right/Down, Home, End, and space.')
  const send = (type: string) => win!.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key, windowsVirtualKeyCode: keys[key], ...(type === 'keyDown' && key === 'Enter' ? { text: '\r' } : {}) })
  await send('keyDown'); await send('keyUp')
}
async function perform(command: BrowserCommand) {
  if (command.action === 'open') {
    const url = localUrl(command.url)
    if (command.origins !== undefined && (!Array.isArray(command.origins) || command.origins.length > 8)) throw Error('origins must be an array of at most eight local API origins.')
    const allowed = new Set([url.origin, ...(command.origins || []).map(raw => localUrl(raw).origin)])
    if (!win || origin !== url.origin) { win?.destroy(); win = null; origin = url.origin; origins = allowed; await createBrowser() }
    else origins = allowed
    errors.length = 0; blocked.length = 0
    await win!.loadURL(url.href)
    await win!.webContents.debugger.sendCommand('Runtime.enable')
  } else {
    if (!win || win.isDestroyed()) throw Error('Open a local app first.')
    if (command.action === 'click') {
      const { x, y } = await page({ ...command, action: 'target' })
      for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
    } else if (command.action === 'fill') {
      if (typeof command.value !== 'string' || command.value.length > 20000) throw Error('Fill requires a string value of at most 20000 characters.')
      await page({ ...command, action: 'target' })
      const focused = await page({ ...command, action: 'focus' })
      if (!focused.focused) throw Error('Could not focus input.')
      await keypress('Backspace')
      if (command.value) await win.webContents.debugger.sendCommand('Input.insertText', { text: command.value })
    } else if (command.action === 'select') {
      if (typeof command.value !== 'string') throw Error('Select requires a string value.')
      await page(command)
    } else if (command.action === 'press') await keypress(command.key || '')
    else if (command.action === 'resize') {
      if (!Number.isInteger(command.width) || !Number.isInteger(command.height) || command.width! < 320 || command.width! > 2560 || command.height! < 240 || command.height! > 1600) throw Error('Viewport must be 320–2560 pixels wide and 240–1600 high.')
      win.setContentSize(command.width!, command.height!)
    } else if (command.action === 'reload') {
      errors.length = 0; blocked.length = 0
      await win.loadURL(win.webContents.getURL())
    } else if (command.action === 'screenshot') {
      const capture = await win.webContents.capturePage()
      if (capture.isEmpty()) throw Error('Chromium returned an empty screenshot.')
      const bytes = capture.toJPEG(75), file = path.join(evidence, `page-${++sequence}.jpg`)
      fs.writeFileSync(file, bytes, { mode: 0o600 })
      return { path: file, image: `data:image/jpeg;base64,${bytes.toString('base64')}`, ...capture.getSize(), url: win.webContents.getURL() }
    } else if (command.action === 'assert') {
      const timeout = command.timeout_ms ?? 3000
      if (!Number.isInteger(timeout) || timeout < 0 || timeout > 10000) throw Error('Assertion timeout_ms must be an integer from 0 to 10000.')
      const deadline = Date.now() + timeout
      let check
      do {
        check = command.assertion === 'no_errors'
          ? { assertion: 'no_errors', passed: errors.length === 0 && blocked.length === 0, actual: { errors: [...errors], blockedRequests: [...blocked] } }
          : await page(command)
        if (check.passed || Date.now() >= deadline) break
        await pause(100)
      } while (!closing)
      return { ...check, url: win.webContents.getURL(), viewport: win.getContentBounds(), snapshot: await snapshot() }
    } else if (command.action !== 'snapshot') throw Error('Unknown browser action.')
  }
  // Allow event handlers, layout, and simple fetch callbacks to settle. Explicit
  // assertions poll observable state for longer asynchronous transitions.
  await pause(150)
  return snapshot()
}
function close() {
  if (closing) return
  closing = true
  win?.destroy()
  app.quit()
}
app.on('window-all-closed', () => {}) // stdin owns the worker lifetime
app.on('will-quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* OS may still hold a cache file */ } })
process.on('SIGTERM', close)
process.on('SIGINT', close)
process.stdin.on('end', close)
process.stdout.on('error', close)
void app.whenReady().then(() => {
  app.dock?.hide()
  let buffer = '', queued = 0, queue = Promise.resolve()
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    buffer += chunk
    if (buffer.length > 128000 || queued > 32) { close(); return }
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); queued++
      queue = queue.then(async () => {
        if (closing) return
        let id: unknown
        try {
          const request = JSON.parse(line); id = request.id
          if (!Number.isSafeInteger(id) || !request.command || typeof request.command.action !== 'string') throw Error('Invalid browser request.')
          if (request.command.action === 'close') { process.stdout.write(JSON.stringify({ id, ok: true, result: { closed: true } }) + '\n'); close(); return }
          const result = await perform(request.command)
          fs.appendFileSync(path.join(evidence, 'actions.jsonl'), JSON.stringify({ at: new Date().toISOString(), action: request.command.action, assertion: request.command.assertion, passed: result.passed, url: result.url }) + '\n', { mode: 0o600 })
          process.stdout.write(JSON.stringify({ id, ok: true, result }) + '\n')
        } catch (error) {
          process.stdout.write(JSON.stringify({ id, ok: false, error: error instanceof Error ? error.message : String(error) }) + '\n')
        } finally { queued-- }
      })
    }
  })
  process.stdout.write(JSON.stringify({ ready: true, protocol: 1, electron: process.versions.electron, node: process.versions.node, chromium: process.versions.chrome, evidenceDirectory: evidence }) + '\n')
  process.stdin.resume()
})
