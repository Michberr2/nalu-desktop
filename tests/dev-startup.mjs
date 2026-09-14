// Exercise the repository's actual Vite configuration, startup hook and preload.
// All user state and terminals belong to an isolated profile and HOME.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-dev-startup-'))
const home = path.join(scratch, 'home'), profile = path.join(scratch, 'profile')
fs.mkdirSync(home)
const reservation = net.createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const env = Object.fromEntries(['PATH', 'TMPDIR', 'LANG', 'LC_ALL'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
Object.assign(env, { HOME: home, NALU_DEV_PROFILE: profile, REMOTE_DEBUGGING_PORT: String(port), GH_CONFIG_DIR: path.join(home, 'gh'), GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', NALU_NO_TRAINING_DATA: '1' })
const child = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '0'], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
const exited = new Promise(resolve => child.once('exit', resolve))
let output = '', socket, sessionId, sequence = 0
const pending = new Map()
const capture = chunk => { output += chunk; fs.appendFileSync(path.join(scratch, 'dev.log'), chunk) }
child.stdout.on('data', capture); child.stderr.on('data', capture)
child.on('error', error => capture(String(error)))
const receipt = { startedAt: new Date().toISOString(), passed: false, scope: 'Actual Vite dev startup, isolated account/profile, renderer bridge and native terminal. No live authentication or hot-reload acceptance.' }
const wait = async (check, label) => {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if (await check()) return
    if (child.exitCode !== null || child.signalCode !== null) throw Error('Development process exited: ' + output.slice(-5000))
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw Error('Timed out: ' + label + '\n' + output.slice(-5000))
}
const call = (method, params = {}, target = sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence
  const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)) }, 15000)
  pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result) }, reject: error => { clearTimeout(timer); reject(error) } })
  socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }))
})
const js = async expression => {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
  return response.result.value
}
try {
  await wait(() => /DevTools listening on (ws:\/\/[^\s]+)/.test(output), 'development Electron')
  socket = new WebSocket(output.match(/DevTools listening on (ws:\/\/[^\s]+)/)[1])
  socket.addEventListener('close', event => { receipt.debuggerClosed = { code: event.code, reason: event.reason } })
  socket.addEventListener('error', () => { receipt.debuggerError = true })
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), handler = pending.get(message.id)
    fs.appendFileSync(path.join(scratch, 'debugger.jsonl'), JSON.stringify({ id: message.id, method: message.method, error: message.error }) + '\n')
    if (!handler) return
    pending.delete(message.id)
    if (message.error) handler.reject(Error(message.error.message)); else handler.resolve(message.result)
  })
  let target
  const servedUrl = new URL(output.match(/Local:\s+(http:\/\/[^\s]+)/)[1])
  const appOrigins = new Set([servedUrl.origin, `http://localhost:${servedUrl.port}`])
  await wait(async () => {
    const targets = (await call('Target.getTargets')).targetInfos
    receipt.targets = targets.map(({ type, url, title }) => ({ type, url, title }))
    target = targets.find(target => target.type === 'page' && /^http:\/\//.test(target.url) && appOrigins.has(new URL(target.url).origin))
    return target
  }, 'Vite renderer')
  receipt.url = target.url
  sessionId = (await call('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId
  await call('Network.enable')
  await call('Network.setBlockedURLs', { urls: ['https://*'] })
  await wait(() => js(`!!window.nalu && !!document.querySelector('button[title="Sign in"]')`), 'development UI and bridge')
  assert.equal(await js('typeof require'), 'undefined')
  assert.equal(await js('localStorage.getItem("nalu-token")'), null)
  receipt.desktopVersion = await js('window.nalu.appVersion()')
  const processes = await call('SystemInfo.getProcessInfo', {}, null)
  const browser = processes.processInfo.find(process => process.type === 'browser')
  assert.ok(browser)
  receipt.command = execFileSync('ps', ['-p', String(browser.id), '-o', 'command='], { encoding: 'utf8' }).trim()
  assert.ok(receipt.command.includes('--user-data-dir=' + profile))
  assert.ok(!receipt.command.includes('--no-sandbox'), 'development must preserve Chromium sandboxing')
  await js(`window.devOutput='';window.nalu.term.onData('dev-check',data=>{window.devOutput+=data});void 0`)
  assert.equal(await js(`window.nalu.term.create('dev-check',${JSON.stringify(home)},'sh')`), true)
  await js(`window.nalu.term.input('dev-check',"printf 'DEV_PTY_OK\\n'\\n");void 0`)
  await wait(() => js(`window.devOutput.includes('DEV_PTY_OK')`), 'native development terminal')
  await js(`window.nalu.term.kill('dev-check')`)
  fs.writeFileSync(path.join(scratch, 'development.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  receipt.passed = true
  console.log('DEVELOPMENT_STARTUP_BRIDGE_PTY_PASS')
} catch (error) {
  receipt.error = error.stack || String(error)
  console.error(error)
  process.exitCode = 1
} finally {
  socket?.close()
  if (child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 3000)
    await exited; clearTimeout(timer)
  }
  receipt.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(scratch, 'result.json'), JSON.stringify(receipt, null, 2) + '\n')
  console.log('Evidence: ' + scratch)
}
