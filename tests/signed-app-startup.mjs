// Launch the actual distribution executable, without replacing main/preload or
// app.isPackaged. All writable user state belongs to this retained test profile.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import http from 'node:http'

const executable = path.resolve(process.argv[2] || '')
assert.ok(process.argv[2] && executable.endsWith('/Contents/MacOS/Nalu'), 'Supply the packaged Nalu executable')
const resources = path.resolve(path.dirname(executable), '../Resources')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-signed-startup-'))
const home = path.join(scratch, 'home'), profile = path.join(scratch, 'profile'), project = path.join(scratch, 'project')
for (const directory of [home, profile, project]) fs.mkdirSync(directory)
const file = path.join(project, 'signed-fixture.txt')
fs.writeFileSync(file, 'ORIGINAL_SIGNED_FIXTURE\n')
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const binding = () => ({ executable: sha(executable), archive: sha(path.join(resources, 'app.asar')), cli: sha(path.join(resources, 'cli/nalu.mjs')) })
const receipt = { executable, startedAt: new Date().toISOString(), binding: binding(), checks: [], passed: false,
  scope: 'Actual macOS distribution executable in an isolated profile, including real editor input, PTY/CLI, forced-exit recovery and saving. Does not verify notarization, normal-user authentication or other platforms.' }
