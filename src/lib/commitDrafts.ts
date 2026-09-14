type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export class CommitDrafts {
  private cache = new Map<string, string>()
  private failures = new Map<string, string>()
  constructor(private storage: () => DraftStorage) {}
  error(folder: string): string | undefined { return this.failures.get(folder) }
  read(folder: string): string {
    if (this.cache.has(folder)) return this.cache.get(folder)!
    const value = this.storage().getItem('nalu-git-draft:' + folder) || ''
    this.cache.set(folder, value)
    return value
  }
  write(folder: string, value: string): void {
    // Preserve the live draft even when persistence fails. Callers show the error.
    this.cache.set(folder, value)
    try {
      const storage = this.storage(), key = 'nalu-git-draft:' + folder
      if (value) storage.setItem(key, value)
      else storage.removeItem(key)
      this.failures.delete(folder)
    } catch (error) { this.failures.set(folder, String(error)); throw error }
  }
}
