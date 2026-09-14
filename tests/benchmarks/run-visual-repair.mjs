// Live backend acceptance. The model gets a broken, running local UI;
// this harness owns the server and independently checks the resulting behavior.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { loadConfig, createBrowserSession } from '../../cli/nalu.mjs'
import { browserFingerprint } from './run-model-fullstack.mjs'
import { inspectVisualContract } from './visual-contract.mjs'
const require = createRequire(import.meta.url), root = path.resolve(import.meta.dirname, '../..')
const run = fs.mkdtempSync(path.join(root, 'review-build/visual-repair-')), workspace = path.join(run, 'workspace')
fs.mkdirSync(workspace)
const hash = value => createHash('sha256').update(value).digest('hex')
const config = loadConfig(), api = process.env.NALU_VISUAL_API || 'https://n4lu.com'
const apiUrl = new URL(api)
assert.equal(apiUrl.origin, api, 'Use an API origin without a path, credentials or query')
assert.ok(apiUrl.protocol === 'https:' && (['n4lu.com', 'n4lu.ai'].includes(apiUrl.hostname)
  || /^nalu-[a-z0-9]+-mberry-hillpointecs-projects\.vercel\.app$/.test(apiUrl.hostname)), 'Live evaluation only sends account authorization to Nalu production or its own Vercel previews')
const modelFlags = []
if (process.env.NALU_VISUAL_REASONING) modelFlags.push('--reasoning', process.env.NALU_VISUAL_REASONING)
if (process.env.NALU_VISUAL_MAX_TOKENS) modelFlags.push('--max-tokens', process.env.NALU_VISUAL_MAX_TOKENS)
const runtime = process.env.NALU_VISUAL_RUNTIME ? { executable: path.resolve(process.env.NALU_VISUAL_RUNTIME), appPath: '' } : { executable: require('electron'), appPath: root }
const browserBinding = browserFingerprint(runtime), marker = 'Harbor ' + randomBytes(3).toString('hex')
const initial = {
  'package.json': JSON.stringify({ name: 'harbor-links', private: true, scripts: { check: 'node --check app.js' } }),
  'index.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${marker}</title><link rel="stylesheet" href="/missing.css"></head><body><main><aside><strong>${marker}</strong><nav><a href="#links">Saved links</a></nav><p>Your small reading shelf.</p></aside><section id="links"><header><p class="eyebrow">PERSONAL LIBRARY</p><h1>Keep something worth reading.</h1><p>Save a link for later.</p></header><form><label for="title">Title</label><input id="title" required maxlength="80"><label for="url">URL</label><input id="url" type="url" required><button type="submit">Save link</button></form><h2>Reading list</h2><p id="empty">Your shelf is empty.</p><ul id="items"></ul></section></main><script src="/app.js"></script></body></html>`,
  'styles.css': `*{box-sizing:border-box}body{margin:0;background:#f4f1eb;color:#173d3b;font-family:system-ui,sans-serif}main{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:100vh}aside{padding:40px 24px;background:#163d3a;color:#fff}aside strong{font-size:24px}nav{margin-top:60px}nav a{color:#bcdfd7}aside p{font-size:13px;margin-top:80px;line-height:1.6}section{padding:60px;max-width:980px;width:100%}.eyebrow{font-size:12px;letter-spacing:.18em;color:#647c76}h1{font-size:40px;line-height:1.15;max-width:620px;margin:16px 0}header{margin-bottom:36px}header>p:last-child{color:#667973}form{display:grid;gap:10px;background:white;border:1px solid #d7ded7;border-radius:16px;padding:24px;box-shadow:0 8px 20px #163d3a08}label{font-size:13px;font-weight:650}input{font:inherit;padding:12px;border:1px solid #b7c6bd;border-radius:8px;width:100%;min-width:0}button{font:inherit;border:0;border-radius:8px;background:#1b6659;color:#fff;padding:12px 18px;cursor:pointer}form button{justify-self:start;margin-top:8px}h2{font-size:18px;margin-top:32px}ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}li{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px;background:white;border-radius:12px;border:1px solid #d7ded7}li a{overflow-wrap:anywhere;min-width:0;color:#195d53}li button{background:#e8efea;color:#235048;font-size:12px}@media(max-width:650px){main{display:block}aside{display:none}section{padding:28px 20px}h1{font-size:31px}form{padding:20px}li{align-items:flex-start}}`,
  'app.js': `let items=JSON.parse(localStorage.getItem('links')||'[]');const list=document.querySelector('#items');function render(){list.replaceChildren();document.querySelector('#empty').hidden=items.length>0;items.forEach((item,index)=>{const li=document.createElement('li');const a=document.createElement('a');a.textContent=item.title;a.href=item.url;const button=document.createElement('button');button.textContent='Remove';button.setAttribute('aria-label','Remove '+item.title);button.onclick=()=>{items.splice(index,1);localStorage.setItem('links',JSON.stringify(items));render()};li.append(a,button);list.append(li)})}document.querySelector('form').onsubmit=event=>{event.preventDefault();const title=document.querySelector('#title'),url=document.querySelector('#url');items.push({title:title.value.trim(),url:url.value});localStorage.setItem('links',JSON.stringify(items));event.target.reset();render()};render();`,
}
for (const [name, contents] of Object.entries(initial)) fs.writeFileSync(path.join(workspace, name), contents)
const requests = [], active = new Set(), capability = '/' + randomBytes(24).toString('hex')
const server = http.createServer(async (req, res) => {
  if (req.url === capability + '/api/chat' && req.method === 'POST') {
    const abort = new AbortController(); active.add(abort)
    const timer = setTimeout(() => abort.abort(), 240000)
    res.on('close', () => { if (!res.writableEnded) abort.abort() })
    try {
      let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 4000000) throw Error('Request too large') }
      const body = JSON.parse(data)
      const receipt = { at: new Date().toISOString(), specialist: body.specialist, reasoning: body.reasoning, maxTokens: body.maxTokens, webSearch: body.webSearch, toolChoice: body.tool_choice || 'auto', imageCount: body.messages.flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'image_url').length, toolNames: body.tools.map(tool => tool.function.name), bodySha256: hash(data) }
      requests.push(receipt)
      const upstream = await fetch(api + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) }, body: data, signal: abort.signal })
      receipt.httpStatus = upstream.status
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'text/event-stream' })
      let output = ''
      for await (const bytes of upstream.body || []) { output += Buffer.from(bytes).toString('utf8'); res.write(Buffer.from(bytes)) }
      fs.writeFileSync(path.join(run, `response-${requests.length}.sse`), output)
      receipt.nativeToolEvents = (output.match(/event: tool_call_delta/g) || []).length
      receipt.routeEvents = output.split('\n').filter((line, i, lines) => line.startsWith('data:') && lines[i - 1] === 'event: route').map(line => JSON.parse(line.slice(5)))
      res.end()
    } catch (error) { if (!res.destroyed) { if (!res.headersSent) res.writeHead(502); res.end('event: error\ndata: ' + JSON.stringify({ message: error.message }) + '\n\n') } }
    finally { clearTimeout(timer); active.delete(abort) }
    return
  }
  const name = new URL(req.url, 'http://127.0.0.1').pathname.slice(1) || 'index.html'
  if (!['index.html', 'styles.css', 'app.js', 'favicon.ico'].includes(name) || !fs.existsSync(path.join(workspace, name))) { res.writeHead(404); res.end('Not found'); return }
  res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html')
  res.end(fs.readFileSync(path.join(workspace, name)))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const prompt = `Fix this website's unstyled layout using its existing local stylesheet. Preserve the saved-link form, remove action, reload persistence, wording, and green/cream design. The local app is already running at ${base}; do not start another server. Inspect it in the browser before changing files, then repair it and verify the rendered layout at 1440px and 390px, plus save/remove/reload behavior. Work only in this project, do not install dependencies, contact external services, or create/modify tests. Use npm run check. The existing stylesheet is the intended design; do not replace the app or invent a new theme. Give actual verification results and identify any remaining failures.`
