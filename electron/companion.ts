import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray, systemPreferences } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { isTrustedRenderer, isRendererEntry, isExternalWebUrl } from './rendererSecurity'
import { shell } from 'electron'

type Rect = { x: number; y: number; width: number; height: number }
export type CompanionActivity = { source: string; task: string; status: string; needsApproval: boolean; busy: boolean }
export type CompanionSettings = { enabled: boolean; paused: boolean; launchAtLogin: boolean }

/** A separate, sandboxed surface. It never receives the workspace's file/shell bridge. */
export function desktopCompanion(options: { entry: string; preload: string; icon: string; workspace: () => BrowserWindow | null; openWorkspace: () => void }) {
  let pet: BrowserWindow | null = null, tray: Tray | null = null, closing = false
  let hitAreas: Rect[] = [], ignoring = true, displayId: number | undefined, reveal = 0
  const working = new Set<string>()
  let updateActivity = { blocked: true, seen: 0, idleMs: 0 }
  const activities = new Map<string, CompanionActivity>()
  const configFile = path.join(app.getPath('userData'), 'companion.json')
  let settings: CompanionSettings = { enabled: true, paused: false, launchAtLogin: false }
  try { const saved = JSON.parse(fs.readFileSync(configFile, 'utf8')); for (const key of Object.keys(settings) as (keyof CompanionSettings)[]) if (typeof saved[key] === 'boolean') settings[key] = saved[key] } catch { /* first launch */ }
  const state = () => ({ ...settings, reveal, working: working.size > 0, activities: [...activities.values()].reverse().sort((a,b) => Number(b.busy)-Number(a.busy)) })
  const broadcast = () => {
    for (const window of [pet, options.workspace()]) if (window && !window.isDestroyed()) window.webContents.send('companion:state', state())
    updateMenu()
  }
  const place = () => {
    if (!pet || pet.isDestroyed()) return
    const displays = screen.getAllDisplays()
    const display = displays.find(d => d.id === displayId) || screen.getPrimaryDisplay()
    displayId = display.id
    const area = display.workArea, height = Math.min(520, area.height)
    pet.setBounds({ x: area.x, y: area.y + area.height - height, width: area.width, height })
  }
  function create() {
    if (!settings.enabled || closing) return
    if (pet && !pet.isDestroyed()) { pet.showInactive(); return }
    pet = new BrowserWindow({ width: 900, height: 520, show: false, transparent: true, frame: false, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#00000000', roundedCorners: false, webPreferences: { preload: options.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
    pet.setAlwaysOnTop(true, 'floating')
    if (process.platform === 'darwin') pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
    pet.setIgnoreMouseEvents(true, { forward: true }); ignoring = true; hitAreas = []
    place()
    pet.once('ready-to-show', () => { if (settings.enabled) pet?.showInactive(); broadcast() })
    pet.on('closed', () => { pet = null; hitAreas = [] })
    pet.webContents.on('will-navigate', (event, url) => { if (!isRendererEntry(url, options.entry)) event.preventDefault() })
    pet.webContents.on('will-redirect', (event, url) => { if (!isRendererEntry(url, options.entry)) event.preventDefault() })
    pet.webContents.setWindowOpenHandler(({ url }) => { if (isExternalWebUrl(url)) void shell.openExternal(url); return { action: 'deny' } })
    void pet.loadURL(options.entry.replace(/#.*$/, '') + '#companion')
  }
  function findNalu() {
    displayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
    reveal++
    update({ enabled: true, paused: false }); place(); pet?.showInactive()
  }
  function updateMenu() {
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: 'Find Nalu', click: findNalu },
      { label: 'Open Nalu workspace', click: options.openWorkspace },
      { label: 'Show desktop Nalu', type: 'checkbox', checked: settings.enabled, click: () => update({ enabled: !settings.enabled }) },
      { label: 'Let Nalu rest', type: 'checkbox', checked: settings.paused, enabled: settings.enabled, click: () => update({ paused: !settings.paused }) },
      { label: 'Move Nalu to display', submenu: screen.getAllDisplays().map((d, i) => ({ label: d.label || `Display ${i + 1}`, type: 'radio' as const, checked: d.id === displayId, click: () => { displayId = d.id; place() } })) },
      { type: 'separator' }, { label: 'Quit Nalu', click: () => app.quit() },
    ]))
  }
  function update(patch: Partial<CompanionSettings>) {
    const next = { ...settings }
    for (const key of Object.keys(settings) as (keyof CompanionSettings)[]) if (typeof patch?.[key] === 'boolean') next[key] = patch[key]!
    if (next.launchAtLogin !== settings.launchAtLogin && ['darwin', 'win32'].includes(process.platform)) app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
    fs.writeFileSync(configFile, JSON.stringify(next), { mode: 0o600 })
    settings = next
    if (settings.enabled) create(); else pet?.close()
    broadcast(); return state()
  }
  function trusted(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) { return isTrustedRenderer(event, pet, options.entry) || isTrustedRenderer(event, options.workspace(), options.entry) }
  ipcMain.handle('companion:get', event => { if (!trusted(event)) throw Error('Untrusted companion sender'); return state() })
  ipcMain.handle('companion:find', event => { if (!trusted(event)) throw Error('Untrusted companion sender'); findNalu(); return state() })
  ipcMain.handle('companion:set', (event, patch) => { if (!trusted(event)) throw Error('Untrusted companion sender'); return update(patch) })
  ipcMain.handle('companion:workspace', (event, prompt?: string) => {
    if (!isTrustedRenderer(event, pet, options.entry)) throw Error('Untrusted companion sender')
    options.openWorkspace()
    if (typeof prompt === 'string' && prompt.trim()) options.workspace()?.webContents.send('companion:task', prompt.trim().slice(0, 20000))
  })
  ipcMain.handle('companion:microphone', async event => {
    if (!isTrustedRenderer(event, pet, options.entry)) throw Error('Untrusted companion sender')
    return process.platform !== 'darwin' || await systemPreferences.askForMediaAccess('microphone')
  })
  ipcMain.on('companion:hit-areas', (event, rectangles: Rect[]) => {
    if (!isTrustedRenderer(event, pet, options.entry) || !Array.isArray(rectangles)) return
    hitAreas = rectangles.slice(0, 4).filter(r => r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0 && r.width <= 600 && r.height <= 520)
  })
  ipcMain.on('companion:activity', (event, source: string, busy: boolean, detail?: Partial<CompanionActivity>) => {
    if (!isTrustedRenderer(event, options.workspace(), options.entry) || !['assistant', 'chats'].includes(source) || typeof busy !== 'boolean') return
    if (busy) working.add(source); else working.delete(source)
    const previous = activities.get(source)
    const task = typeof detail?.task === 'string' ? detail.task.trim().slice(0,500) : previous?.task || (busy ? 'Workspace task' : '')
    if (task) { activities.delete(source); activities.set(source, { source, busy, task, status: typeof detail?.status === 'string' ? detail.status.trim().slice(0,500) : busy ? 'Working on your task…' : 'Finished', needsApproval: detail?.needsApproval === true }) }
    broadcast()
  })
  ipcMain.on('companion:update-activity', (event, blocked: boolean, idleMs: number) => {
    if (!isTrustedRenderer(event, pet, options.entry) || typeof blocked !== 'boolean' || !Number.isFinite(idleMs) || idleMs < 0) return
    updateActivity = { blocked, idleMs, seen: Date.now() }
  })
  const poll = setInterval(() => {
    if (!pet || pet.isDestroyed() || !pet.isVisible()) return
    const cursor = screen.getCursorScreenPoint(), bounds = pet.getBounds()
    const x = cursor.x - bounds.x, y = cursor.y - bounds.y
    const next = !hitAreas.some(r => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)
    if (next !== ignoring) { ignoring = next; pet.setIgnoreMouseEvents(next, { forward: true }) }
  }, 60)
  const changed = () => { place(); updateMenu() }
  screen.on('display-added', changed); screen.on('display-removed', changed); screen.on('display-metrics-changed', changed)
  try {
    const icon = nativeImage.createFromPath(options.icon).resize({ width: 18, height: 18 })
    if (process.platform === 'darwin') icon.setTemplateImage(true)
    tray = new Tray(icon); tray.setToolTip('Nalu · your desktop companion'); tray.on('double-click', options.openWorkspace)
  } catch (error) { console.error('Could not create Nalu menu:', error) }
  create(); updateMenu()
  return {
    updateBlocked: () => working.size > 0 || [...activities.values()].some(a => a.needsApproval) || !!pet && (updateActivity.blocked || Date.now() - updateActivity.seen > 8000 || updateActivity.idleMs < 60000),
    keepAlive: () => settings.enabled && !closing,
    quit: () => { closing = true; clearInterval(poll); tray?.destroy(); pet?.destroy() },
  }
}
