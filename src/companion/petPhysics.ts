export class PetBall {
  x = 7.5; y = .23; vx = 0; vy = 0; angle = 0; contacts = 0
  readonly radius = .23
  step(dt: number, width: number) {
    const before = this.x
    this.vy -= 9.8 * dt
    this.x += this.vx * dt; this.y += this.vy * dt
    if (this.y < this.radius) {
      this.y = this.radius
      this.vy = this.vy < -.45 ? -this.vy * .52 : 0
      this.vx *= Math.exp(-1.65 * dt)
      if (Math.abs(this.vx) < .025) this.vx = 0
    }
    // Keep simulating beyond the visible edge so Nalu can fetch it there.
    // The outer limits bound the hidden fetch area, not the screen itself.
    if (this.x < -6) { this.x = -6; this.vx = Math.abs(this.vx) * .35 }
    if (this.x > width + 6) { this.x = width + 6; this.vx = -Math.abs(this.vx) * .35 }
    this.angle -= (this.x - before) / this.radius
  }
  touch(x: number, y: number, vx: number, vy: number, radius = .15) {
    const dx = this.x - x, dy = this.y - y, distance = Math.hypot(dx, dy), reach = this.radius + radius
    if (distance >= reach || distance < .001) return
    const nx = dx / distance, ny = dy / distance
    this.x += nx * (reach - distance); this.y = Math.max(this.radius, this.y + ny * (reach - distance))
    const closing = (vx - this.vx) * nx + (vy - this.vy) * ny
    if (closing > .03) {
      const impulse = Math.min(4, closing * 1.3)
      this.vx += nx * impulse; this.vy += ny * impulse
      this.contacts++
    }
  }
}

/** Reach, plant, rake backward along the soil, then lift for the next stroke. */
export function diggingPaw(time: number, far: boolean) {
  const phase = ((time * 1.35 + (far ? .5 : 0)) % 1 + 1) % 1
  if (phase < .3) { const p = phase / .3; return { x: -.4 + p * 1.1, y: .07 + Math.sin(p * Math.PI / 2) * .28, scraping: false } }
  if (phase < .42) { const p = (phase - .3) / .12; return { x: .7, y: .35 - p * .28, scraping: false } }
  if (phase < .82) { const p = (phase - .42) / .4; return { x: .7 - p * 1.1, y: .07, scraping: true } }
  return { x: -.4, y: .07, scraping: false }
}
