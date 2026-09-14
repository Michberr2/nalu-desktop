import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const mod={exports:{}}
new Function('exports','module',ts.transpileModule(fs.readFileSync('src/companion/motion.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod.exports,mod)
const {CompanionMotion}=mod.exports
const idle={working:false,listening:false,speaking:false,interacting:false,paused:false,reduced:false}
const advance=(motion,seconds,input=idle,width=900)=>{const seen=new Set();for(let i=0;i<seconds*20;i++){motion.step(.05,width,input);seen.add(motion.mood);assert.ok(motion.x>=-420&&motion.x<=width+420)}return seen}
test('idle Nalu walks fully beyond an edge, returns, circles and sleeps; narrow displays also return',()=>{
 for(const width of [240,900,2200]) {
  const nalu=new CompanionMotion(),seen=new Set();let outside=false,returned=false
  for(let i=0;i<2400;i++){nalu.step(.05,width,idle);seen.add(nalu.mood);if(nalu.x< -125 || nalu.x>width+125)outside=true;if(outside&&nalu.x>=Math.min(120,width/3)&&nalu.x<=width-Math.min(120,width/3))returned=true}
  assert.ok(outside,'whole wolf can leave the viewport');assert.ok(returned,'wolf comes back without Find Nalu');assert.deepEqual([...seen],['walk','circle','curl','sleep'])
 }
})
test('opening conversation brings an offscreen wolf back into reach',()=>{
 const nalu=new CompanionMotion();nalu.x=-150
 advance(nalu,10,{...idle,interacting:true});assert.ok(nalu.x>=120);assert.equal(nalu.mood,'listen')
})
test('working alternates ball play and digging; listening and speech interrupt the activity',()=>{
 const nalu=new CompanionMotion();assert.deepEqual([...advance(nalu,25,{...idle,working:true})],['play','dig'])
 nalu.step(.1,900,{...idle,working:true,listening:true});assert.equal(nalu.mood,'listen')
 nalu.step(.1,900,{...idle,working:true,speaking:true});assert.equal(nalu.mood,'speak')
})
test('rest and reduced motion suppress wandering while breathing settles into a curl',()=>{
 for(const input of [{...idle,paused:true},{...idle,reduced:true}]){const nalu=new CompanionMotion();const start=nalu.x;advance(nalu,15,input);assert.equal(nalu.x,start);assert.equal(nalu.mood,'sleep');assert.ok(nalu.curl>.99)}
})
