type GitResult = { ok: boolean; out: string }
export async function commitAndPush(run: (args: string[]) => Promise<GitResult>, message: string) {
  const staged = await run(['add', '-A'])
  if (!staged.ok) throw new Error(staged.out || 'Staging failed. Nothing was committed or pushed.')
  const commit = await run(['commit', '-m', message])
  if (!commit.ok) throw new Error(commit.out || 'Commit failed. Nothing was pushed.')
  const remote = await run(['remote'])
  if (!remote.ok || !remote.out.trim()) return { commit: commit.out, push: remote.out || 'No remote — connect/clone a GitHub repo to push.', ok: false }
  const branch = await run(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!branch.ok || !branch.out.trim() || branch.out.trim() === 'HEAD') {
    return { commit: commit.out, push: 'Committed locally, but no branch is available to push.', ok: false }
  }
  const pushed = await run(['push', '-u', 'origin', `HEAD:${branch.out.trim()}`])
  return { commit: commit.out, push: pushed.out, ok: pushed.ok }
}
