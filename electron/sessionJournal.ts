import { promises as fs } from 'node:fs'
import path from 'node:path'

export class SessionJournal {
  private pending: Promise<void> = Promise.resolve()
  private queued = 0
  get busy() { return this.queued > 0 }
  constructor(private file: string) {}
  async read(): Promise<string | null> {
    await this.pending
    try { return await fs.readFile(this.file, 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  write(content: string): Promise<void> {
    this.queued++
    const next = this.pending.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true })
      const temporary = this.file + '.tmp'
      const handle = await fs.open(temporary, 'w', 0o600)
      try { await handle.writeFile(content, 'utf8'); await handle.sync() }
      finally { await handle.close() }
      await fs.rename(temporary, this.file)
    })
    this.pending = next.finally(() => { this.queued-- })
    return this.pending
  }
  flush(): Promise<void> { return this.pending }
}
