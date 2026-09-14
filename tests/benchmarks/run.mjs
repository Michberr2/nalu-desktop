import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn,spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {cases as developmentCases} from './cases.mjs'
import {cases as holdoutCases} from './holdout.mjs'
import {cases as secondHoldoutCases} from './holdout-2.mjs'
const args=process.argv.slice(2)
const suite=args.includes('--suite')?args[args.indexOf('--suite')+1]:'development'
if(!['development','holdout-1','holdout-2'].includes(suite))throw new Error('Unknown suite')
const cases=suite==='holdout-2'?secondHoldoutCases:suite==='holdout-1'?holdoutCases:developmentCases
const selected=args.includes('--case') ? args[args.indexOf('--case')+1] : null
if(selected&&!cases.some(c=>c.id===selected))throw new Error('Unknown benchmark case')
const live=args.includes('--live')
const tool=args.includes('--tool')?args[args.indexOf('--tool')+1]:'nalu'
if(!['nalu','codex','claude'].includes(tool))throw new Error('Unknown tool')
const binary=tool==='claude'?path.join(os.homedir(),'.local/bin/claude'):tool==='codex'?'codex':process.execPath
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const sourceCli=path.join(root,'cli/nalu.mjs')
const output=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-quality-'))
const cli=path.join(output,'candidate','nalu.mjs')
fs.mkdirSync(path.dirname(cli));fs.copyFileSync(sourceCli,cli)
const hash=value=>createHash('sha256').update(value).digest('hex')
const check=(cwd,file)=>{const result=spawnSync(process.execPath,[file],{cwd,encoding:'utf8',timeout:15000});return {code:result.status,output:(result.stdout||'')+(result.stderr||''),error:result.error?.message}}
async function run(cwd,prompt){
  const started=Date.now(),log=fs.openSync(path.join(cwd,'..','cli.log'),'w')
  return await new Promise(resolve=>{
    let timedOut=false,killTimer
    const argv=tool==='nalu'?[cli,'--print','--no-stdin','--yolo',prompt]:tool==='codex'?['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','workspace-write','--color','never',prompt]:['--print','--verbose','--output-format','stream-json','--no-session-persistence','--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--permission-mode','acceptEdits','--allowedTools','Read,Edit,Write,Bash,Glob,Grep','--tools','Read,Edit,Write,Bash,Glob,Grep','--',prompt]
    const child=spawn(binary,argv,{cwd,detached:process.platform!=='win32',stdio:['ignore',log,log],env:{...process.env,NALU_NO_TRAINING_DATA:'1',NALU_REMOTE_TASK:'',NO_COLOR:'1'}})
    const stop=signal=>{try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal)}catch{}}
    const timer=setTimeout(()=>{timedOut=true;stop('SIGTERM');killTimer=setTimeout(()=>stop('SIGKILL'),2000)},300000)
    child.on('error',error=>{clearTimeout(timer);fs.closeSync(log);resolve({code:null,error:error.message,elapsedMs:Date.now()-started,timedOut})})
    child.on('exit',(code,signal)=>{clearTimeout(timer);clearTimeout(killTimer);fs.closeSync(log);resolve({code,signal,elapsedMs:Date.now()-started,timedOut})})
  })
}
const toolVersion=tool==='nalu'?fs.readFileSync(cli,'utf8').match(/const VERSION = '([^']+)'/)[1]:spawnSync(binary,['--version'],{encoding:'utf8',timeout:10000}).stdout?.trim()
if(tool==='claude'&&!toolVersion?.includes('Claude Code'))throw new Error('Expected the actual Claude Code binary, not a wrapper')
const report={suite,tool,version:toolVersion,cliSha256:tool==='nalu'?hash(fs.readFileSync(cli)):null,routing:tool==='nalu'?'auto':'installed default; inspect transcript header',runtime:process.version,startedAt:new Date().toISOString(),live,output,cases:[]}
console.log('BENCHMARK_OUTPUT: '+output)
for(const fixture of cases.filter(c=>!selected||c.id===selected)){
  const caseDir=path.join(output,fixture.id),workspace=path.join(caseDir,'workspace')
  fs.mkdirSync(workspace,{recursive:true})
  for(const [name,content] of Object.entries({...fixture.files,'public.test.mjs':fixture.publicTest}))fs.writeFileSync(path.join(workspace,name),content)
  const prompt=fixture.task+' Work only in this temporary project. Do not change public.test.mjs. Do not install dependencies, use web tools, or invoke other coding agents. Inspect the files, make the changes, and verify them before reporting completion.'
  fs.writeFileSync(path.join(caseDir,'task.txt'),prompt)
  const baseline=check(workspace,'public.test.mjs')
  if(baseline.code===0)throw new Error(fixture.id+' does not fail before implementation')
  console.log('CASE_STARTED: '+fixture.id)
  const execution=live?await run(workspace,prompt):null
  const publicUnchanged=fs.existsSync(path.join(workspace,'public.test.mjs'))&&fs.readFileSync(path.join(workspace,'public.test.mjs'),'utf8')===fixture.publicTest
  fs.writeFileSync(path.join(workspace,'acceptance.test.mjs'),fixture.acceptanceTest)
  const publicResult=check(workspace,'public.test.mjs'),acceptanceResult=check(workspace,'acceptance.test.mjs')
  const result={id:fixture.id,caseSha256:hash(JSON.stringify(fixture)),baseline,execution,publicUnchanged,publicResult,acceptanceResult,passed:!!execution&&execution.code===0&&publicUnchanged&&publicResult.code===0&&acceptanceResult.code===0}
  report.cases.push(result)
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n')
  console.log('CASE_RESULT: '+JSON.stringify({id:result.id,passed:result.passed,elapsedMs:execution?.elapsedMs,exit:execution?.code,publicUnchanged,public:publicResult.code,acceptance:acceptanceResult.code}))
}
console.log('BENCHMARK_REPORT: '+path.join(output,'report.json'))
if(live&&report.cases.some(result=>!result.passed))process.exitCode=1
