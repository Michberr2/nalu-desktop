import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { PetBall, diggingPaw } from './petPhysics'
import { createNaluRig } from './naluRig'
import { CompanionMotion, type MotionInput } from './motion'

export default function NaluPet({ reveal, input, onPosition, onError, treat, onTreat }: { reveal: number; treat: number; onTreat: (busy: boolean) => void; input: MotionInput; onPosition: (x: number, mood: string) => void; onError: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const revealRequest = useRef(reveal); revealRequest.current = reveal
  const current = useRef(input); current.current = input
  const position = useRef(onPosition); position.current = onPosition
  const treatRequest = useRef(treat); treatRequest.current = treat
  const treatStatus = useRef(onTreat); treatStatus.current = onTreat
  const fail = useRef(onError); fail.current = onError
  useEffect(() => {
    const el = host.current!
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }) } catch { fail.current(); return }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setClearColor(0, 0)
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-10, 10, 4.5, -.5, .1, 100)
    camera.position.set(0, 2, 20); camera.lookAt(0, 0, 0)
    scene.add(new THREE.HemisphereLight(0xf0f3ff, 0x615649, 2.6))
    const key = new THREE.DirectionalLight(0xffe9c9, 3); key.position.set(-3, 8, 7); scene.add(key)
    const rim = new THREE.DirectionalLight(0xc3d7ff, 4); rim.position.set(3, 4, -4); scene.add(rim)
    const rig = createNaluRig(scene), motion = new CompanionMotion()
    const snack = new THREE.Group(); scene.add(snack); snack.visible = false
    const biscuit = new THREE.MeshStandardMaterial({ color: 0xd7a862, roughness: .8 })
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(.065, .065, .3, 12), biscuit); stick.rotation.z = Math.PI / 2; snack.add(stick)
    for (const px of [-.15, .15]) for (const py of [-.055, .055]) { const end = new THREE.Mesh(new THREE.SphereGeometry(.085, 12, 8), biscuit); end.position.set(px, py, 0); snack.add(end) }
    let revealed = 0
    const ball = new PetBall(), priorNose = new THREE.Vector3(), priorPaws = [new THREE.Vector3(), new THREE.Vector3()]
    let contactReady = false, dirtCount = 0, headDip = 0, digBlend = 0, pawBlend = 0
    let fetchBall: { side: number; returning: boolean } | null = null
    const pawScraping = [false, false]
    let requested = 0, snackPhase: 'none' | 'flight' | 'grab' = 'none', snackTime = 0, snackX = 0, snackY = 0, snackVx = 0, snackVy = 0, snacksCaught = 0
    const mouth = new THREE.Vector3()
    const dirt = new THREE.Group(); scene.add(dirt)
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0xa9997a, transparent: true, opacity: .7 })
    const pebble = new THREE.SphereGeometry(.035, 6, 4)
    const soil = new THREE.Mesh(new THREE.SphereGeometry(1,24,12), new THREE.MeshStandardMaterial({color:0x77634c,roughness:1,transparent:true,opacity:0}))
    soil.scale.set(.85,.035,.36); scene.add(soil)
    const grains: {mesh:THREE.Mesh; vx:number;vy:number;vz:number;life:number}[] = []
    for (let i = 0; i < 36; i++) { const mesh = new THREE.Mesh(pebble, dirtMat.clone()); mesh.visible=false; dirt.add(mesh); grains.push({mesh,vx:0,vy:0,vz:0,life:0}) }
    let width = el.clientWidth, height = el.clientHeight, frame = 0, previous = 0, yaw = 0, lastReport = 0
    const worldScale = 36
    const resize = () => { width = el.clientWidth; height = el.clientHeight; camera.left = -width / worldScale / 2; camera.right = width / worldScale / 2; camera.top = height / worldScale - .15; camera.bottom = -.15; camera.updateProjectionMatrix(); renderer.setSize(width, height) }
    const observer = new ResizeObserver(resize); observer.observe(el); resize()
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop)
      const interval = motion.mood === 'sleep' ? 1000 / 15 : 1000 / 30
      if (previous && now - previous < interval) return
      const frameDt = previous ? (now - previous) / 1000 : 0, dt = Math.min(.1, frameDt); previous = now
      if (treatRequest.current !== requested && snackPhase === 'none') {
        requested = treatRequest.current; snackPhase = 'flight'; snackTime = 0
        snackX = motion.x + motion.facing * 145; snackY = 4.5; snackVx = -motion.facing * 65; snackVy = .9
        snack.visible = true; treatStatus.current(true)
      }
      if (revealRequest.current !== revealed) {
        revealed = revealRequest.current; motion.x = width / 2; motion.facing = 1
        ball.x = Math.min(width - 24, motion.x + 115) / worldScale; ball.vx=0; ball.vy=0; contactReady=false; fetchBall=null
      }
      const chasing = snackPhase !== 'none'
      const fetchInput = fetchBall && !current.current.paused && !current.current.reduced && !current.current.interacting ? { ...current.current, working: true } : current.current
      const state = motion.step(frameDt, width, chasing ? { ...current.current, working: false, interacting: true, paused: false, reduced: false } : fetchInput), t = state.elapsed, curl = state.curl
      if (snackPhase === 'flight') {
        snackX += snackVx * dt; snackY += snackVy * dt; snackVy -= 5 * dt
        if (snackY < .25) { snackY = .25; snackVy = Math.abs(snackVy) * .2; snackVx *= .3 }
        const goal = snackX - state.facing * 76, delta = goal - state.x
        if (Math.abs(delta) > 3 && curl < .1) state.x += Math.sign(delta) * Math.min(Math.abs(delta), 42 * dt)
        state.x = Math.max(110, Math.min(width - 110, state.x))
      }
      const mayFetch = !chasing && !current.current.paused && !current.current.reduced && !current.current.listening && !current.current.speaking && !current.current.interacting
      if (!fetchBall && mayFetch && (ball.x < -ball.radius || ball.x > width/worldScale+ball.radius)) fetchBall={side:ball.x<0?-1:1,returning:false}
      const fetching = mayFetch && fetchBall !== null
      if (fetching) state.mood='play'
      const dig = state.mood === 'dig', play = state.mood === 'play'
      const pawPlay = play && !fetching && t % 5 > 3
      const priorX = state.x
      if (fetching && !fetchBall!.returning) {
        const goal=ball.x*worldScale+fetchBall!.side*115,delta=goal-state.x
        state.facing=delta>0?1:-1
        state.x+=Math.sign(delta)*Math.min(Math.abs(delta),65*dt)
        if(Math.abs(delta)<4) { fetchBall!.returning=true; state.facing=-fetchBall!.side }
      } else if (play) {
        const delta = ball.x * worldScale - state.x
        if (fetching) state.facing=-fetchBall!.side
        else if (Math.abs(delta) > 100) state.facing = delta > 0 ? 1 : -1
        const goal = ball.x * worldScale - state.facing * (pawPlay ? 47 : 91)
        state.x += Math.max(-45*dt, Math.min(45*dt, goal-state.x))
        state.x = Math.max(-420,Math.min(width+420,state.x))
      }
      const ballMargin=Math.min(40,width/8),wolfMargin=Math.min(110,width/3)
      if(fetching && fetchBall!.returning && ball.x*worldScale>ballMargin && ball.x*worldScale<width-ballMargin && state.x>=wolfMargin && state.x<=width-wolfMargin) { fetchBall=null; motion.settle() }
      digBlend += (Number(dig)-digBlend)*Math.min(1,dt*5)
      pawBlend += (Number(pawPlay)-pawBlend)*Math.min(1,dt*5)
      const walk = snackPhase === 'flight' || state.mood === 'walk' || state.mood === 'circle' || play && Math.abs(state.x-priorX)>.05
      const circle = state.mood === 'circle' ? state.time / 6 * Math.PI * 4 + (state.facing < 0 ? Math.PI : 0) : 0
      const wanted = state.mood === 'circle' ? circle : state.facing > 0 ? 0 : Math.PI
      yaw += Math.atan2(Math.sin(wanted - yaw), Math.cos(wanted - yaw)) * Math.min(1, dt * 7)
      rig.wolf.rotation.y = yaw
      rig.wolf.position.set((state.x - width / 2) / worldScale + (state.mood === 'circle' ? Math.sin(circle) * .85 : 0), walk ? Math.sin(t * 12) * .018 : 0, state.mood === 'circle' ? (Math.cos(circle) - state.facing) * .85 : 0)
      // Lower the original wolf onto folded legs. Preserve her head, body
      // silhouette and materials; no warped ring or replacement character.
      const targetDip = snackPhase === 'flight' ? Math.max(0, Math.min(1.6, (2.4 - snackY) / 1.3)) : dig ? .65 + Math.sin(t * 8) * .08 : play ? pawPlay ? .45 : 1.20 + Math.sin(t * 2.4) * .09 : curl * .32
      headDip += (targetDip-headDip)*Math.min(1,dt*6)
      const dip=headDip
      const breathing = Math.sin(t * 1.4) * .012 * curl
      rig.torso.position.y = -.22 - curl * .92 + breathing - (digBlend * (.12 + Math.sin(t * 8.5) * .02) + pawBlend * .16)
      rig.anatomy.scale.set(1,1,1); rig.anatomy.position.y=0
      rig.bodyMesh.visible = true
      rig.head.position.set(1.25 + dip * .35, 2.35 - dip * 1.15, 0)
      rig.head.rotation.set(0,0,-dip*.5)
      rig.head.scale.setScalar(1)
      rig.closedHead.visible = !(current.current.speaking && Math.sin(t * 15) > -.2 || snackPhase === 'grab' && Math.sin(t * 16) > 0)
      rig.openHead.visible = !rig.closedHead.visible
      const { bodyPositions: vertices, bodyRest } = rig
      for (let i = 0; i < vertices.count; i++) {
        const x = bodyRest[i * 3], y = bodyRest[i * 3 + 1], z = bodyRest[i * 3 + 2]
        const bend = THREE.MathUtils.smoothstep(x, -.15, 1.45) * THREE.MathUtils.smoothstep(y, 1.15, 2.04)
        vertices.setXYZ(i, x + dip * .35 * bend, y - dip * 1.15 * bend, z)
      }
      vertices.needsUpdate = true; rig.bodyMesh.geometry.computeVertexNormals()
      rig.tail.position.set(-1.6, 2.15, 0)
      rig.tail.scale.setScalar(1)
      rig.tail.visible = true
      rig.tail.rotation.set(Math.sin(t * (play ? 9 : 2)) * (play ? .22 : .07) * (1 - curl), curl * -.25, curl * -.35)
      rig.legs.forEach((leg, i) => {
        const phase = t * (dig ? 14 : 5) + (i === 0 || i === 3 ? 0 : Math.PI)
        const stride = walk ? Math.sin(phase) * .28 : dig && !leg.hind ? Math.sin(phase) * .45 : play && !leg.hind ? Math.sin(t * 3) * .22 : 0
        leg.hip.visible = true
        leg.hip.position.y = 1.74 - curl * .94 - (!leg.hind ? digBlend * .36 + pawBlend * .32 : 0)
        leg.hip.position.x = THREE.MathUtils.lerp(leg.hind ? -1.3 : .58, leg.hind ? -1.3 : 1.02, curl)
        let endX = THREE.MathUtils.lerp(stride + (leg.hind ? -.12 : .03), leg.hind ? .25 : .4, curl), endY = -1.60 + Math.max(0, Math.cos(phase)) * (walk ? .18 : dig && !leg.hind ? .38 : 0) + curl * .94 + (leg.hind ? .26 : 0)
        if (dig && !leg.hind) { const stroke=diggingPaw(t,leg.far); endX=THREE.MathUtils.lerp(endX,stroke.x,digBlend); endY=THREE.MathUtils.lerp(endY,stroke.y-leg.hip.position.y,digBlend); leg.paw.rotation.z=stroke.scraping ? -.1 : .12 }
        else if (pawPlay && !leg.hind) { const stroke=diggingPaw(t*.65,leg.far); endX=THREE.MathUtils.lerp(endX,stroke.x,pawBlend); endY=THREE.MathUtils.lerp(endY,stroke.y-leg.hip.position.y,pawBlend); leg.paw.rotation.z=0 }
        else leg.paw.rotation.z=0
        const distance = Math.max(.01, Math.min(leg.upperLength + leg.lowerLength - .003, Math.hypot(endX, endY)))
        const scale = distance / Math.hypot(endX, endY); endX *= scale; endY *= scale
        const along = (leg.upperLength ** 2 - leg.lowerLength ** 2 + distance ** 2) / (2 * distance)
        const bend = (leg.hind ? 1 : -1) * Math.sqrt(Math.max(0, leg.upperLength ** 2 - along ** 2))
        const kx = endX / distance * along - endY / distance * bend, ky = endY / distance * along + endX / distance * bend
        leg.upper.rotation.z = Math.atan2(kx, -ky); leg.lower.position.set(kx, ky, 0); leg.lower.rotation.z = Math.atan2(endX - kx, -(endY - ky))
        leg.ankle.position.set(endX, endY, 0); leg.paw.position.set(endX + (leg.hind ? .06 : 0), endY - (leg.hind ? .26 : 0), 0)
      })
      rig.wolf.updateMatrixWorld(true)
      mouth.set(.84,.18,0); rig.head.localToWorld(mouth)
      const frontPaws = rig.legs.filter(leg=>!leg.hind)
      ball.step(dt,width/worldScale)
      const touchingBall = play && (!fetching || fetchBall?.returning)
      if (touchingBall && contactReady && dt>0) {
        ball.touch(mouth.x+width/worldScale/2,mouth.y,(mouth.x-priorNose.x)/dt,(mouth.y-priorNose.y)/dt,.17)
      }
      priorNose.copy(mouth)
      frontPaws.forEach((leg,index)=>{
        const point=new THREE.Vector3(.12,0,0); leg.paw.localToWorld(point)
        if (touchingBall && contactReady && dt>0) ball.touch(point.x+width/worldScale/2,point.y,(point.x-priorPaws[index].x)/dt,(point.y-priorPaws[index].y)/dt,.16)
        priorPaws[index].copy(point)
        const scraping=dig && diggingPaw(t,leg.far).scraping && point.y<.15
        if (scraping && !pawScraping[index]) {
          for (let n=0;n<5;n++) {
            const grain=grains.find(g=>g.life<=0); if(!grain)break
            grain.mesh.position.copy(point); grain.mesh.position.y=.09; grain.mesh.visible=true
            grain.vx=-state.facing*(1.4+n*.24);grain.vy=1.3+n*.18;grain.vz=(n-2)*.12;grain.life=.9;dirtCount++
          }
        }
        pawScraping[index]=scraping
      })
      contactReady=true
      rig.ball.visible=true;rig.ballShadow.visible=true
      rig.ball.position.set(ball.x-width/worldScale/2,ball.y,0);rig.ball.rotation.z=ball.angle
      rig.ballShadow.position.x=rig.ball.position.x
      rig.wolfShadow.position.x=rig.wolf.position.x;rig.wolfShadow.scale.x=THREE.MathUtils.lerp(1.6,1,curl)
      const soilMaterial=soil.material as THREE.MeshStandardMaterial
      soilMaterial.opacity += ((dig ? .65 : 0)-soilMaterial.opacity)*Math.min(1,dt*2)
      if(dig)soil.position.set(rig.wolf.position.x+state.facing*.85,.04,0)
      grains.forEach(grain=>{
        if(grain.life<=0)return
        grain.life-=dt;grain.vy-=9.8*dt
        grain.mesh.position.x+=grain.vx*dt;grain.mesh.position.y+=grain.vy*dt;grain.mesh.position.z+=grain.vz*dt
        if(grain.mesh.position.y<.035){grain.mesh.position.y=.035;grain.vy=0;grain.vx*=Math.exp(-8*dt)}
        ;(grain.mesh.material as THREE.MeshStandardMaterial).opacity=Math.min(.85,Math.max(0,grain.life)*2)
        grain.mesh.visible=grain.life>0
      })
      el.dataset.ballVisible='true';el.dataset.ballContacts=String(ball.contacts);el.dataset.dirtEmitted=String(dirtCount)
      el.dataset.ballPosition=(ball.x*worldScale).toFixed(1);el.dataset.fetching=String(fetching)
      if (snackPhase !== 'none') {
        snackTime += dt
        rig.wolf.updateMatrixWorld(true); mouth.set(.84, .18, 0); rig.head.localToWorld(mouth)
        if (snackPhase === 'flight') {
          snack.position.set((snackX - width / 2) / worldScale, snackY, 0); snack.rotation.z += dt * 5
          if (snack.position.distanceTo(mouth) < .5) { snackPhase = 'grab'; snackTime = 0; snacksCaught++ }
          // A missed treat remains on the floor while Nalu approaches and lowers her head.
        } else {
          snack.position.copy(mouth); snack.scale.setScalar(Math.max(0, 1 - snackTime / 1.4))
          if (snackTime > 1.4) { snackPhase = 'none'; snack.visible = false; snack.scale.setScalar(1); treatStatus.current(false) }
        }
      }
      el.dataset.treat = snackPhase; el.dataset.treatsCaught = String(snacksCaught)
      renderer.render(scene, camera)
      el.dataset.mood = state.mood; el.dataset.curl = curl.toFixed(3); el.dataset.position = state.x.toFixed(1)
      if (now - lastReport > 80) { lastReport = now; position.current(rig.wolf.position.x * worldScale + width / 2, state.mood) }
    }
    frame = requestAnimationFrame(loop)
    const lost = (e: Event) => { e.preventDefault(); fail.current() }
    renderer.domElement.addEventListener('webglcontextlost', lost)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); renderer.domElement.removeEventListener('webglcontextlost', lost); const materials = new Set<THREE.Material>(); scene.traverse(obj => { if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) materials.add(m) } }); materials.forEach(m => m.dispose()); renderer.dispose(); renderer.domElement.remove() }
  }, [])
  return <div ref={host} className="companion-stage" aria-hidden="true" />
}
