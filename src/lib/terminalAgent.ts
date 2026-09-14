import type { WireMessage } from './naluApi'

type Result = { code: number; output: string }
type Line = { cmd?: string; out?: string; running?: boolean; done?: string }

// The executor already starts in cwd. Keep cwd out of shell source entirely.
export function createTerminalExecutor(initialCwd: string, exec: (cwd: string, command: string) => Promise<Result>) {
  let cwd = initialCwd
  return async (command: string) => {
    const marker = `__NALUCWD_${crypto.randomUUID().replaceAll('-', '')}__`
    const wrapped = `{\n${command}\n}\n__nalu_exit=$?\nprintf '\\n${marker}%s\\n' "$PWD"\nexit $__nalu_exit`
    const result = await exec(cwd, wrapped)
    let out = result.output
    const at = out.lastIndexOf(`\n${marker}`)
    if (at >= 0) {
      const next = out.slice(at + marker.length + 1).replace(/\n$/, '')
      if (next.startsWith('/')) cwd = next
      out = out.slice(0, at)
    }
    return { code: result.code, out: out || `(exit ${result.code})` }
  }
}

export async function runTerminalAgent(options: {
  request: string
  signal: AbortSignal
  reply: (history: WireMessage[]) => Promise<string>
  run: (command: string) => Promise<{ code: number; out: string }>
  approve: (command: string) => Promise<boolean>
  onLine: (line: Line, replace?: boolean) => void
  maxSteps?: number
}): Promise<boolean> {
  const { request, signal, reply, run, approve, onLine, maxSteps = 24 } = options
  const history: WireMessage[] = [
    { role: 'system', content: 'Operate the terminal to accomplish the user’s goal. Reply with only the next shell command, then inspect its exit code and output before deciding what to do next. The working directory persists across commands. When the requested outcome is verified, reply exactly DONE: <one-line summary>. Never claim success without successful execution. If a command fails, investigate and recover before completing.' },
    { role: 'user', content: request },
  ]
  let lastCode: number | undefined
  for (let step = 0; step < maxSteps && !signal.aborted; step++) {
    const response = (await reply(history)).trim()
    if (signal.aborted) return false
    history.push({ role: 'assistant', content: response })
    const done = response.match(/^DONE:\s*(\S[^\n]*)$/i)
    if (done) {
      if (lastCode === 0) { onLine({ done: done[1].slice(0, 300) }); return true }
      history.push({ role: 'user', content: 'Completion rejected: no successful command result, or the last command failed. Execute and verify the requested work before declaring DONE.' })
      continue
    }
    const fence = response.match(/^```(?:[a-z]+)?\s*\n([\s\S]*?)\n```$/i)
    const command = (fence ? fence[1] : response).trim()
    if (!command || /```|^DONE:/im.test(command)) {
      history.push({ role: 'user', content: 'Return only a shell command, or a standalone DONE response after verification.' })
      continue
    }
    onLine({ cmd: command, out: 'Waiting for approval…', running: false })
    const allowed = await approve(command)
    if (signal.aborted) return false
    if (!allowed) {
      onLine({ cmd: command, out: 'Denied. Task stopped.', running: false }, true)
      return false
    }
    onLine({ cmd: command, out: '', running: true }, true)
    const result = await run(command)
    onLine({ cmd: command, out: result.out, running: false }, true)
    if (signal.aborted) return false
    lastCode = result.code
    history.push({ role: 'user', content: `exit ${result.code}\n${result.out.slice(0, 4000)}` })
  }
  if (!signal.aborted) onLine({ out: `Stopped after ${maxSteps} steps without confirmed completion.` })
  return false
}
