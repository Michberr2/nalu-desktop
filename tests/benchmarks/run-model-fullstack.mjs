import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {createModelProxy,MODEL_EVAL_SYSTEM} from './model-proxy.mjs'
const root=path.resolve(import.meta.dirname,'../..')
const sha=value=>createHash('sha256').update(value).digest('hex')
const runnerSha256=sha(fs.readFileSync(import.meta.filename)),proxySha256=sha(fs.readFileSync(new URL('./model-proxy.mjs',import.meta.url)))
export function browserFingerprint(runtime){
 if(!runtime)return null
 const executable=path.resolve(runtime.executable),appPath=runtime.appPath?path.resolve(runtime.appPath):''
 const bundle=appPath?path.join(appPath,'dist-electron'):path.resolve(path.dirname(executable),'../Resources/app.asar')
 const files={}
 if(appPath){for(const name of fs.readdirSync(bundle).filter(name=>name.endsWith('.js')).sort())files[name]=sha(fs.readFileSync(path.join(bundle,name)))}
 else files['app.asar']=sha(fs.readFileSync(bundle))
 return {executable,appPath,executableSha256:sha(fs.readFileSync(executable)),files}
}
function execute(args,env,timeoutMs){return new Promise(resolve=>{
 let stdout='',stderr='',finished=false,timedOut=false,killTimer,cancelledBy=null
 const child=spawn(process.execPath,args,{cwd:root,env,detached:true,stdio:['ignore','pipe','pipe']})
 child.stdout.on('data',d=>{stdout=(stdout+d).slice(-100000)});child.stderr.on('data',d=>{stderr=(stderr+d).slice(-100000)})
 const stop=()=>{try{process.kill(-child.pid,'SIGTERM')}catch{};killTimer??=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}},1000)}
 const onTerm=()=>{cancelledBy='SIGTERM';stop()},onInt=()=>{cancelledBy='SIGINT';stop()}
 process.on('SIGTERM',onTerm);process.on('SIGINT',onInt)
 const timer=setTimeout(()=>{timedOut=true;stop()},timeoutMs)
 const done=result=>{if(finished)return;finished=true;clearTimeout(timer);clearTimeout(killTimer);process.off('SIGTERM',onTerm);process.off('SIGINT',onInt);resolve({...result,timedOut,cancelledBy,stdout,stderr})}
 child.on('error',e=>done({error:e.message}));child.on('exit',(code,signal)=>done({code,signal}))
})}
export async function runModelFullstack({model,provider,apiKey,sample,maxTokens=4096,reasoningEffort='low',maxSteps=120,browserRuntime,seedRun,feedbackFile}){
 if(!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>1000)throw Error('Invalid model evaluation step budget')
 const browser=browserFingerprint(browserRuntime)
 const requests=[],proxy=await createModelProxy({model,provider,apiKey,sample,maxTokens,reasoningEffort,onRequest:r=>requests.push({...r,at:new Date().toISOString()})})
 const startedAt=new Date().toISOString(),cliSha256=sha(fs.readFileSync(path.join(root,'cli/nalu.mjs')))
 // Explicit child environment: never forward provider keys or deployment tokens.
 const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','SystemRoot'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]))
 if(browser)Object.assign(env,{NALU_DESKTOP_RUNTIME:browser.executable,NALU_DESKTOP_APP:browser.appPath,NALU_BENCHMARK_BROWSER:JSON.stringify(browser)})
 Object.assign(env,{NODE_OPTIONS:'',NALU_API_URL:proxy.api,NALU_NO_TRAINING_DATA:'1',NALU_MAX_STEPS:String(maxSteps),NALU_RESPONSE_IDLE_TIMEOUT_MS:'300000',NALU_RESPONSE_TIMEOUT_MS:'320000',NO_COLOR:'1'})
 let generation
 try{generation=await execute(['tests/benchmarks/run-website.mjs','--tool=nalu','--fullstack',...(seedRun?['--seed-run='+path.resolve(seedRun),'--feedback='+path.resolve(feedbackFile)]:[])],env,930000)}finally{await proxy.close()}
 const match=generation.stdout.match(/^WEBSITE_OUTPUT: (.+)$/m)
 if(!match)throw Error('Generation did not produce a run directory: '+generation.stderr.slice(-500))
 const runDir=path.resolve(match[1])
 if(!runDir.startsWith(path.join(root,'review-build')+path.sep))throw Error('Unexpected run directory')
 const runManifest=JSON.parse(fs.readFileSync(path.join(runDir,'manifest.json'),'utf8'))
 const cliSourceConsistent=runManifest.cliSha256===cliSha256&&sha(fs.readFileSync(path.join(runDir,'nalu.mjs')))===cliSha256&&runManifest.maxSteps===maxSteps
 const qualification=generation.cancelledBy?{code:null,timedOut:false,stdout:'',stderr:'Generation cancelled; qualification was not started.'}:await execute(['tests/benchmarks/qualify-fullstack.mjs',runDir],env,240000)
 const qualifiedPath=qualification.stdout.match(/^QUALIFICATION: (.+)$/m)?.[1]
 const artifact=qualifiedPath?JSON.parse(fs.readFileSync(path.join(qualifiedPath,'qualification.json'),'utf8')):null
 const result={continuation:runManifest.continuation,executionPromptSha256:runManifest.executionPromptSha256,startedAt,finishedAt:new Date().toISOString(),runDir,modelSha256:proxy.modelSha256,providerSha256:provider?sha(provider):null,systemSha256:sha(MODEL_EVAL_SYSTEM),runnerSha256,proxySha256,cliSha256,cliSourceConsistent,maxTokens,reasoningEffort,requestCount:requests.length,requests,generation:{code:generation.code,signal:generation.signal,timedOut:generation.timedOut,error:generation.error},qualification:{code:qualification.code,timedOut:qualification.timedOut,evidence:qualifiedPath,passed:artifact?.passed===true},simulated:typeof sample==='function',passed:cliSourceConsistent&&generation.code===0&&!generation.timedOut&&qualification.code===0&&!qualification.timedOut&&artifact?.passed===true,scope:'Model-bound direct-provider CLI execution with dedicated evaluation prompt. Does not test production backend routing; artifact coverage is defined by qualification.json.'}
 result.maxSteps=maxSteps
 result.generation.cancelledBy=generation.cancelledBy
 result.qualification.cancelledBy=qualification.cancelledBy||null
 result.passed=result.passed&&!generation.cancelledBy&&!qualification.cancelledBy
 result.browser=browser
 result.browserSourceConsistent=JSON.stringify(browser)===JSON.stringify(runManifest.browser)&&JSON.stringify(browser)===JSON.stringify(browserFingerprint(browserRuntime))
 result.passed=result.passed&&result.browserSourceConsistent
 fs.writeFileSync(path.join(runDir,'model-qualification.json'),JSON.stringify(result,null,2)+'\n')
 fs.writeFileSync(path.join(runDir,'qualification-run.log'),qualification.stdout+qualification.stderr)
 return result
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const result=await runModelFullstack({model:process.env.NALU_EVAL_MODEL,provider:process.env.TINKER_BASE_URL||'https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1',apiKey:process.env.TINKER_API_KEY})
 console.log(JSON.stringify(result));process.exitCode=result.passed?0:1
}
