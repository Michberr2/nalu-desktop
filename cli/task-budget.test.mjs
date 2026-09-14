import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawn, spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const cli = fileURLToPath(new URL('./nalu.mjs', import.meta.url))
function fixture(t, actions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-task-budget-'))
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}))
  const requests = path.join(dir, 'requests.jsonl'), mock = path.join(dir, 'fetch.mjs')
  fs.writeFileSync(path.join(dir, 'fixture.mjs'), 'export const value = 1\n')
  fs.writeFileSync(mock, `import fs from 'node:fs'; const actions=${JSON.stringify(actions)}; let index=0;
    globalThis.fetch=async(_url,options)=>{
      fs.appendFileSync(${JSON.stringify(requests)},options.body+'\\n');
      const action=actions[index++]??'Finished.';
      const text=typeof action==='string'?action:JSON.stringify(action);
      return new Response('event: delta\\ndata: '+JSON.stringify({text})+'\\n\\nevent: done\\ndata: {"ok":true}\\n\\n');
    };`)
  const env = {...process.env, NALU_REMOTE_TASK:'', NALU_NO_TRAINING_DATA:'1', NO_COLOR:'1'}
  delete env.NALU_MAX_STEPS
  return {dir, mock, requests, env}
}
const read = {name:'read_file', arguments:{path:'fixture.mjs'}}
const check = {name:'bash', arguments:{command:'node --test acceptance.test.mjs'}}
function acceptance(f, count) {
  fs.writeFileSync(path.join(f.dir, 'acceptance.test.mjs'), `import assert from 'node:assert/strict';
    for(let i=0;i<${count};i++)assert.equal((await import('./module-'+i+'.mjs')).value,i);
  `)
}
function execute(f, prompt, flags=[], env={}) {
  return spawnSync(process.execPath, ['--import',f.mock,cli,'-p','--no-stdin','--yolo',...flags,prompt], {
    cwd:f.dir, env:{...f.env,...env}, encoding:'utf8', timeout:10000,
  })
}
const records = f => fs.existsSync(f.requests) ? fs.readFileSync(f.requests,'utf8').trim().split('\n').map(JSON.parse) : []

test('a coding task can implement and independently verify more than 40 modules', t => {
  const writes = Array.from({length:45},(_,i)=>({name:'write_file',arguments:{path:`module-${i}.mjs`,content:`export const value = ${i}\n`}}))
  const f=fixture(t,[...writes,'Finished.',check,'Finished.'])
  acceptance(f,45)
  const protectedTest=fs.readFileSync(path.join(f.dir,'acceptance.test.mjs'))
  const result=execute(f,'Implement the 45 modules module-0.mjs through module-44.mjs with each exporting its numeric index as value. Run acceptance.test.mjs. Do not add or modify tests.')
  assert.equal(result.status,0,result.stderr)
  assert.equal(records(f).length,48)
  assert.deepEqual(fs.readFileSync(path.join(f.dir,'acceptance.test.mjs')),protectedTest)
  const independent=spawnSync(process.execPath,['--test','acceptance.test.mjs'],{cwd:f.dir,encoding:'utf8'})
  assert.equal(independent.status,0,independent.stdout+independent.stderr)
})

for(const source of ['flag','environment']) test(`explicit ${source} step budget stops execution and exits unsuccessfully`,t=>{
  const f=fixture(t,Array(10).fill(read))
  const result=execute(f,'Fix fixture.mjs and verify it',source==='flag'?['--max-steps','3']:[],source==='environment'?{NALU_MAX_STEPS:'3'}:{})
  assert.equal(result.status,1,result.stderr)
  assert.match(result.stderr,/3-step limit/)
  assert.equal(records(f).length,3)
})

test('command-line step budget overrides the environment',t=>{
  const f=fixture(t,Array(10).fill(read))
  const result=execute(f,'Fix fixture.mjs and verify it',['--max-steps','2'],{NALU_MAX_STEPS:'5'})
  assert.equal(result.status,1,result.stderr)
  assert.equal(records(f).length,2)
})

for(const value of ['0','-1','1.5','NaN','1001','']) test(`invalid step budget ${JSON.stringify(value)} fails before model access`,t=>{
  const f=fixture(t,[])
  const result=execute(f,'hello',[],{NALU_MAX_STEPS:value})
  assert.equal(result.status,1,result.stderr)
  assert.match(result.stderr,/NALU_MAX_STEPS/)
  assert.equal(records(f).length,0)
})

async function interactive(f, lines) {
  const child=spawn(process.execPath,['--import',f.mock,cli,'--yolo'],{cwd:f.dir,env:{...f.env,NALU_MAX_STEPS:'40'},stdio:['pipe','pipe','pipe']})
  let output='',error='',next=0
  child.stdout.on('data',chunk=>{output+=chunk;if(String(chunk).includes('❯ ')){if(next<lines.length)child.stdin.write(lines[next++]+'\n');else child.stdin.end()}})
  child.stderr.on('data',chunk=>{error+=chunk})
  const timer=setTimeout(()=>child.kill('SIGKILL'),8000)
  try {
    const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)})
    assert.equal(code,0,output+error)
    return {output,error}
  } finally {clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL')}
}

test('continuing a capped coding task retains its original contract and verification opt-outs',async t=>{
  const write={name:'write_file',arguments:{path:'module-0.mjs',content:'export const value = 0\n'}}
  const f=fixture(t,[...Array(40).fill(read),write,'Finished.',check,'Finished.'])
  acceptance(f,1)
  const prompt='Implement module-0.mjs with value 0. Run acceptance.test.mjs. Do not add or modify tests.'
  await interactive(f,[prompt,'continue','/exit'])
  const requests=records(f)
  assert.equal(requests.length,44,'continuation must review and verify before completing')
  assert.ok(requests.slice(40).every(r=>r.specialist==='code'))
  const review=requests.flatMap(r=>r.messages).find(m=>String(m.content).startsWith('Before completing,'))
  assert.ok(review,'continuation retained requirements review')
  assert.match(review.content,/Use existing verification without creating or modifying tests/)
  assert.ok(review.content.includes(prompt),'review includes the original requirements')
  assert.ok(!requests.slice(40).some(r=>r.messages.at(-1)?.content?.startsWith('For this coding task, after reading')))
})

test('a new question after a capped coding task does not inherit its coding contract',async t=>{
  const f=fixture(t,[...Array(40).fill(read),'A closure captures lexical scope.'])
  await interactive(f,['Fix fixture.mjs and verify it','Explain a JavaScript closure.','/exit'])
  const requests=records(f)
  assert.equal(requests.length,41)
  assert.equal(requests.at(-1).specialist,undefined)
})
