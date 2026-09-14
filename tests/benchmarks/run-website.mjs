import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import os from 'node:os'
const tool = process.argv.find(arg => arg.startsWith('--tool='))?.split('=')[1] || 'nalu'
if (!['nalu', 'codex', 'claude'].includes(tool)) throw Error('Unknown tool')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const withoutContractGuidance = process.argv.includes('--without-contract-guidance')
const fullstack = process.argv.includes('--fullstack')
const requireInitialTool = process.argv.includes('--require-initial-tool')
const nativeProtocol = process.argv.includes('--native-protocol')
// Freeze the execution budget in this run's receipt rather than inheriting an
// undocumented default from whichever CLI snapshot happens to be under test.
const maxSteps = tool === 'nalu' ? Number(process.env.NALU_MAX_STEPS ?? 120) : null
if (maxSteps !== null && (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 1000)) throw Error('Invalid NALU_MAX_STEPS')
const output = fs.mkdtempSync(path.join(root, 'review-build/website-'))
const workspace = path.join(output, 'workspace')
fs.mkdirSync(workspace)
fs.symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'dir')
const initial = {
  'package.json': JSON.stringify({ name: 'northline-supply', version: '1.0.0', private: true, type: 'module', scripts: { dev: 'vite --host 127.0.0.1', build: 'vite build', preview: 'vite preview --host 127.0.0.1' }, dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', 'lucide-react': '^0.451.0' }, devDependencies: { vite: '^5.4.8' } }, null, 2),
  'index.html': '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Northline Supply</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
  'src/main.jsx': "import React from 'react'; import {createRoot} from 'react-dom/client'; createRoot(document.getElementById('root')).render(<main>Website not implemented</main>);\n",
}
for (const [name, content] of Object.entries(initial)) { fs.mkdirSync(path.dirname(path.join(workspace, name)), { recursive: true }); fs.writeFileSync(path.join(workspace, name), content) }
const seedArg = process.argv.find(arg => arg.startsWith('--seed-run='))?.slice('--seed-run='.length)
let continuation = null
if (seedArg) {
  const parentRun = path.resolve(seedArg)
  if (!parentRun.startsWith(path.join(root, 'review-build') + path.sep)) throw Error('Seed must be a benchmark run')
  const sourceHashes = {}
  function seed(dir, rel = '') {
    for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
      if (['node_modules','dist','.git','.data'].includes(entry.name)) continue
      const name = path.join(rel, entry.name), from = path.join(dir, entry.name), to = path.join(workspace, name)
      if (entry.isSymbolicLink()) throw Error('Unsupported seed symlink: ' + name)
      if (entry.isDirectory()) { fs.mkdirSync(to,{recursive:true}); seed(from,name) }
      else if (entry.isFile()) { const bytes=fs.readFileSync(from); fs.writeFileSync(to,bytes); sourceHashes[name]=createHash('sha256').update(bytes).digest('hex') }
    }
  }
  seed(path.join(parentRun,'workspace'))
  continuation = {parentRun,sourceHashes}
}
const cli = fs.readFileSync(path.join(root, 'cli/nalu.mjs'))
fs.writeFileSync(path.join(output, 'nalu.mjs'), cli)
const prompt = fs.readFileSync(new URL(fullstack ? './fullstack-task.txt' : './website-task.txt', import.meta.url), 'utf8')
fs.writeFileSync(path.join(output, 'task.txt'), prompt)
const feedbackArg = process.argv.find(arg => arg.startsWith('--feedback='))?.slice('--feedback='.length)
if (Boolean(seedArg) !== Boolean(feedbackArg)) throw Error('Seed and feedback must be supplied together')
const feedback = feedbackArg ? fs.readFileSync(path.resolve(feedbackArg),'utf8') : ''
const executionPrompt = feedback ? prompt + '\n\nThis is a continuation of your earlier build, copied into this fresh project. Preserve working behavior and complete the original requirements. Independent review feedback:\n' + feedback : prompt
fs.writeFileSync(path.join(output,'execution-prompt.txt'),executionPrompt)
const hash = value => createHash('sha256').update(value).digest('hex')
const adapterName = process.argv.includes('--preview-native') ? 'preview-native' : process.argv.includes('--preview-transport') ? 'preview-transport' : nativeProtocol ? 'native-protocol' : requireInitialTool ? 'require-initial-tool' : withoutContractGuidance ? 'without-contract-guidance' : null
const adapter = adapterName ? path.join(root, `review-build/${adapterName}.mjs`) : null
// Buffered preview transport may wait for the backend's 250s deadline and curl's 280s cap.
// Give the client 300s so it can receive that terminal diagnostic, not abort at 180s.
const bufferedPreview = ['preview-native', 'preview-transport'].includes(adapterName)
const responseIdleTimeoutMs = bufferedPreview ? 300000 : Number(process.env.NALU_RESPONSE_IDLE_TIMEOUT_MS || 180000)
const report = { continuation, executionPromptSha256: hash(executionPrompt), tool, maxSteps, task: fullstack ? 'fullstack-dashboard' : 'storefront', startedAt: new Date().toISOString(), output, workspace, cliSha256: hash(cli), taskSha256: hash(prompt), timeoutMs: 900000, initialFiles: initial, runtime: process.version, responseIdleTimeoutMs, experiment: adapter ? { name: adapterName, source: fs.readFileSync(adapter, 'utf8'), sha256: hash(fs.readFileSync(adapter)) } : null }
report.browser = process.env.NALU_BENCHMARK_BROWSER ? JSON.parse(process.env.NALU_BENCHMARK_BROWSER) : null
if (adapterName === 'preview-native' || adapterName === 'preview-transport') {
  report.previewUrl = process.env.NALU_BENCHMARK_PREVIEW_URL || 'https://nalu-7nxxvvs73-mberry-hillpointecs-projects.vercel.app'
  report.experiment.dependencies = Object.fromEntries((adapterName === 'preview-native' ? ['preview-transport', 'native-protocol'] : []).map(name => {
    const source = fs.readFileSync(path.join(root, `review-build/${name}.mjs`), 'utf8')
    return [name, {source, sha256:hash(source)}]
  }))
}
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(report, null, 2))
console.log('WEBSITE_OUTPUT: ' + output)
const log = fs.openSync(path.join(output, 'cli.log'), 'w')
const started = Date.now()
const binary = tool === 'claude' ? path.join(os.homedir(), '.local/bin/claude') : tool === 'codex' ? 'codex' : process.execPath
const argv = tool === 'nalu' ? [...(adapter ? ['--import', adapter] : []), path.join(output, 'nalu.mjs'), '--print', '--no-stdin', '--yolo', '--max-steps', String(maxSteps), executionPrompt] : tool === 'codex' ? ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--color', 'never', executionPrompt] : ['--print', '--verbose', '--output-format', 'stream-json', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write,Bash,Glob,Grep', '--tools', 'Read,Edit,Write,Bash,Glob,Grep', '--', executionPrompt]
const child = spawn(binary, argv, { cwd: workspace, detached: true, stdio: ['ignore', log, log], env: { ...process.env, NODE_OPTIONS: '', NALU_RESPONSE_IDLE_TIMEOUT_MS: String(responseIdleTimeoutMs), NALU_NO_TRAINING_DATA: '1', NALU_REMOTE_TASK: '', NO_COLOR: '1' } })
report.childPid = child.pid
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(report, null, 2))
let timedOut = false, killTimer, cancelledBy = null
const stop = signal => { try { process.kill(-child.pid, signal) } catch {} }
const terminate = () => { stop('SIGTERM'); killTimer ??= setTimeout(() => stop('SIGKILL'), 2000) }
const onTerm = () => { cancelledBy = 'SIGTERM'; terminate() }
const onInt = () => { cancelledBy = 'SIGINT'; terminate() }
process.on('SIGTERM', onTerm); process.on('SIGINT', onInt)
const timer = setTimeout(() => { timedOut = true; terminate() }, report.timeoutMs)
const result = await new Promise(resolve => {
  child.on('error', error => resolve({ error: error.message }))
  child.on('exit', (code, signal) => resolve({ code, signal }))
})
clearTimeout(timer); clearTimeout(killTimer); process.off('SIGTERM', onTerm); process.off('SIGINT', onInt); fs.closeSync(log)
Object.assign(report, { execution: { ...result, timedOut, cancelledBy, elapsedMs: Date.now() - started } })
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report.execution))
process.exitCode = result.code === 0 && !timedOut && !cancelledBy ? 0 : 1
