// Controlled samplers exercise real CLI execution and independent grading.
// They are never evidence that a live model produced the replayed application.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {runModelFullstack} from './run-model-fullstack.mjs'
const reply=text=>({choices:[{finish_reason:'stop',message:{content:text}}]})
let id=0
const tool=(name,args)=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:String(++id),type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]})
const noop=await runModelFullstack({model:'simulated-noop',sample:async()=>reply('The complete application is implemented and verified. Everything requested is finished.')})
assert.equal(noop.passed,false);assert.equal(noop.simulated,true)
console.log('NOOP_REJECTED: '+noop.runDir)
const baseline=path.resolve('review-build/website-ukBV2D/workspace'),files=[]
function scan(dir,rel=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
 if(['node_modules','dist','.git','.data'].includes(entry.name))continue
 const name=path.join(rel,entry.name),file=path.join(dir,entry.name)
 if(entry.isDirectory())scan(file,name)
 else if(entry.isFile())files.push({path:name,content:fs.readFileSync(file,'utf8')})
}}
scan(baseline)
let index=0,built=false
const replay=await runModelFullstack({model:'simulated-artifact-replay',sample:async payload=>{
 if(index<files.length)return tool('write_file',files[index++])
 const last=payload.messages.at(-1)
 if(!built||(last.role==='user'&&last.content.startsWith('Before completing,'))){built=true;return tool('bash',{command:'npm run build'})}
 return reply('Copied the controlled baseline fixture and ran its production build. This is a simulated evaluator control, not live model generation.')
}})
assert.equal(replay.passed,true);assert.equal(replay.simulated,true)
console.log('REPLAY_ACCEPTED_AS_SIMULATED: '+replay.runDir)
fs.writeFileSync('review-build/model-gate-audit/runner-controls.json',JSON.stringify({noop,replay},null,2)+'\n')
