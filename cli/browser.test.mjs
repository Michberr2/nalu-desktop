import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { browserRuntime, createBrowserSession, execTool, streamOnce, browserObservationIssues } from './nalu.mjs'

function fixture(t, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-browser-rpc-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const appPath = path.join(dir, "worker's file.mjs")
  fs.writeFileSync(appPath, body)
  return { executable: process.execPath, appPath }
}
test('browser transport isolates its environment and matches responses to requests', async t => {
  const runtime = fixture(t, `import readline from 'node:readline';
    process.stdout.write(JSON.stringify({ready:true,protocol:1})+'\\n');
    readline.createInterface({input:process.stdin}).on('line',line=>{const {id,command}=JSON.parse(line);
      process.stdout.write(JSON.stringify({id,ok:true,result:{action:command.action,env:process.env}})+'\\n');
    });`)
  const browser = createBrowserSession(runtime, { env: { PATH: process.env.PATH, HOME: os.tmpdir(), SECRET_TOKEN: 'never-forward', NODE_OPTIONS: '--invalid', ELECTRON_RUN_AS_NODE: '1', NALU_TOKEN: 'private' } })
  t.after(() => browser.close())
  const [a, b] = await Promise.all([browser.call({ action: 'snapshot' }), browser.call({ action: 'assert' })])
  assert.equal(a.action, 'snapshot'); assert.equal(b.action, 'assert')
  assert.equal(a.env.HOME, os.tmpdir())
  for (const name of ['SECRET_TOKEN', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'NALU_TOKEN']) assert.equal(a.env[name], undefined)
  await browser.close()
  assert.throws(() => process.kill(browser.pid, 0), { code: 'ESRCH' })
})
test('browser startup failures and hung actions terminate instead of leaving unresolved requests', async t => {
  const broken = createBrowserSession(fixture(t, `process.stdout.write('not json\\n');setInterval(()=>{},1000)`), { timeoutMs: 1500 })
  await assert.rejects(broken.call({ action: 'open' }), /Invalid browser response/)
  await broken.close()
  const hung = createBrowserSession(fixture(t, `process.stdout.write('{"ready":true,"protocol":1}\\n');process.stdin.resume();setInterval(()=>{},1000)`), { timeoutMs: 150 })
  await assert.rejects(hung.call({ action: 'snapshot' }), /timed out/)
  await hung.exited
  assert.throws(() => process.kill(hung.pid, 0), { code: 'ESRCH' })
})
test('cancellation rejects an in-flight browser action and closes the process', async t => {
  const browser = createBrowserSession(fixture(t, `process.stdout.write('{"ready":true,"protocol":1}\\n');process.stdin.resume();setInterval(()=>{},1000)`))
  await browser.ready
  const action = browser.call({ action: 'open' })
  browser.abort()
  await assert.rejects(action, /closed|cancelled/)
  await browser.exited
  assert.throws(() => process.kill(browser.pid, 0), { code: 'ESRCH' })
})
test('browser is unavailable without an actual desktop runtime and cannot run in read-only mode', async () => {
  assert.deepEqual(browserRuntime({}), process.versions.electron ? { executable: process.execPath, appPath: '' } : null)
  assert.equal(browserRuntime({ NALU_DESKTOP_RUNTIME: '/missing-nalu-app' }), null)
  const state = { readOnly: true, sessionAllow: new Set(), workerAborts: new Set() }
  const result = await execTool(state, { function: { name: 'browser', arguments: '{"action":"open","url":"http://127.0.0.1:3000"}' } })
  assert.match(result, /read-only/)
  assert.equal(state.browserSession, undefined)
})
test('browser argument validation rejects malformed origins before launching', async () => {
  const state = { yolo: true, sessionAllow: new Set(), workerAborts: new Set() }
  const result = await execTool(state, { function: { name: 'browser', arguments: '{"action":"open","origins":[123]}' } })
  assert.match(result, /must be a array/)
  assert.equal(state.browserSession, undefined)
})
test('read-only model requests never advertise the browser tool', async t => {
  const before = process.env.NALU_DESKTOP_RUNTIME
  process.env.NALU_DESKTOP_RUNTIME = process.execPath
  t.after(() => { if (before === undefined) delete process.env.NALU_DESKTOP_RUNTIME; else process.env.NALU_DESKTOP_RUNTIME = before })
  const fetchBefore = globalThis.fetch
  t.after(() => { globalThis.fetch = fetchBefore })
  let request
  globalThis.fetch = async (_url, options) => { request = JSON.parse(options.body); return new Response('event: done\ndata: {"ok":true}\n\n') }
  await streamOnce({ messages: [{ role: 'user', content: 'Inspect' }], readOnly: true, api: 'http://127.0.0.1', token: '', workerAborts: new Set() }, null, { quiet: true })
  assert.ok(request.tools.length > 0)
  assert.ok(request.tools.every(tool => tool.function.name !== 'browser'))
})

