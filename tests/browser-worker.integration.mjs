import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createBrowserSession } from '../cli/nalu.mjs'
const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const packagedRuntime = process.env.NALU_BROWSER_TEST_RUNTIME ? path.resolve(process.env.NALU_BROWSER_TEST_RUNTIME) : undefined
const runtime = { executable: packagedRuntime || require('electron'), appPath: packagedRuntime ? '' : root }
const cliPath = packagedRuntime ? path.resolve(path.dirname(packagedRuntime), '../Resources/cli/nalu.mjs') : path.join(root, 'cli/nalu.mjs')
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
const stop = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) })

test('real Chromium exercises React controls, persistence, assertions, screenshots, isolation and cancellation', { timeout: 60000 }, async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-browser-home-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  let foreignHits = 0, appHits = 0
  const foreign = http.createServer((_req, res) => { foreignHits++; res.end('foreign') })
  const foreignOrigin = await listen(foreign)
  t.after(() => stop(foreign))
  const html = `<!doctype html><html><head><title>Browser acceptance</title><style>body{margin:24px;font-family:system-ui}input,select,button{margin:4px;padding:8px}label{display:block}</style></head><body><div id="root"></div>
    <script src="/react.js"></script><script src="/react-dom.js"></script><script>
    const h=React.createElement;
    function App(){
      const [title,setTitle]=React.useState(''),[items,setItems]=React.useState(JSON.parse(localStorage.getItem('items')||'[]')),[filter,setFilter]=React.useState('all'),[trusted,setTrusted]=React.useState('none'),[asyncText,setAsyncText]=React.useState('waiting');
      const add=event=>{event.preventDefault();setTrusted(String(event.nativeEvent.isTrusted));if(!title.trim())return;const next=[...items,title];setItems(next);localStorage.setItem('items',JSON.stringify(next));setTitle('')};
      return h('main',null,h('h1',null,'Browser acceptance'),h('p',{id:'boundaries'},'require='+typeof window.require+' bridge='+typeof window.nalu),
        h('form',{onSubmit:add},h('label',{htmlFor:'title'},'Title'),h('input',{id:'title',value:title,onChange:e=>setTitle(e.target.value)}),h('button',{id:'add',type:'submit'},'Add item')),
        h('select',{id:'filter',value:filter,onChange:e=>setFilter(e.target.value),...(location.search.includes('labels=1')?{'aria-label':'Filter'}:{})},h('option',{value:'all'},'All'),h('option',{value:'none'},'None')),
        h('div',{id:'items'},...(filter==='none'?[]:items).map((item,i)=>h('p',{key:i,className:'item'},item))),h('p',{id:'trusted'},trusted),
        h('button',{id:'async',onClick:()=>setTimeout(()=>setAsyncText('loaded'),250)},'Load'),h('p',{id:'async-result'},asyncText),
        h('button',{id:'fail',onClick:()=>{throw Error('intentional fixture error')}},'Throw'),
        h('button',{id:'console-error',onClick:()=>console.error('fixture console error')},'Log error'),
        h('button',{id:'console-warning',onClick:()=>console.warn('fixture console warning')},'Log warning'),
        h('button',{id:'remote',onClick:()=>{fetch(${JSON.stringify(foreignOrigin)}).catch(()=>{});window.open('https://example.invalid/');}},'External'),
        h('button',{id:'overflow',onClick:()=>{document.querySelector('main').style.width='2200px'}},'Overflow'),
        h('button',{id:'disabled',disabled:true},'Disabled'),h('button',{className:'duplicate'},'One'),h('button',{className:'duplicate'},'Two'),
        h('button',{id:'poison',onClick:()=>{document.querySelectorAll=()=>[]}},'Poison page method'))
    }ReactDOM.createRoot(document.getElementById('root')).render(h(App));</script></body></html>`
  const server = http.createServer((req, res) => {
    appHits++
    if (req.url === '/react.js' || req.url === '/react-dom.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(fs.readFileSync(path.join(root, 'node_modules', req.url === '/react.js' ? 'react/umd/react.development.js' : 'react-dom/umd/react-dom.development.js'))); return
    }
    if (req.url === '/redirect') { res.writeHead(302, { Location: foreignOrigin }); res.end(); return }
    if (req.url === '/load-error') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><script>console.error("fixture load error")</script>'); return }
    res.setHeader('Content-Type', 'text/html'); res.end(html)
  })
  const url = await listen(server)
  t.after(() => stop(server))
  const browser = createBrowserSession(runtime, { env: { ...process.env, HOME: home } })
  t.after(() => browser.close())
  const ready = await browser.ready
  console.log('BROWSER_EVIDENCE: ' + ready.evidenceDirectory)
  console.log('BROWSER_RUNTIME: ' + JSON.stringify({ electron: ready.electron, chromium: ready.chromium, node: ready.node }))
  if (process.env.NALU_EXPECT_ELECTRON) assert.equal(ready.electron, process.env.NALU_EXPECT_ELECTRON)
  assert.match(ready.chromium, /^\d+\./)
  for (const forbidden of ['file:///etc/passwd', 'https://example.com', 'http://localhost.example.com', 'http://user:password@127.0.0.1', 'javascript:alert(1)']) {
    await assert.rejects(browser.call({ action: 'open', url: forbidden }), /loopback/)
  }
  let snapshot = await browser.call({ action: 'open', url })
  assert.match(snapshot.text, /require=undefined bridge=undefined/)
  assert.deepEqual(snapshot.diagnostics.missingLabels, ['#filter'])
  assert.ok(snapshot.diagnostics.styling.authorRules > 0, 'loaded stylesheet rules are observable')
  assert.equal((await browser.call({ action: 'assert', assertion: 'labels', timeout_ms: 0 })).passed, false)
  assert.equal((await browser.call({ action: 'assert', assertion: 'text', selector: 'h1', expected: 'Never rendered', timeout_ms: 0 })).passed, false)
  await assert.rejects(browser.call({ action: 'click', selector: '.duplicate' }), /found 2/)
  await assert.rejects(browser.call({ action: 'assert', assertion: 'text', selector: '.duplicate', expected: 'One' }), /Ambiguous text assertion/)
  await assert.rejects(browser.call({ action: 'click', selector: '#disabled' }), /disabled/)
  await browser.call({ action: 'fill', selector: '#title', value: 'First task' })
  await browser.call({ action: 'click', selector: '#add' })
  assert.equal((await browser.call({ action: 'assert', assertion: 'text', selector: '#items', expected: 'First task' })).passed, true)
  assert.equal((await browser.call({ action: 'assert', assertion: 'text', selector: '#trusted', expected: 'true' })).passed, true)
  await browser.call({ action: 'fill', selector: '#title', value: 'clear me' })
  await browser.call({ action: 'fill', selector: '#title', value: '' })
  assert.equal((await browser.call({ action: 'assert', assertion: 'value', selector: '#title', expected: '' })).passed, true)
  await browser.call({ action: 'fill', selector: '#title', value: 'Keyboard task' })
  await browser.call({ action: 'press', key: 'Enter' })
  assert.equal((await browser.call({ action: 'assert', assertion: 'count', selector: '.item', count: 2 })).passed, true)
  await browser.call({ action: 'select', selector: '#filter', value: 'none' })
  assert.equal((await browser.call({ action: 'assert', assertion: 'count', selector: '.item', count: 0 })).passed, true)
  await browser.call({ action: 'select', selector: '#filter', value: 'all' })
  await browser.call({ action: 'reload' })
  assert.equal((await browser.call({ action: 'assert', assertion: 'count', selector: '.item', count: 2 })).passed, true)
  await browser.call({ action: 'click', selector: '#async' })
  assert.equal((await browser.call({ action: 'assert', assertion: 'text', selector: '#async-result', expected: 'loaded' })).passed, true)
  await browser.call({ action: 'open', url: url + '/?labels=1' })
  assert.equal((await browser.call({ action: 'assert', assertion: 'labels' })).passed, true)
  assert.equal((await browser.call({ action: 'assert', assertion: 'no_errors' })).passed, true)
  await browser.call({ action: 'click', selector: '#console-warning' })
  assert.equal((await browser.call({ action: 'assert', assertion: 'no_errors', timeout_ms: 0 })).passed, true, 'warnings alone are not browser errors')
  await browser.call({ action: 'click', selector: '#console-error' })
  const consoleError = await browser.call({ action: 'assert', assertion: 'no_errors', timeout_ms: 0 })
  assert.equal(consoleError.passed, false)
  assert.deepEqual(consoleError.actual.errors, ['fixture console error'])
  await browser.call({ action: 'open', url: url + '/load-error' })
  const loadError = await browser.call({ action: 'assert', assertion: 'no_errors', timeout_ms: 0 })
  assert.equal(loadError.passed, false, 'console errors during initial load must also be captured')
  assert.deepEqual(loadError.actual.errors, ['fixture load error'])
  await browser.call({ action: 'open', url: url + '/?labels=1' })
  snapshot = await browser.call({ action: 'resize', width: 390, height: 844 })
  assert.equal(snapshot.viewport.width, 390)
  assert.equal((await browser.call({ action: 'assert', assertion: 'no_overflow' })).passed, true)
  const capture = await browser.call({ action: 'screenshot' })
  assert.match(capture.image, /^data:image\/jpeg;base64,/)
  assert.ok(fs.statSync(capture.path).size > 1000)
  assert.ok(capture.width >= 390)
  console.log('BROWSER_SCREENSHOT: ' + capture.path)
  await browser.call({ action: 'click', selector: '#overflow' })
  assert.equal((await browser.call({ action: 'assert', assertion: 'no_overflow', timeout_ms: 0 })).passed, false)
  await browser.call({ action: 'reload' })
  await browser.call({ action: 'click', selector: '#remote' })
  const network = await browser.call({ action: 'assert', assertion: 'no_errors', timeout_ms: 0 })
  assert.equal(network.passed, false)
  assert.ok(network.actual.blockedRequests.some(value => value.startsWith(foreignOrigin)))
  assert.equal(foreignHits, 0)
  await assert.rejects(browser.call({ action: 'open', url: url + '/redirect' }), /ERR_BLOCKED|ERR_ABORTED|ERR_FAILED/)
  assert.equal(foreignHits, 0)
  await browser.call({ action: 'open', url })
  await browser.call({ action: 'click', selector: '#fail' })
  assert.equal((await browser.call({ action: 'assert', assertion: 'no_errors', timeout_ms: 0 })).passed, false)
  await browser.call({ action: 'reload' })
  await browser.call({ action: 'click', selector: '#poison' })
  assert.equal((await browser.call({ action: 'assert', assertion: 'count', selector: '.item', count: 2 })).passed, true)
  assert.ok(appHits > 0)
  await browser.close()
  assert.throws(() => process.kill(browser.pid, 0), { code: 'ESRCH' })
  assert.equal(fs.existsSync(path.join(home, '.nalu')), false, 'worker must not run desktop CLI installation')
  const fresh = createBrowserSession(runtime, { env: { ...process.env, HOME: home } })
  t.after(() => fresh.close())
  await fresh.call({ action: 'open', url })
  assert.equal((await fresh.call({ action: 'assert', assertion: 'count', selector: '.item', count: 0 })).passed, true, 'new session must not inherit localStorage')
  fresh.abort()
  await fresh.exited
  assert.throws(() => process.kill(fresh.pid, 0), { code: 'ESRCH' })
})

