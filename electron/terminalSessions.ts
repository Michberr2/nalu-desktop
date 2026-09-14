export interface TerminalProcess {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): unknown
  onExit(cb: (event: { exitCode: number }) => void): unknown
}

type Session = { process?: TerminalProcess }

// Reserve a generation before asynchronous startup. A closed tab or an old
// process exiting must never resurrect or delete its replacement session.
export class TerminalSessions {
  private sessions = new Map<string, Session>()
  get count() { return this.sessions.size }

  async create(key: string, spawn: () => Promise<TerminalProcess>, send: (event: 'data' | 'exit', value: string | number) => void) {
    this.kill(key)
    const session: Session = {}
    this.sessions.set(key, session)
    try {
      const proc = await spawn()
      if (this.sessions.get(key) !== session) { proc.kill(); return false }
      session.process = proc
      proc.onData(data => { if (this.sessions.get(key) === session) send('data', data) })
      proc.onExit(({ exitCode }) => {
        if (this.sessions.get(key) !== session) return
        this.sessions.delete(key)
        send('exit', exitCode)
      })
      return true
    } catch (error) {
      if (this.sessions.get(key) === session) this.sessions.delete(key)
      throw error
    }
  }

  input(key: string, data: string) { this.sessions.get(key)?.process?.write(data) }
  resize(key: string, cols: number, rows: number) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 1000 || rows > 1000) return
    try { this.sessions.get(key)?.process?.resize(cols, rows) } catch { /* process exited */ }
  }
  kill(key: string) {
    const session = this.sessions.get(key)
    this.sessions.delete(key)
    try { session?.process?.kill() } catch { /* already exited */ }
  }
  killOwner(owner: number) {
    for (const key of this.sessions.keys()) if (key.startsWith(`${owner}:`)) this.kill(key)
  }
  killAll() { for (const key of this.sessions.keys()) this.kill(key) }
}
