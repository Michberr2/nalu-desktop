import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const mod={exports:{}}
new Function('exports','module',ts.transpileModule(fs.readFileSync('src/companion/petPhysics.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod.exports,mod)
const {PetBall,diggingPaw}=mod.exports
test('ball rests without drifting, responds to contact, bounces and loses energy on the floor',()=>{
 const ball=new PetBall(),start=ball.x
 for(let i=0;i<120;i++)ball.step(1/60,40)
 assert.equal(ball.x,start)
 ball.touch(ball.x-.3,ball.y,1.5,0)
 assert.ok(ball.vx>0);assert.equal(ball.contacts,1)
 ball.y=1;ball.vy=-2
 let bounced=false
 for(let i=0;i<1200;i++){ball.step(1/60,40);if(ball.vy>0)bounced=true;assert.ok(ball.y>=ball.radius)}
 assert.ok(bounced);assert.equal(ball.vx,0);assert.equal(ball.vy,0)
 assert.ok(ball.x>start)
})
test('digging alternates grounded backward scrapes with lifted forward recovery',()=>{
 let prior=diggingPaw(0,false),scrapes=0,lifts=0,alternating=false
 for(let i=1;i<300;i++){
  const current=diggingPaw(i/300,false),other=diggingPaw(i/300,true)
  if(current.scraping&&prior.scraping){assert.ok(current.x<prior.x);assert.equal(current.y,.07);scrapes++}
  if(!current.scraping&&current.y>.2)lifts++
  if(current.scraping&&!other.scraping)alternating=true
  prior=current
 }
 assert.ok(scrapes>20&&lifts>20&&alternating)
})

test('the ball crosses both viewport edges and contact can send it back in',()=>{
 for(const side of [-1,1]) {
  const ball=new PetBall(),width=30;ball.x=side<0?.3:width-.3;ball.vx=side*3
  for(let i=0;i<60;i++)ball.step(1/60,width)
  assert.ok(side<0?ball.x<0:ball.x>width,'screen edge must not act as a wall')
  ball.touch(ball.x+side*.3,ball.y,-side*4,0)
  for(let i=0;i<240;i++)ball.step(1/60,width)
  assert.ok(ball.x>0&&ball.x<width,'contact returns the ball through the edge')
 }
})
