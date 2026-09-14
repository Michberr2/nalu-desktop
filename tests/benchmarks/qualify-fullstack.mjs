// Independent artifact qualification. Never infer a model identity from a label.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
const runDir=path.resolve(process.argv[2]||'')
if(!process.argv[2])throw Error('Usage: node qualify-fullstack.mjs run-directory')
const root=path.resolve(import.meta.dirname,'../..'), report=JSON.parse(fs.readFileSync(path.join(runDir,'report.json'),'utf8'))
const evidence=fs.mkdtempSync(path.join(runDir,'qualification-')), workspace=path.join(evidence,'workspace')
const sha=value=>createHash('sha256').update(value).digest('hex')
const evaluatorDir=path.join(evidence,'evaluators');fs.mkdirSync(evaluatorDir)
const evaluatorHashes={}
for(const name of ['qualify-fullstack.mjs','grade-fullstack.mjs','fullstack-browser-grade.cjs']){
 const bytes=fs.readFileSync(new URL(name,import.meta.url));evaluatorHashes[name]=sha(bytes);fs.writeFileSync(path.join(evaluatorDir,name),bytes)
}
const expectedTask=fs.readFileSync(new URL('./fullstack-task.txt',import.meta.url),'utf8')
const source=path.join(runDir,'workspace'), hashes={}
function copy(dir,rel=''){
 fs.mkdirSync(path.join(workspace,rel),{recursive:true})
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  if(['node_modules','dist','.git','.data'].includes(entry.name))continue
  const name=path.join(rel,entry.name),from=path.join(dir,entry.name)
  if(entry.isSymbolicLink())throw Error('Unsupported candidate symlink: '+name)
  if(entry.isDirectory())copy(from,name)
  else if(entry.isFile()){const bytes=fs.readFileSync(from);hashes[name]=sha(bytes);fs.writeFileSync(path.join(workspace,name),bytes)}
 }
}
copy(source);fs.symlinkSync(path.join(root,'node_modules'),path.join(workspace,'node_modules'),'dir')
function command(binary,args,cwd,log,env={},timeout=120000){
 return new Promise(resolve=>{
  const fd=fs.openSync(log,'w'),child=spawn(binary,args,{cwd,env:{...process.env,NODE_OPTIONS:'',...env},detached:true,stdio:['ignore',fd,fd]})
  let timedOut=false,killTimer
  const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGTERM')}catch{};killTimer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}},1000)},timeout)
  let finished=false
  const done=value=>{if(finished)return;finished=true;clearTimeout(timer);clearTimeout(killTimer);fs.closeSync(fd);resolve({...value,timedOut})}
  child.on('error',error=>done({error:error.message}));child.on('exit',(code,signal)=>done({code,signal}))
 })
}
const checks=[]
const record=(name,passed,details)=>{checks.push({name,passed,details});console.log(JSON.stringify(checks.at(-1)))}
record('original task and terminal run receipt',report.task==='fullstack-dashboard'&&report.taskSha256===sha(expectedTask)&&report.execution?.code===0&&report.execution?.timedOut===false&&sha(fs.readFileSync(path.join(runDir,'task.txt')))===sha(expectedTask),report.execution)
const build=await command('npm',['run','build'],workspace,path.join(evidence,'build.log'))
record('fresh production build',build.code===0&&!build.timedOut,build)
const api=await command(process.execPath,[path.join(evaluatorDir,'grade-fullstack.mjs'),workspace],root,path.join(evidence,'api.log'))
const apiPath=path.join(evidence,'api-grade.json')
record('independent API behavior',api.code===0&&!api.timedOut&&fs.existsSync(apiPath)&&JSON.parse(fs.readFileSync(apiPath)).passed,api)
let server
try{
 if(build.code===0){
  const reserve=net.createServer();await new Promise((resolve,reject)=>{reserve.once('error',reject);reserve.listen(0,'127.0.0.1',resolve)})
  const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve))
  const fd=fs.openSync(path.join(evidence,'browser-server.log'),'w')
  server=spawn(process.execPath,['server.mjs'],{cwd:workspace,env:{...process.env,NODE_OPTIONS:'',PORT:String(port),DATA_FILE:path.join(evidence,'browser-data/tasks.json')},stdio:['ignore',fd,fd]});fs.closeSync(fd)
  let serverError
  server.on('error',error=>{serverError=error.message})
  let ready=false
  for(let i=0;i<100;i++){
   if(serverError||server.exitCode!==null)break
   try{if((await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(300)})).ok){ready=true;break}}catch{}
   await new Promise(resolve=>setTimeout(resolve,50))
  }
  if(!ready)record('browser interaction contract',false,'server did not start')
  else{
   const browser=await command(path.join(root,'node_modules/.bin/electron'),[path.join(evaluatorDir,'fullstack-browser-grade.cjs'),`http://127.0.0.1:${port}`,evidence],root,path.join(evidence,'browser.log'),{},60000)
   record('browser interaction contract',browser.code===0&&!browser.timedOut&&fs.existsSync(path.join(evidence,'browser-grade.json'))&&JSON.parse(fs.readFileSync(path.join(evidence,'browser-grade.json'))).passed,browser)
  }
 }else record('browser interaction contract',false,'build failed')
}finally{
 if(server&&server.pid&&server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),1000);timer.unref()})
}
const result={runDir,evidence,evaluatorHashes,taskSha256:sha(expectedTask),sourceHashes:hashes,sourceTreeSha256:sha(JSON.stringify(Object.entries(hashes).sort())),checks,passed:checks.length===4&&checks.every(c=>c.passed),scope:'Full-stack build, specified API groups and browser CRUD checks. Not proof of all website categories, security, every accessibility requirement or model provenance.'}
fs.writeFileSync(path.join(evidence,'qualification.json'),JSON.stringify(result,null,2)+'\n')
console.log('QUALIFICATION: '+evidence);process.exitCode=result.passed?0:1
