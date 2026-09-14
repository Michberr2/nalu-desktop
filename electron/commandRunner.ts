import { spawn } from 'node:child_process'
import os from 'node:os'

export type CommandResult = { code: number; output: string }
export function runCommand(cwd: string, command: string, { signal, timeoutMs = 60000, graceMs = 1000 }: {
  signal?: AbortSignal; timeoutMs?: number; graceMs?: number
} = {}): Promise<CommandResult> {
  if (signal?.aborted) return Promise.resolve({ code: 130, output: '[cancelled]' })
  return new Promise(resolve => {
    const windows = process.platform === 'win32'
    const shell = windows ? 'powershell.exe' : process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
    const child = spawn(shell, windows ? ['-Command', command] : ['-lc', command], {
      cwd: cwd || os.homedir(), env: process.env, detached: !windows,
    })
    let output = '', stopped = 0, settled = false
    let escalation: ReturnType<typeof setTimeout> | undefined
    const append = (data: string) => { output += data.slice(0, Math.max(0, 40000 - output.length)) }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', append); child.stderr.on('data', append)
    const killTree = (force: boolean) => {
      if (!child.pid) return
      if (windows) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', ...(force ? ['/F'] : [])], { windowsHide: true })
        killer.on('error', () => { try { child.kill() } catch { /* exited */ } })
      } else {
        try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM') } catch { /* exited */ }
      }
    }
    const finish = (code: number) => {
      if (settled) return
      settled = true; clearTimeout(deadline); clearTimeout(escalation)
      signal?.removeEventListener('abort', abort)
      child.stdout.destroy(); child.stderr.destroy()
      resolve({ code, output: output + (code === 130 ? '\n[cancelled]' : code === 124 ? `\n[timed out after ${timeoutMs}ms]` : '') })
    }
    const stop = (code: number) => {
      if (settled || stopped) return
      stopped = code; killTree(false)
      // Keep this timer even if the shell exits: a descendant may ignore TERM.
      escalation = setTimeout(() => { killTree(true); finish(code) }, graceMs)
    }
    const abort = () => stop(130)
    const deadline = setTimeout(() => stop(124), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.on('close', code => { if (!stopped) finish(code ?? 1) })
    child.on('error', error => { append(String(error)); if (!stopped) finish(1) })
  })
}