fs.writeFileSync(path.join(run, 'task.txt'), prompt)
const cliSource = path.resolve(process.env.NALU_VISUAL_CLI || path.join(root, 'cli/nalu.mjs'))
const cli = fs.readFileSync(cliSource); fs.writeFileSync(path.join(run, 'nalu.mjs'), cli)
const receipt = { startedAt: new Date().toISOString(), runDir: run, api, modelFlags, authenticated: Boolean(config.token), cliSource, experimentalCli: cliSource !== path.join(root, 'cli/nalu.mjs'), cliSha256: hash(cli), browser: browserBinding, marker, promptSha256: hash(prompt), initialHashes: Object.fromEntries(Object.entries(initial).map(([name, value]) => [name, hash(value)])), requests, scope: 'Live API CLI visual repair with independent browser behavior checks. The API origin and request preferences are recorded explicitly; preview success is not production acceptance. One focused existing-app task, not fresh full-application generation.' }
fs.writeFileSync(path.join(run, 'manifest.json'), JSON.stringify(receipt, null, 2))
for (const name of ['run-visual-repair.mjs', 'visual-contract.mjs']) fs.copyFileSync(path.join(import.meta.dirname, name), path.join(run, name))
console.log('VISUAL_REPAIR: ' + run)
let browser, child, log, timer, killTimer
const cancel = signal => {
  receipt.cancelledBy = signal
  for (const abort of active) abort.abort()
  browser?.abort()
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, 'SIGTERM') } catch {}
    killTimer ||= setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 2000)
  }
}
const onTerm = () => cancel('SIGTERM'), onInt = () => cancel('SIGINT')
process.on('SIGTERM', onTerm); process.on('SIGINT', onInt)
try {
  browser = createBrowserSession(runtime)
  const before = await browser.call({ action: 'open', url: base })
  receipt.before = { styling: before.diagnostics.styling, blocked: before.blockedRequests }
  const capture = await browser.call({ action: 'screenshot' }); fs.copyFileSync(capture.path, path.join(run, 'before.jpg'))
  await browser.close(); browser = null
  if (receipt.cancelledBy) throw Error('Evaluation cancelled before CLI startup')
  const env = Object.fromEntries(['PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'SystemRoot'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]))
  Object.assign(env, { HOME: workspace, NALU_API_URL: base + capability, NALU_NO_TRAINING_DATA: '1', NALU_DESKTOP_RUNTIME: runtime.executable, NALU_DESKTOP_APP: runtime.appPath, NO_COLOR: '1' })
  log = fs.openSync(path.join(run, 'cli.log'), 'w')
  child = spawn(process.execPath, [path.join(run, 'nalu.mjs'), '-p', '--no-stdin', '--yolo', '--max-steps', '60', ...modelFlags, prompt], { cwd: workspace, env, detached: true, stdio: ['ignore', log, log] })
  timer = setTimeout(() => { receipt.timedOut = true; cancel('timeout') }, 600000)
  receipt.execution = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => resolve({ code, signal })) })
  clearTimeout(timer)
  if (receipt.cancelledBy) throw Error('Evaluation cancelled; independent qualification was not started')
  browser = createBrowserSession(runtime)
  const outcomes = []
  const verify = async (name, command) => { const result = await browser.call(command); outcomes.push({ name, passed: result.passed === true, actual: result.actual }); return result }
  let observed = await browser.call({ action: 'open', url: base })
  outcomes.push({ name: 'original stylesheet loaded', passed: observed.diagnostics.styling.authorRules >= 20 && observed.diagnostics.styling.classedElements >= 1, actual: observed.diagnostics.styling })
  for (const width of [1440, 390]) {
    observed = await browser.call({ action: 'resize', width, height: 900 })
    await verify(`no overflow at ${width}`, { action: 'assert', assertion: 'no_overflow' })
    await verify(`sidebar layout at ${width}`, { action: 'assert', assertion: 'count', selector: 'aside', count: width === 1440 ? 1 : 0 })
    const capture = await browser.call({ action: 'screenshot' }); fs.copyFileSync(capture.path, path.join(run, `after-${width}.jpg`))
  }
  await browser.call({ action: 'fill', selector: '#title', value: 'Independent reading check' })
  await browser.call({ action: 'fill', selector: '#url', value: 'https://example.invalid/read-later' })
  await browser.call({ action: 'click', selector: 'form button' })
  await verify('saved item', { action: 'assert', assertion: 'text', selector: '#items', expected: 'Independent reading check' })
  await browser.call({ action: 'reload' })
  await verify('reload persistence', { action: 'assert', assertion: 'text', selector: '#items', expected: 'Independent reading check' })
  await browser.call({ action: 'click', selector: '#items button' })
  await verify('remove item', { action: 'assert', assertion: 'count', selector: '#items li', count: 0 })
  await verify('control labels', { action: 'assert', assertion: 'labels' })
  outcomes.push(...inspectVisualContract(workspace, receipt.initialHashes))
  receipt.outcomes = outcomes
  receipt.browserSourceConsistent = JSON.stringify(browserFingerprint(runtime)) === JSON.stringify(browserBinding)
  receipt.passed = receipt.execution.code === 0 && !receipt.timedOut && !receipt.cancelledBy && receipt.browserSourceConsistent && outcomes.every(outcome => outcome.passed) && requests.some(request => request.specialist === 'vision' && request.imageCount === 1)
} catch (error) { receipt.error = error.message; receipt.passed = false }
finally {
  clearTimeout(timer)
  clearTimeout(killTimer)
  await browser?.close()
  if (child && child.exitCode === null) { try { process.kill(-child.pid, 'SIGTERM') } catch {} }
  if (log !== undefined) fs.closeSync(log)
  for (const abort of active) abort.abort()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  receipt.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(receipt, null, 2) + '\n')
  process.off('SIGTERM', onTerm); process.off('SIGINT', onInt)
}
console.log(JSON.stringify({ runDir: run, passed: receipt.passed, execution: receipt.execution, requestCount: requests.length, imageRequests: requests.filter(request => request.imageCount).length, error: receipt.error }))
process.exitCode = receipt.passed ? 0 : 1