test('actual CLI repairs a local app and automatically sends browser images to vision without a screenshot call', { timeout: 45000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-cli-browser-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const script = path.join(dir, 'app.js')
  fs.writeFileSync(script, `document.querySelector('#increment').onclick = () => { document.querySelector('#result').textContent = '0' }\n`)
  const html = '<!doctype html><html><body><button id="increment">Increment</button><p id="result">0</p><script src="/app.js"></script></body></html>'
  const requests = []
  let actions = [], index = 0
  const server = http.createServer((req, res) => {
    if (req.url === '/api/chat') {
      let body = ''; req.on('data', data => { body += data }); req.on('end', () => {
        requests.push(JSON.parse(body))
        const action = actions[index++] || 'Finished.'
        res.setHeader('Content-Type', 'text/event-stream')
        res.end('event: delta\ndata: ' + JSON.stringify({ text: typeof action === 'string' ? action : JSON.stringify(action) }) + '\n\nevent: done\ndata: {"ok":true}\n\n')
      }); return
    }
    res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html')
    res.end(req.url === '/app.js' ? fs.readFileSync(script) : html)
  })
  const url = await listen(server)
  t.after(() => stop(server))
  const browser = args => ({ name: 'browser', arguments: args })
  actions = [
    { name: 'read_file', arguments: { path: 'app.js' } },
    { name: 'edit_file', arguments: { path: 'app.js', old_string: "textContent = '0'", new_string: "textContent = '1'" } },
    'Finished.',
    { name: 'bash', arguments: { command: 'node --check app.js' } },
    browser({ action: 'open', url }), browser({ action: 'click', selector: '#increment' }),
    browser({ action: 'assert', assertion: 'text', selector: '#result', expected: '1' }),
    browser({ action: 'assert', assertion: 'no_errors' }), 'Finished.',
  ]
  const child = spawn(packagedRuntime || process.execPath, [cliPath, '-p', '--no-stdin', '--yolo', 'Fix the website app.js so clicking Increment changes the displayed value to 1. Do not add or modify tests.'], {
    cwd: dir, env: { ...process.env, ...(packagedRuntime ? { ELECTRON_RUN_AS_NODE: '1' } : {}), HOME: dir, NALU_API_URL: url, NALU_REMOTE_TASK: '', NALU_NO_TRAINING_DATA: '1', NALU_DESKTOP_RUNTIME: runtime.executable, NALU_DESKTOP_APP: runtime.appPath, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM') })
  let stdout = '', stderr = ''
  child.stdout.on('data', data => { stdout += data }); child.stderr.on('data', data => { stderr += data })
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
  assert.equal(code, 0, stdout + stderr)
  assert.match(fs.readFileSync(script, 'utf8'), /textContent = '1'/)
  assert.equal(index, actions.length)
  const afterImage = requests.at(-1)
  assert.equal(afterImage.specialist, 'vision')
  const image = afterImage.messages.at(-1)
  assert.ok(image.content.some(part => part.type === 'image_url' && part.image_url.url.startsWith('data:image/jpeg;base64,')))
  assert.match(image.content.find(part => part.type === 'text').text, /Original task:\nFix the website app\.js so clicking Increment changes the displayed value to 1/)
  assert.ok(afterImage.tools.some(tool => tool.function.name === 'browser'))
  assert.ok(afterImage.messages.every(message => !message.naluInternal && !message.naluBrowserImage))
  for (const request of requests.filter(request => request.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url')))) {
    assert.equal(request.specialist, 'vision')
    assert.equal(request.messages.filter(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url')).length, 1, 'only the latest screenshot payload is retained')
  }
  assert.ok(requests.some(request => request.messages.some(message => message.role === 'tool' && message.name === 'browser' && String(message.content).includes('"passed": true'))))
  const receipt = afterImage.messages.filter(message => message.role === 'tool' && message.name === 'browser').map(message => JSON.parse(message.content))
  console.log('CLI_BROWSER_EVIDENCE: ' + receipt.find(result => result.evidenceDirectory).evidenceDirectory)
})
