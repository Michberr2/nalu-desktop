export type GitResult = { ok: boolean; out: string }
export type GitRunner = (cwd: string, args: string[]) => Promise<GitResult>

export function parseGitStatus(raw: string) {
  const records = raw.split('\0')
  const files: Array<{ x: string; y: string; path: string }> = []
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (record.length < 4) continue
    files.push({ x: record[0], y: record[1], path: record.slice(3) })
    // -z emits the destination first and then a separate original path.
    if (/[RC]/.test(record.slice(0, 2))) i++
  }
  return files
}

export async function workspaceStatus(git: GitRunner, cwd: string) {
  const repo = await git(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (!repo.ok) return { repo: false }
  const [branch, status] = await Promise.all([
    git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ])
  if (!status.ok) throw new Error(status.out || 'Could not read Git status.')
  const name = branch.ok ? branch.out.trim() : (await git(cwd, ['rev-parse', '--short', 'HEAD'])).out.trim()
  return { repo: true, branch: name, files: parseGitStatus(status.out) }
}

export async function workspaceDiff(git: GitRunner, cwd: string, file?: string, staged?: boolean) {
  const args = staged === undefined ? ['diff', 'HEAD'] : staged ? ['diff', '--cached'] : ['diff']
  const diff = await git(cwd, [...args, ...(file ? ['--', file] : [])])
  if (diff.ok && diff.out) return diff.out
  if (file && !staged) {
    const untracked = await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', file])
    if (untracked.ok && untracked.out) {
      // --no-index returns 1 when a diff exists.
      return (await git(cwd, ['diff', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', file])).out
    }
  }
  if (!diff.ok) throw new Error(diff.out || 'Could not read Git diff.')
  return ''
}
