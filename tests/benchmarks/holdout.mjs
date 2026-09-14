const header="import assert from 'node:assert/strict';\n"
const python=source=>header+`import {spawnSync} from 'node:child_process';const r=spawnSync('python3',['-c',${JSON.stringify(source)}],{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stdout+r.stderr);console.log(r.stdout);\n`
export const cases=[
  {
    id:'python-ttl-cache',
    task:'Fix TTLCache in cache.py. Constructor TTLCache(ttl, clock) uses an injected clock returning seconds; negative ttl raises ValueError. set(key,value) records expiry at clock()+ttl, replacing existing values and resetting expiry. get(key,default=None) returns the stored value only while clock()<expiry, otherwise default, removing expired entries. len(cache) counts only unexpired entries and purges expired entries. Zero TTL expires immediately. Cache falsy values including None without confusing them with missing keys, and keep instances independent. Preserve this API and run node public.test.mjs (it invokes Python).',
    files:{'cache.py':`class TTLCache:
    def __init__(self, ttl, clock):
        self.ttl = ttl
        self.clock = clock
        self.data = {}
    def set(self, key, value):
        self.data[key] = (value, self.clock() + self.ttl)
    def get(self, key, default=None):
        return self.data.get(key, (default, 0))[0]
    def __len__(self):
        return len(self.data)
`},
    publicTest:python(`from cache import TTLCache
now=[0]
c=TTLCache(2,lambda:now[0])
c.set('x',5)
assert c.get('x')==5
now[0]=3
assert c.get('x','missing')=='missing'
print('PUBLIC_PASS')
`),
    acceptanceTest:python(`from cache import TTLCache
now=[10]
clock=lambda:now[0]
try:
    TTLCache(-1,clock)
    raise AssertionError('negative ttl accepted')
except ValueError:
    pass
zero=TTLCache(0,clock)
zero.set('x',1)
assert zero.get('x','gone')=='gone' and len(zero)==0
c=TTLCache(5,clock)
for i,v in enumerate([0,False,'',None]): c.set(i,v)
assert len(c)==4
for i,v in enumerate([0,False,'',None]): assert c.get(i,'missing') is v
now[0]=15
assert len(c)==0
assert c.get(0,'expired')=='expired'
c.set('x','old')
now[0]=18
c.set('x','new')
now[0]=20
assert c.get('x')=='new'
other=TTLCache(5,clock)
other.set('x','other')
assert c.get('x')=='new' and other.get('x')=='other'
now[0]=23
assert c.get('x','expired')=='expired'
assert len(c)==0 and len(other)==1
print('ACCEPTANCE_PASS')
`),
  },
  {
    id:'retry-cancellation',
    task:'Implement retry(operation, options) in retry.mjs. options has attempts (positive integer, default 3), shouldRetry(error,attempt) (default true), delay(attempt) (default 0), sleep(milliseconds) (default timer Promise), and optional AbortSignal signal. Call operation with a 1-based attempt number. Return the first success; otherwise propagate the original error when attempts are exhausted or shouldRetry returns false. Before another attempt, await sleep(delay(failedAttempt)); never sleep after final failure or success. Reject invalid attempts with RangeError. Check signal before each operation and after each sleep; if aborted, throw an error named AbortError and launch no further operation. The operation may return an ordinary value or a Promise. Preserve the export and run node public.test.mjs.',
    files:{'retry.mjs':'export async function retry(operation, options={}) { return operation(1) }\n'},
    publicTest:header+`import {retry} from './retry.mjs';let calls=0;const result=await retry(async()=>{if(++calls<3)throw new Error('temporary');return 'ok'},{attempts:3,sleep:async()=>{}});assert.equal(result,'ok');assert.equal(calls,3);console.log('PUBLIC_PASS');\n`,
    acceptanceTest:header+`import {retry} from './retry.mjs';
for(const attempts of [0,-1,1.5,NaN,Infinity])await assert.rejects(retry(()=>1,{attempts}),RangeError);
const attempts=[],sleeps=[],errors=[];const failure=new Error('original');
await assert.rejects(retry(n=>{attempts.push(n);throw failure},{attempts:3,shouldRetry:(e,n)=>{errors.push([e,n]);return true},delay:n=>n*10,sleep:async ms=>sleeps.push(ms)}),e=>e===failure);
assert.deepEqual(attempts,[1,2,3]);assert.deepEqual(sleeps,[10,20]);assert.ok(errors.every(([e])=>e===failure));assert.deepEqual(errors.slice(0,2).map(([,n])=>n),[1,2]);
let calls=0;await assert.rejects(retry(()=>{calls++;throw failure},{shouldRetry:()=>false,sleep:async()=>{throw new Error('unexpected sleep')}}),e=>e===failure);assert.equal(calls,1);
assert.equal(await retry(n=>n,{sleep:async()=>{throw new Error('unexpected sleep')}}),1);
const before=new AbortController();before.abort();calls=0;await assert.rejects(retry(()=>{calls++;return 1},{signal:before.signal}),{name:'AbortError'});assert.equal(calls,0);
const between=new AbortController();calls=0;await assert.rejects(retry(()=>{calls++;throw failure},{signal:between.signal,sleep:async()=>between.abort()}),{name:'AbortError'});assert.equal(calls,1);
console.log('ACCEPTANCE_PASS');\n`,
  },
]
