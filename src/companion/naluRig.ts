import * as THREE from 'three'
import { naluMouthContour } from './naluMouthContour'

// Nalu's original website geometry, adapted from train/client/src/components/NaluChase.tsx.
// Keep the traced logo, wolf proportions and articulated legs; desktop poses live separately.
export function createNaluRig(scene: THREE.Scene) {
    const fur = new THREE.MeshBasicMaterial({ color: 0x272729 })
    const furEdge = new THREE.MeshBasicMaterial({ color: 0x222224 })
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f0e9, roughness: 0.4 })
    const sphere = new THREE.SphereGeometry(1, 24, 16)
    function part(parent: THREE.Object3D, material: THREE.Material, pos: number[], scale: number[], geometry: THREE.BufferGeometry = sphere) {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(pos[0], pos[1], pos[2])
      mesh.scale.set(scale[0], scale[1], scale[2])
      parent.add(mesh)
      return mesh
    }
    const wolf = new THREE.Group()
    scene.add(wolf)
    const torso = new THREE.Group()
    torso.position.y = -0.22
    wolf.add(torso)
    function silhouette(parent: THREE.Object3D, shape: THREE.Shape, depth: number) {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth, steps: 1, bevelEnabled: true, bevelThickness: 0.012,
        bevelSize: 0.008, bevelSegments: 2, curveSegments: 16,
      })
      geometry.translate(0, 0, -depth / 2)
      const mesh = new THREE.Mesh(geometry, [fur, furEdge])
      parent.add(mesh)
      return mesh
    }
    function outline(points: number[][]) {
      const shape = new THREE.Shape()
      points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y))
      shape.closePath()
      return shape
    }
    const anatomy = new THREE.Group()
    torso.add(anatomy)
    // Side-profile proportions studied from the Montana State University wolf photo:
    // https://www.montana.edu/extension/images/wwu2.jpg
    // Long lower limbs, deep ribs above the elbows, broad ruff, and a low brush.
    const body = new THREE.Shape()
    body.moveTo(-1.78, 2.05)
    body.bezierCurveTo(-1.72, 2.37, -1.5, 2.48, -1.18, 2.45)
    body.bezierCurveTo(-0.76, 2.4, -0.35, 2.46, -0.1, 2.55)
    // Small, swept guard hairs break the contour without changing the back's anatomy.
    body.lineTo(-0.14, 2.6)
    body.lineTo(0.02, 2.59)
    body.lineTo(-0.01, 2.65)
    body.lineTo(0.19, 2.63)
    body.bezierCurveTo(0.45, 2.67, 0.74, 2.79, 0.97, 2.77)
    // Continue underneath the logo's flat lower edge to form one sloping throat.
    body.bezierCurveTo(1.34, 2.69, 1.65, 2.37, 1.65, 2.02)
    body.bezierCurveTo(1.48, 1.87, 1.32, 1.78, 1.18, 1.64)
    body.lineTo(1.2, 1.69)
    body.lineTo(1.07, 1.57)
    body.lineTo(1.09, 1.62)
    body.bezierCurveTo(0.87, 1.39, 0.75, 1.25, 0.46, 1.2)
    body.bezierCurveTo(0.05, 1.15, -0.38, 1.37, -0.72, 1.48)
    body.bezierCurveTo(-0.94, 1.55, -1.18, 1.42, -1.36, 1.4)
    body.bezierCurveTo(-1.67, 1.39, -1.87, 1.68, -1.78, 2.05)
    const bodyMesh = silhouette(anatomy, body, 0.42)
    const bodyPositions = bodyMesh.geometry.getAttribute('position') as THREE.BufferAttribute
    const bodyRest = new Float32Array(bodyPositions.array)
    const head = new THREE.Group()
    head.position.set(1.25, 2.35, 0)
    torso.add(head)
    // Contour traced from the alpha channel of /nalu-logo.png, left-hand mark.
    // Preserve the actual ears, muzzle and three ruff points; no added facial features.
    const logoContour = [[88,33],[85,34],[81,38],[72,52],[62,72],[59,75],[57,75],[55,71],[57,46],[58,45],[58,32],[56,32],[38,57],[29,74],[7,97],[7,99],[17,99],[18,100],[18,103],[1,121],[2,122],[11,122],[14,124],[12,128],[1,138],[0,140],[1,142],[97,142],[97,140],[95,137],[97,133],[104,130],[106,128],[123,119],[128,115],[131,114],[135,110],[135,107],[133,104],[112,91],[96,83],[88,76],[86,70],[86,54],[87,53]]
    const closedHead = silhouette(head, outline(logoContour.map(([x, y]) => [(x - 64) / 80, (110 - y) / 80])), 0.36)
    const openHead = silhouette(head, outline(naluMouthContour), 0.36)
    openHead.visible = false
    const tail = new THREE.Group()
    tail.position.set(-1.6, 2.15, 0)
    anatomy.add(tail)
    const brush = new THREE.Shape()
    brush.moveTo(0.14, 0.15)
    brush.bezierCurveTo(-0.28, 0.2, -0.53, -0.19, -0.63, -0.55)
    brush.lineTo(-0.7, -0.53)
    brush.lineTo(-0.69, -0.66)
    brush.bezierCurveTo(-0.78, -0.95, -0.91, -1.12, -1.02, -1.26)
    brush.lineTo(-0.93, -1.24)
    brush.lineTo(-0.99, -1.34)
    brush.quadraticCurveTo(-0.69, -1.37, -0.44, -1.08)
    brush.lineTo(-0.44, -1.15)
    brush.bezierCurveTo(-0.17, -0.94, -0.03, -0.65, 0.02, -0.41)
    brush.lineTo(0.055, -0.46)
    brush.bezierCurveTo(0.15, -0.22, 0.21, 0.02, 0.14, 0.15)
    silhouette(tail, brush, 0.3)
    const legs: { hip: THREE.Group; upper: THREE.Group; lower: THREE.Group; ankle: THREE.Group; paw: THREE.Group; hind: boolean; far: boolean; upperLength: number; lowerLength: number }[] = []
    for (const x of [-1.3, 0.58]) for (const z of [-0.27, 0.27]) {
      const hip = new THREE.Group()
      hip.position.set(x, 1.74, z)
      wolf.add(hip)
      const hind = x < 0, far = z < 0
      const upperLength = hind ? 0.88 : 0.83
      const lowerLength = hind ? 0.62 : 0.81
      const upper = new THREE.Group(), lower = new THREE.Group(), ankle = new THREE.Group(), paw = new THREE.Group()
      hip.add(upper, lower, ankle, paw)
      const thigh = new THREE.Shape()
      thigh.moveTo(-0.22, 0.17)
      thigh.bezierCurveTo(hind ? 0.38 : 0.27, 0.22, hind ? 0.32 : 0.2, -0.46, 0.12, -upperLength)
      thigh.lineTo(-0.12, -upperLength)
      thigh.quadraticCurveTo(-0.17, -0.64, -0.2, -0.52)
      thigh.lineTo(-0.25, -0.57)
      thigh.lineTo(-0.24, -0.4)
      thigh.lineTo(hind ? -0.34 : -0.29, -0.46)
      thigh.bezierCurveTo(hind ? -0.34 : -0.27, -0.22, -0.28, 0.02, -0.22, 0.17)
      silhouette(upper, thigh, 0.18)
      const calf = new THREE.Shape()
      calf.moveTo(-0.14, 0.06)
      calf.quadraticCurveTo(0.18, 0.1, 0.145, -0.3)
      calf.quadraticCurveTo(0.11, -lowerLength * 0.7, 0.11, -lowerLength)
      calf.lineTo(-0.1, -lowerLength)
      calf.lineTo(-0.12, -lowerLength + 0.16)
      calf.lineTo(-0.16, -lowerLength + 0.12)
      calf.lineTo(-0.145, -lowerLength * 0.5)
      calf.lineTo(-0.19, -lowerLength * 0.55)
      calf.quadraticCurveTo(-0.15, -0.15, -0.14, 0.06)
      silhouette(lower, calf, 0.18)
      if (hind) silhouette(ankle, outline([[-0.1,0.04],[0.1,0.04],[0.09,-0.267],[-0.09,-0.267],[-0.125,-0.19],[-0.105,-0.2]]), 0.16)
      const foot = new THREE.Shape()
      foot.moveTo(-0.11, 0.08)
      foot.bezierCurveTo(0.09, 0.13, 0.26, 0.05, 0.27, -0.035)
      foot.quadraticCurveTo(0.24, -0.09, -0.1, -0.065)
      foot.quadraticCurveTo(-0.15, -0.03, -0.11, 0.08)
      silhouette(paw, foot, 0.2)
      legs.push({ hip, upper, lower, ankle, paw, hind, far, upperLength, lowerLength })
    }
    const ball = new THREE.Group()
    scene.add(ball)
    const blue = new THREE.MeshStandardMaterial({ color: 0x6b9fff, roughness: 0.24, metalness: 0.08 })
    part(ball, blue, [0, 0, 0], [0.23, 0.23, 0.23])
    const stripeGeometry = new THREE.TorusGeometry(0.225, 0.015, 8, 40)
    ball.add(new THREE.Mesh(stripeGeometry, white))
    const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x17202f, transparent: true, opacity: 0.12, depthWrite: false })
    const wolfShadow = part(scene, shadowMaterial, [0, 0.04, 0], [1.35, 0.01, 0.45])
    const ballShadow = part(scene, shadowMaterial, [0, 0.035, 0], [0.3, 0.01, 0.22])

  return { wolf, torso, anatomy, head, closedHead, openHead, tail, legs, bodyMesh, bodyPositions, bodyRest, ball, wolfShadow, ballShadow }
}