const env = Object.fromEntries(['PATH', 'TMPDIR', 'LANG', 'LC_ALL'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
Object.assign(env, { HOME: home, GH_CONFIG_DIR: path.join(home, 'gh'), GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', NALU_NO_TRAINING_DATA:'1',NALU_DISABLE_UPDATES:'1' })
let child, exited, socket, sequence = 0, sessionId, attempt = 0
const settingsRequests = []
const apiFixture = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/chat') { res.writeHead(404); res.end(); return }
  let body = ''; for await (const chunk of req) body += chunk
  settingsRequests.push(JSON.parse(body))
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.end('event: delta\ndata: {"text":"SETTINGS_RESPONSE_ACCEPTED"}\n\nevent: done\ndata: {"ok":true}\n\n')
})
await new Promise(resolve => apiFixture.listen(0, '127.0.0.1', resolve))
const fixtureApi = `http://127.0.0.1:${apiFixture.address().port}`
const pending = new Map()
const wait = async (check, label, timeout = 20000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)) }
  throw Error('Timed out: ' + label)
}
const call = (method, params = {}, target = sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence
  const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timed out: ' + method)) }, 15000)
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
  socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }))
})
const js = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function launch() {
  sessionId = undefined
  let output = ''
  const log = fs.createWriteStream(path.join(scratch, `launch-${++attempt}.log`))
  child = spawn(executable, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile], { cwd: project, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  exited = new Promise(resolve => child.once('exit', (code, signal) => { log.end(); resolve({ code, signal }) }))
  child.stdout.on('data', data => log.write(data))
  child.stderr.on('data', data => { output += data; log.write(data) })
  child.once('error', error => { output += error.message })
  await wait(() => /DevTools listening on (ws:\/\/[^\s]+)/.test(output), 'debug connection')
  socket = new WebSocket(output.match(/DevTools listening on (ws:\/\/[^\s]+)/)[1])
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const handler = pending.get(message.id)
    if (!handler) return
    pending.delete(message.id)
    if (message.error) handler.reject(Error(message.error.message)); else handler.resolve(message.result)
  })
  let target
  await wait(async () => { target = (await call('Target.getTargets')).targetInfos.find(target => target.type === 'page' && target.url.startsWith('file:') && !target.url.endsWith('#companion')); return target }, 'application page')
  sessionId = (await call('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId
  await call('Page.bringToFront')
  await call('Network.enable')
  await call('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] })
  await wait(() => js(`!!window.nalu && !!document.querySelector('button[title="Sign in"]')`), 'fresh-profile UI')
  assert.equal(await js('localStorage.getItem("nalu-token")'), null)
}
async function stop(signal = 'SIGTERM') {
  socket?.close(); socket = null
  if (child && child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 3000)
    await exited; clearTimeout(timer)
  }
}
try {
  const runtime = spawnSync(executable, ['-p', 'JSON.stringify(process.versions)'], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 15000 })
  assert.equal(runtime.status, 0, runtime.stderr)
  receipt.runtime = JSON.parse(runtime.stdout)
  if (process.env.NALU_EXPECT_ELECTRON) assert.equal(receipt.runtime.electron, process.env.NALU_EXPECT_ELECTRON)
  await launch()
  receipt.desktopVersion = await js('window.nalu.appVersion()')
  assert.equal(await js('typeof require'), 'undefined')
  await js(`localStorage.setItem('nalu-last-folder', ${JSON.stringify(project)}); localStorage.setItem('nalu-avatar-app-mode', 'ide')`)
  // Seed an isolated workspace through the real persistence bridge; this check
  // does not automate the macOS folder chooser.
  await js(`window.nalu.saveWorkspace(${JSON.stringify(JSON.stringify({ version: 1, folder: project, tabs: [], activePath: null }))})`)
  await call('Page.reload')
  await wait(() => js(`document.body?.textContent.includes('signed-fixture.txt')`), 'project tree')
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'p', metaKey:true, bubbles:true}))`)
  await wait(() => js(`!!document.querySelector('[cmdk-item]')`), 'quick open')
  await js(`document.querySelector('[cmdk-item]').click()`)
  await wait(() => js(`document.querySelector('.view-lines')?.textContent.includes('ORIGINAL_SIGNED_FIXTURE')`), 'editor content')
  receipt.checks.push('actual packaged startup, isolated profile, project tree and quick open')
  await js(`document.querySelector('button[title="Sign in"]').focus();document.querySelector('button[title="Sign in"]').click()`)
  await wait(() => js(`!!document.querySelector('[aria-label="Web search"]')`), 'settings controls')
  assert.equal(await js(`!!document.querySelector('dialog[open][aria-labelledby="settings-title"]')`), true, 'Settings must expose a named modal dialog')
  assert.equal(await js(`document.querySelector('dialog[open]').contains(document.activeElement)`), true, 'opening Settings must move focus inside')
  assert.deepEqual(await js(`Array.from(document.querySelectorAll('dialog input')).filter(input => input.getClientRects().length && !input.labels?.length).map(input=>input.type)`), [], 'account fields need persistent visible labels')
  await js(`window.settingsControls=Array.from(document.querySelectorAll('dialog button,dialog input,dialog select,dialog textarea,dialog a[href]')).filter(e=>!e.disabled&&e.getClientRects().length);window.settingsControls.at(-1).focus();void 0`)
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  // Chromium includes a scrollable dialog itself in the focus order.
  assert.equal(await js(`document.querySelector('dialog[open]').contains(document.activeElement)`), true, 'Tab remains inside Settings')
  if (await js(`document.activeElement===document.querySelector('dialog[open]')`)) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  }
  assert.equal(await js(`document.activeElement===window.settingsControls[0]`), true, 'Tab wraps to the first Settings control')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', modifiers: 8, windowsVirtualKeyCode: 9 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', modifiers: 8, windowsVirtualKeyCode: 9 })
  assert.equal(await js(`document.querySelector('dialog[open]').contains(document.activeElement)`), true, 'Shift+Tab remains inside Settings')
  if (await js(`document.activeElement===document.querySelector('dialog[open]')`)) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', modifiers: 8, windowsVirtualKeyCode: 9 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', modifiers: 8, windowsVirtualKeyCode: 9 })
  }
  assert.equal(await js(`document.activeElement===window.settingsControls.at(-1)`), true, 'Shift+Tab wraps to the last Settings control')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'p', code: 'KeyP', modifiers: 4, windowsVirtualKeyCode: 80 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'p', code: 'KeyP', modifiers: 4, windowsVirtualKeyCode: 80 })
  assert.equal(await js(`!!document.querySelector('[cmdk-input]')`), false, 'IDE shortcuts must not open a second overlay behind Settings')
  await call('Emulation.setDeviceMetricsOverride', { width: 900, height: 560, deviceScaleFactor: 1, mobile: false })
  assert.equal(await js(`(()=>{const d=document.querySelector('dialog[open]'),r=d.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&d.scrollHeight>d.clientHeight})()`), true, 'Settings stays in a short viewport and scrolls')
  await js(`document.querySelector('dialog[open]').scrollTop=0;void 0`)
  fs.writeFileSync(path.join(scratch, 'settings-short.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await js(`document.querySelector('dialog[open]').scrollTop=document.querySelector('dialog[open]').scrollHeight;void 0`)
  assert.equal(await js(`(()=>{const d=document.querySelector('dialog[open]').getBoundingClientRect(),b=document.querySelector('[aria-label="Close settings"]').getBoundingClientRect();return b.top>=d.top&&b.bottom<=d.bottom})()`), true, 'the Settings close control stays visible while scrolling')
  assert.equal(await js(`(()=>{const d=document.querySelector('dialog[open]'),h=document.querySelector('#settings-title').parentElement;return Math.abs(h.getBoundingClientRect().top-d.getBoundingClientRect().top-d.clientTop)<=1})()`), true, 'scrolled content must not appear above the Settings header')
  fs.writeFileSync(path.join(scratch, 'settings-short-bottom.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await call('Emulation.clearDeviceMetricsOverride')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await wait(() => js(`!document.querySelector('dialog[open]') && !document.querySelector('[aria-label="Web search"]')`), 'Escape closes Settings')
  assert.equal(await js(`document.activeElement===document.querySelector('button[title="Sign in"]')`), true, 'closing Settings restores the initiating control')
  await js(`document.querySelector('button[title="Sign in"]').click()`)
  await wait(() => js(`!!document.querySelector('dialog[open]')`), 'settings reopened for pointer checks')
  const padding = await js(`(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return {x:r.right-8,y:r.top+70}})()`)
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...padding, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...padding, button: 'left', clickCount: 1 })
  assert.equal(await js(`!!document.querySelector('dialog[open]')`), true, 'clicking dialog padding keeps Settings open')
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 10, y: 10, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 10, y: 10, button: 'left', clickCount: 1 })
  await wait(() => js(`!document.querySelector('dialog[open]')`), 'backdrop click closes Settings')
  receipt.checks.push('Settings modal semantics, visible account labels, focus containment, IDE shortcut isolation, short-viewport scrolling, Escape and focus restoration')
  await js(`document.querySelector('button[title="Sign in"]').click()`)
  await wait(() => js(`!!document.querySelector('[aria-label="Web search"]')`), 'settings reopened')
  await js(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='high').click()`)
  await js(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='16k').click()`)
  await js(`document.querySelector('[aria-label="Web search"]').click()`)
  const fullConfig = path.join(home, '.nalu/config.json')
  await wait(() => {
    if (!fs.existsSync(fullConfig)) return false
    const config = JSON.parse(fs.readFileSync(fullConfig))
    return config.reasoning === 'high' && config.maxTokens === 16000 && config.webSearch === false
  }, 'desktop preferences synchronized to terminal CLI')
  await wait(() => js(`document.body.textContent.includes(${JSON.stringify('Nalu Desktop ')}+${JSON.stringify(receipt.desktopVersion)})`), 'actual version in settings')
  await js(`document.querySelector('[aria-label="Close settings"]').click()`)
  await js(`window.acceptanceOutput='';window.nalu.term.onData('signed-test',data=>{window.acceptanceOutput+=data});void 0`)
  assert.equal(await js(`window.nalu.term.create('signed-test',${JSON.stringify(project)},'sh')`), true)
  await js(`window.nalu.term.input('signed-test',"printf 'SIGNED_PTY_OK\\n'\\nnalu --version\\n");void 0`)
  const cli = fs.readFileSync(path.join(resources, 'cli/nalu.mjs'))
  receipt.cliVersion = cli.toString().match(/^const VERSION = '([^']+)'/m)[1]
  await wait(() => js(`window.acceptanceOutput.includes('SIGNED_PTY_OK') && window.acceptanceOutput.includes(${JSON.stringify('nalu ' + receipt.cliVersion)})`), 'signed executable PTY and installed CLI')
  assert.deepEqual(fs.readFileSync(path.join(home, '.nalu/bin/nalu.mjs')), cli)
  await js(`window.nalu.term.input('signed-test',${JSON.stringify(`nalu --api ${fixtureApi} -p --no-stdin 'Reply SETTINGS_WIRE_OK'\n`)});void 0`)
  await wait(async () => settingsRequests.length > 0 && await js(`window.acceptanceOutput.includes('SETTINGS_RESPONSE_ACCEPTED')`), 'CLI settings request')
  assert.equal(settingsRequests[0].reasoning, 'high')
  assert.equal(settingsRequests[0].maxTokens, 16000)
  assert.equal(settingsRequests[0].webSearch, false)
  assert.ok(settingsRequests[0].tools.every(tool => !['web_search', 'fetch_url'].includes(tool.function.name)))
  receipt.checks.push('Settings UI, disk configuration and actual terminal CLI request preserve reasoning, capacity and disabled web tools')
  await js(`window.nalu.term.kill('signed-test')`)
  receipt.checks.push('native PTY and exact bundled CLI installation/execution')
  const position = await js(`(()=>{const box=document.querySelector('.view-line').getBoundingClientRect();return {x:box.x+30,y:box.y+8}})()`)
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'left', clickCount: 1 })
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 })
  await call('Input.insertText', { text: 'UNSAVED_SIGNED_RECOVERY\n' })
  await wait(() => js(`!!document.querySelector('[aria-label="Unsaved changes"]')`), 'unsaved edit')
  assert.equal(fs.readFileSync(file, 'utf8'), 'ORIGINAL_SIGNED_FIXTURE\n')
  const journal = path.join(profile, 'workspace-recovery.json')
  await wait(() => fs.existsSync(journal) && fs.readFileSync(journal, 'utf8').includes('UNSAVED_SIGNED_RECOVERY'), 'durable journal in isolated profile')
  await stop('SIGKILL')
  await launch()
  await wait(() => js(`document.querySelector('.view-lines')?.textContent.includes('UNSAVED_SIGNED_RECOVERY') && document.body.textContent.includes('Recovered unsaved edits')`), 'recovered unsaved editor after forced exit')
  await wait(() => js(`!!document.querySelector('button[title="New file"]') && !document.body.textContent.includes('No folder open')`), 'project folder restored after forced exit')
  assert.equal(fs.readFileSync(file, 'utf8'), 'ORIGINAL_SIGNED_FIXTURE\n')
  fs.writeFileSync(path.join(scratch, 'recovered.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await js(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Save recovered edits').click()`)
  await wait(() => fs.readFileSync(file, 'utf8') === 'UNSAVED_SIGNED_RECOVERY\n', 'save recovered edits')
  receipt.checks.push('real keyboard edit, durable project and unsaved recovery after SIGKILL and explicit save')
  // Exercise language workers through the actual editor; rendering plain text
  // alone would miss broken worker exports after a Monaco/bundler upgrade.
  for (const fixture of [
    { name: 'worker-fixture.json', invalid: '{"broken": }\n', valid: '{"verified": true}\n', text: 'verified' },
    { name: 'worker-fixture.ts', invalid: 'const workerValue: number = "wrong";\n', valid: 'const workerValue: number = 42;\n', text: '42' },
  ]) {
    const target = path.join(project, fixture.name)
    fs.writeFileSync(target, fixture.invalid)
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'p', code: 'KeyP', modifiers: 4, windowsVirtualKeyCode: 80 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'p', code: 'KeyP', modifiers: 4, windowsVirtualKeyCode: 80 })
    await wait(() => js(`Array.from(document.querySelectorAll('[cmdk-item]')).some(item=>item.textContent===${JSON.stringify(fixture.name)})`), 'language fixture in quick open')
    await js(`Array.from(document.querySelectorAll('[cmdk-item]')).find(item=>item.textContent===${JSON.stringify(fixture.name)}).click()`)
    await wait(() => js(`!!document.querySelector('.squiggly-error')`), fixture.name + ' worker reports invalid content', 30000)
    fs.writeFileSync(path.join(scratch, fixture.name + '.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    fs.writeFileSync(target, fixture.valid)
    await wait(() => js(`document.querySelector('.view-lines')?.textContent.includes(${JSON.stringify(fixture.text)}) && !document.querySelector('.squiggly-error')`), fixture.name + ' worker clears diagnostics after an external correction', 30000)
  }
  receipt.checks.push('bundled JSON and TypeScript workers report real errors and clear diagnostics after external file corrections')
  assert.deepEqual(binding(), receipt.binding)
  receipt.passed = true
  console.log('SIGNED_EXECUTABLE_STARTUP_PTY_CLI_CRASH_RECOVERY_PASS')
} catch (error) {
  receipt.error = error.stack
  process.exitCode = 1
  console.error(error)
} finally {
  await stop()
  apiFixture.closeAllConnections(); await new Promise(resolve => apiFixture.close(resolve))
  receipt.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(scratch, 'result.json'), JSON.stringify(receipt, null, 2) + '\n')
  console.log('Evidence: ' + scratch)
}