const check = { name: 'bash', arguments: { command: 'node --check app.js' } }
const browserCall = arguments_ => ({ name: 'browser', arguments: arguments_ })
const behavior = browserCall({ action: 'assert', assertion: 'text', selector: '#result', expected: 'saved' })
for (const [label, tail, expectedCode] of [
  ['requires actual browser evidence after a build', [], 1],
  ['accepts a successful behavior assertion after the final build', [behavior], 0],
  ['invalidates browser evidence after a later shell command', [behavior, check], 1],
  ['retains failed checks despite an unrelated passing assertion', [browserCall({ action: 'assert', assertion: 'labels' }), behavior], 1],
]) test(`UI completion ${label}`, t => {
  const runtime = fixture(t, `import readline from 'node:readline';process.stdout.write('{"ready":true,"protocol":1}\\n');
    readline.createInterface({input:process.stdin}).on('line',line=>{const {id,command}=JSON.parse(line);process.stdout.write(JSON.stringify({id,ok:true,result:{passed:command.assertion!=='labels',url:'http://127.0.0.1:3000'}})+'\\n')});`)
  const dir = path.dirname(runtime.appPath), mock = path.join(dir, 'fetch.mjs')
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("fixture")\n')
  const actions = [{ name: 'read_file', arguments: { path: 'app.js' } }, 'Finished.', check, ...tail, 'Finished.', 'Finished.']
  fs.writeFileSync(mock, `const actions=${JSON.stringify(actions)};let i=0;globalThis.fetch=async()=>{const action=actions[i++]||'Finished.';return new Response('event: delta\\ndata: '+JSON.stringify({text:typeof action==='string'?action:JSON.stringify(action)})+'\\n\\nevent: done\\ndata: {"ok":true}\\n\\n')};`)
  const result = spawnSync(process.execPath, ['--import', mock, fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '-p', '--no-stdin', '--yolo', 'Fix the website app.js. Do not add or modify tests.'], {
    cwd: dir, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1', NALU_DESKTOP_RUNTIME: runtime.executable, NALU_DESKTOP_APP: runtime.appPath },
  })
  assert.equal(result.status, expectedCode, result.stderr)
  if (expectedCode === 1) assert.match(result.stderr, /UI task remains incomplete/)
})
test('browser actions in print mode require permission before any worker starts', t => {
  const runtime = fixture(t, '')
  const dir = path.dirname(runtime.appPath), marker = path.join(dir, 'spawned')
  fs.writeFileSync(runtime.appPath, `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'spawned');`)
  const mock = path.join(dir, 'fetch.mjs')
  fs.writeFileSync(mock, `let n=0;globalThis.fetch=async()=>new Response('event: delta\\ndata: '+JSON.stringify({text:n++===0?JSON.stringify({name:'browser',arguments:{action:'open',url:'http://127.0.0.1:3000'}}):'Browser permission is required.'})+'\\n\\nevent: done\\ndata: {"ok":true}\\n\\n')`)
  const result = spawnSync(process.execPath, ['--import', mock, fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '-p', '--no-stdin', 'Inspect the local preview'], {
    cwd: dir, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NALU_DESKTOP_RUNTIME: runtime.executable, NALU_DESKTOP_APP: runtime.appPath },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.existsSync(marker), false)
  assert.match(result.stderr, /denied/)
})

