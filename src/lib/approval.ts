// A stopped task must not remain blocked on its permission prompt. Late clicks
// resolve nothing and cannot approve an action belonging to the cancelled task.
export function awaitApproval(signal: AbortSignal, show: (finish: (approved: boolean) => void) => void): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (approved: boolean) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      resolve(approved && !signal.aborted)
    }
    const abort = () => finish(false)
    signal.addEventListener('abort', abort, { once: true })
    try { show(finish) }
    catch (error) { settled = true; signal.removeEventListener('abort', abort); reject(error) }
  })
}
