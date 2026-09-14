const header = "import assert from 'node:assert/strict';\n"
export const cases = [
  {
    id: 'async-pool',
    task: 'Fix mapLimit in pool.mjs. It must map an array with at most limit mapper calls in flight, preserve input order in the returned results, pass (value,index) to mapper, leave inputs unchanged, and propagate mapper rejection. Empty arrays return []. Reject non-positive or non-integer limits with RangeError. Preserve the export and run node public.test.mjs.',
    files: {'pool.mjs': 'export async function mapLimit(items, limit, mapper) { return Promise.all(items.map(mapper)) }\n'},
    publicTest: header + `import {mapLimit} from './pool.mjs';
let active=0,peak=0;
const result=await mapLimit([4,3,2,1],2,async value=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,value*5));active--;return value*2});
assert.deepEqual(result,[8,6,4,2]);assert.ok(peak<=2,'concurrency exceeded');
console.log('PUBLIC_PASS');\n`,
    acceptanceTest: header + `import {mapLimit} from './pool.mjs';
for(const limit of [0,-1,1.5,NaN,Infinity]) await assert.rejects(mapLimit([1],limit,async x=>x),RangeError);
assert.deepEqual(await mapLimit([],2,async x=>x),[]);
assert.deepEqual(await mapLimit([7],2,async x=>x*2),[14]);
assert.deepEqual(await mapLimit([1,2],2,x=>x+1),[2,3]);
const input=Object.freeze([3,1,2]);let active=0,peak=0;
assert.deepEqual(await mapLimit(input,1,async (x,i)=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,3));active--;return x+i}),[3,2,4]);assert.equal(peak,1);
const failure=new Error('mapper failure');await assert.rejects(mapLimit([1,2],2,async x=>{if(x===2)throw failure;return x}),e=>e===failure);
assert.deepEqual(input,[3,1,2]);console.log('ACCEPTANCE_PASS');\n`,
  },
  {
    id: 'nested-config',
    task: 'Implement mergeConfig(base, overrides) in config.mjs for JSON-like configuration. Recursively merge plain objects, replace arrays and scalars (including null), ignore undefined override values, and return deep copies without mutating or sharing nested object/array references with either input. Ignore __proto__, constructor and prototype keys at every depth in both inputs. Preserve the export and run node public.test.mjs.',
    files: {'config.mjs': 'export function mergeConfig(base, overrides) { return {...base,...overrides} }\n'},
    publicTest: header + `import {mergeConfig} from './config.mjs';
const base={server:{host:'localhost',port:80},plugins:['a']};const override={server:{port:443},plugins:['b']};
assert.deepEqual(mergeConfig(base,override),{server:{host:'localhost',port:443},plugins:['b']});
assert.equal(base.server.port,80);console.log('PUBLIC_PASS');\n`,
    acceptanceTest: header + `import {mergeConfig} from './config.mjs';
const base={a:{b:1},list:[{v:1}],keep:3,nullable:{x:1}};const override={a:{c:2},keep:undefined,nullable:null};
const result=mergeConfig(base,override);assert.deepEqual(result,{a:{b:1,c:2},list:[{v:1}],keep:3,nullable:null});
result.a.b=9;result.list[0].v=9;assert.equal(base.a.b,1);assert.equal(base.list[0].v,1);assert.equal(override.a.c,2);
const replacement={list:[{v:4}]};const copy=mergeConfig({},replacement);copy.list[0].v=7;assert.equal(replacement.list[0].v,4);
const hostile=JSON.parse('{"__proto__":{"polluted":true},"constructor":{"bad":1},"safe":{"prototype":1,"ok":2}}');
assert.deepEqual(mergeConfig(hostile,{}),{safe:{ok:2}});assert.deepEqual(mergeConfig({},hostile),{safe:{ok:2}});assert.equal({}.polluted,undefined);
console.log('ACCEPTANCE_PASS');\n`,
  },
  {
    id: 'query-refactor',
    task: 'Refactor urls.mjs to share query encoding in a new query.mjs exporting encodeQuery(entries). entries is an ordered array of [key,value] pairs; it must return URLSearchParams encoding, preserving duplicate keys and their order. Import and use encodeQuery in both existing URL builders; urls.mjs should no longer construct URLSearchParams directly. Preserve existing exports and exact outputs, including empty tag arrays, spaces and Unicode. Run node public.test.mjs.',
    files: {'urls.mjs': `export function searchUrl(base,term,page=1) { const p=new URLSearchParams();p.append('q',term);p.append('page',String(page));return base+'?'+p.toString() }
export function tagUrl(base,tags) { const p=new URLSearchParams();for(const tag of tags)p.append('tag',tag);return base+'?'+p.toString() }\n`},
    publicTest: header + `import {searchUrl,tagUrl} from './urls.mjs';
import {encodeQuery} from './query.mjs';
assert.equal(searchUrl('/search','hello world',2),'/search?q=hello+world&page=2');
assert.equal(tagUrl('/tags',['a','b']),'/tags?tag=a&tag=b');assert.equal(encodeQuery([['x','a b']]),'x=a+b');console.log('PUBLIC_PASS');\n`,
    acceptanceTest: header + `import fs from 'node:fs';import {searchUrl,tagUrl} from './urls.mjs';import {encodeQuery} from './query.mjs';
assert.equal(searchUrl('/s','🌊 & x'),'/s?q=%F0%9F%8C%8A+%26+x&page=1');assert.equal(tagUrl('/t',[]),'/t?');
assert.equal(encodeQuery([['a','1'],['b',''],['a','2']]),'a=1&b=&a=2');assert.equal(encodeQuery([]),'');
const source=fs.readFileSync('urls.mjs','utf8');assert.match(source,/import[\\s\\S]*encodeQuery[\\s\\S]*from\\s*['"]\\.\\/query\\.mjs['"]/);assert.doesNotMatch(source,/new\\s+URLSearchParams/);
console.log('ACCEPTANCE_PASS');\n`,
  },
]
