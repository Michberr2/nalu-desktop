export const cases=[{
  id:'dependency-build',
  task:`Implement planBuild(graph, targets) in planner.mjs and runBuild(graph, targets, execute) in runner.mjs. graph is an object whose own string keys are task names and whose values are arrays of dependency names; targets is an array of names. planBuild returns each reachable task once, dependencies before dependents, in stable depth-first order using target order and dependency-list order. Ignore unreachable entries, even if malformed. Reject reachable missing tasks, non-array dependency lists, and cycles with Error; cycle errors must mention cycle. Only own keys count as tasks, including valid own names such as constructor and __proto__. Do not mutate graph or targets. Handle dependency chains of 16,000 tasks without stack overflow. runBuild first validates the entire reachable plan before calling execute at all, then executes sequentially in planned order, awaiting synchronous or Promise results. Call execute(name, dependencyResults), where dependencyResults contains resolved values in the original dependency-list order, including duplicates. Return a Map from task name to result, retaining undefined and falsy results. Execute shared tasks only once and preserve the original rejection object if execution fails; do not run later tasks after failure. Keep both module exports and run node public.test.mjs.`,
  files:{
    'planner.mjs':"export function planBuild(graph, targets) { return [...targets] }\n",
    'runner.mjs':"import {planBuild} from './planner.mjs';\nexport async function runBuild(graph,targets,execute){const results=new Map();for(const name of planBuild(graph,targets))results.set(name,await execute(name,[]));return results}\n",
  },
  publicTest:`import assert from 'node:assert/strict';
import {planBuild} from './planner.mjs';import {runBuild} from './runner.mjs';
const graph={app:['library'],library:[]};assert.deepEqual(planBuild(graph,['app']),['library','app']);
const result=await runBuild(graph,['app'],(name,deps)=>name==='library'?2:deps[0]+1);assert.equal(result.get('app'),3);console.log('PUBLIC_PASS');
`,
  acceptanceTest:`import assert from 'node:assert/strict';
import {planBuild} from './planner.mjs';import {runBuild} from './runner.mjs';
const graph=Object.freeze({root:Object.freeze(['left','right','left']),left:Object.freeze(['shared']),right:Object.freeze(['shared']),shared:Object.freeze([]),unused:null});
const targets=Object.freeze(['root','right']);assert.deepEqual(planBuild(graph,targets),['shared','left','right','root']);
assert.deepEqual(planBuild({bad:null},[]),[]);
assert.throws(()=>planBuild({x:['missing']},['x']),Error);
assert.throws(()=>planBuild({x:null},['x']),Error);
assert.throws(()=>planBuild({x:['y'],y:['x']},['x']),/cycle/i);
assert.throws(()=>planBuild({x:['x']},['x']),/cycle/i);
assert.throws(()=>planBuild({},['constructor']),Error);
const special=Object.create(null);special.__proto__=[];special.constructor=['__proto__'];assert.deepEqual(planBuild(special,['constructor']),['__proto__','constructor']);
const deep=Object.create(null);for(let i=0;i<16000;i++)deep['n'+i]=i?['n'+(i-1)]:[];
const planned=planBuild(deep,['n15999']);assert.equal(planned.length,16000);assert.equal(planned[0],'n0');assert.equal(planned.at(-1),'n15999');
const calls=[];let running=false;const result=await runBuild(graph,targets,async(name,deps)=>{assert.equal(running,false);running=true;await Promise.resolve();calls.push([name,deps]);running=false;return name==='shared'?undefined:name==='left'?false:name==='right'?0:deps;});
assert.ok(result instanceof Map);assert.equal(result.has('shared'),true);assert.equal(result.get('shared'),undefined);assert.deepEqual([...result.keys()],['shared','left','right','root']);assert.deepEqual(result.get('root'),[false,0,false]);assert.deepEqual(calls.map(c=>c[0]),['shared','left','right','root']);assert.deepEqual(calls[1][1],[undefined]);
let executed=0;await assert.rejects(runBuild({valid:[],bad:['missing']},['valid','bad'],()=>executed++));assert.equal(executed,0);
await assert.rejects(runBuild({valid:[],bad:['bad']},['valid','bad'],()=>executed++));assert.equal(executed,0);
const failure={reason:'original'};const order=[];await assert.rejects(runBuild({a:[],b:['a'],c:['b']},['c'],name=>{order.push(name);if(name==='b')throw failure;return 5}),error=>error===failure);assert.deepEqual(order,['a','b']);
console.log('ACCEPTANCE_PASS');
`,
}]