test('browser diagnostics distinguish missing CSS from uninspectable or intentional styling', () => {
  const styling = { classedElements: 25, authorRules: 0, unreadableStylesheets: 0, inlineStyledElements: 0 }
  assert.match(browserObservationIssues({ diagnostics: { styling } }).join(' '), /no loaded author stylesheet/)
  for (const overrides of [{ authorRules: 1 }, { unreadableStylesheets: 1 }, { inlineStyledElements: 1 }, { classedElements: 0 }]) {
    assert.equal(browserObservationIssues({ diagnostics: { styling: { ...styling, ...overrides } } }).length, 0)
  }
  assert.match(browserObservationIssues({ snapshot: { blockedRequests: ['https://fonts.example.invalid/file.css'] } }).join(' '), /did not load/)
})

for (const screenshots of [true, false]) test(`automatic browser images ${screenshots ? 'reach vision even with diagnostic feedback' : 'respect an explicit user opt-out'}`, t => {
  const runtime = fixture(t, '')
  const dir = path.dirname(runtime.appPath), mock = path.join(dir, 'fetch.mjs'), calls = path.join(dir, 'browser-calls.jsonl'), requests = path.join(dir, 'requests.jsonl')
  fs.writeFileSync(runtime.appPath, `import fs from 'node:fs';import readline from 'node:readline';process.stdout.write('{"ready":true,"protocol":1}\\n');readline.createInterface({input:process.stdin}).on('line',line=>{const {id,command}=JSON.parse(line);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(command)+'\\n');const result=command.action==='screenshot'?{image:'data:image/png;base64,aW1hZ2U=',path:'/fixture/screenshot.png'}:{url:'http://127.0.0.1:3000',diagnostics:{styling:{classedElements:20,authorRules:0,unreadableStylesheets:0,inlineStyledElements:0}}};process.stdout.write(JSON.stringify({id,ok:true,result})+'\\n')});`)
  const actions = [browserCall({ action: 'open', url: 'http://127.0.0.1:3000' }), 'The page is unstyled.']
  fs.writeFileSync(mock, `import fs from 'node:fs';const actions=${JSON.stringify(actions)};let i=0;globalThis.fetch=async(_url,options)=>{fs.appendFileSync(${JSON.stringify(requests)},options.body+'\\n');const action=actions[i++]||'The page is unstyled.';return new Response('event: delta\\ndata: '+JSON.stringify({text:typeof action==='string'?action:JSON.stringify(action)})+'\\n\\nevent: done\\ndata: {"ok":true}\\n\\n')};`)
  const result = spawnSync(process.execPath, ['--import', mock, fileURLToPath(new URL('./nalu.mjs', import.meta.url)), '-p', '--no-stdin', '--yolo', 'Inspect the website.' + (screenshots ? '' : ' Do not take screenshots.')], {
    cwd: dir, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, NALU_BROWSER_SCREENSHOTS: '1', NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NO_COLOR: '1', NALU_DESKTOP_RUNTIME: runtime.executable, NALU_DESKTOP_APP: runtime.appPath },
  })
  assert.equal(result.status, 0, result.stderr)
  const records = fs.readFileSync(requests, 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(records.length, 2)
  assert.equal(records[1].specialist, screenshots ? 'vision' : undefined)
  assert.match(records[1].messages.at(-1).content, /no loaded author stylesheet/)
  assert.equal(records[1].messages.some(message => Array.isArray(message.content)), screenshots)
  const browserCalls = fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(browserCalls.some(call => call.action === 'screenshot'), screenshots)
})
