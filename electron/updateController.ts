export type DesktopUpdateState = {
  phase: 'disabled' | 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error'
  version?: string
  percent?: number
  restartAt?: number
  message?: string
}

type Updater = {
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
}

/** The transport validates signatures/checksums; this controls when work may restart. */
export class UpdateController {
  state: DesktopUpdateState = { phase: 'idle' }
  private checking = false
  private installing = false
  constructor(private updater: Updater, private options: {
    broadcast: (state: DesktopUpdateState) => void
    blocked: () => string | null
    flush: () => Promise<void>
    prepareQuit: () => void
    now?: () => number
  }) {
    updater.on('checking-for-update', () => this.set({ phase: 'checking' }))
    updater.on('update-not-available', () => this.set({ phase: 'idle' }))
    updater.on('update-available', info => this.set({ phase: 'downloading', version: info.version, percent: 0 }))
    updater.on('download-progress', info => {
      if (this.state.phase === 'downloading') this.set({ ...this.state, percent: Math.min(100, Math.max(0, Math.round(info.percent))) })
    })
    updater.on('update-downloaded', info => this.set({ phase: 'ready', version: info.version, message: 'Checking that your work is saved…' }))
    updater.on('error', () => this.set({ phase: 'error', message: 'Automatic update could not finish. Nalu will retry.' }))
  }
  private set(state: DesktopUpdateState) { this.state = state; this.options.broadcast(state) }
  async check() {
    if (this.checking || ['downloading', 'ready', 'installing'].includes(this.state.phase)) return
    this.checking = true
    try {
      const result = await this.updater.checkForUpdates() as { downloadPromise?: Promise<unknown> | null } | null
      // The library reports download failures through both an event and this
      // separate promise. Consume it so a bad/offline download never escapes.
      await result?.downloadPromise
    }
    catch { this.set({ phase: 'error', message: 'Could not check for updates. Nalu will retry.' }) }
    finally { this.checking = false }
  }
  async tick() {
    if (this.state.phase !== 'ready' || this.installing) return
    const reason = this.options.blocked()
    if (reason) {
      if (this.state.restartAt || this.state.message !== reason) this.set({ phase: 'ready', version: this.state.version, message: reason })
      return
    }
    const now = this.options.now?.() ?? Date.now()
    if (!this.state.restartAt) {
      this.set({ phase: 'ready', version: this.state.version, restartAt: now + 15000, message: 'Nalu will restart automatically. Keep working to postpone.' })
      return
    }
    if (now < this.state.restartAt) return
    this.installing = true
    try {
      await this.options.flush()
      if (this.state.phase !== 'ready') return
      const changed = this.options.blocked()
      if (changed) { this.set({ phase: 'ready', version: this.state.version, message: changed }); return }
      this.set({ phase: 'installing', version: this.state.version })
      this.options.prepareQuit()
      this.updater.quitAndInstall()
    } catch {
      this.set({ phase: 'error', message: 'Nalu could not prepare a safe restart. Your app is still open.' })
    } finally { this.installing = false }
  }
}
