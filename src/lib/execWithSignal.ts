export async function execWithSignal(cwd: string, command: string, signal?: AbortSignal) {
  if (signal?.aborted) return { code: 130, output: '[cancelled]' }
  const id = crypto.randomUUID()
  const pending = window.nalu.exec(cwd, command, id)
  const cancel = () => window.nalu.cancelExec(id)
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  try { return await pending }
  finally { signal?.removeEventListener('abort', cancel) }
}
