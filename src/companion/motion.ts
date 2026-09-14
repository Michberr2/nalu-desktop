export type PetMood = 'walk' | 'circle' | 'curl' | 'sleep' | 'play' | 'dig' | 'listen' | 'speak'
export type MotionInput = { working: boolean; listening: boolean; speaking: boolean; interacting: boolean; paused: boolean; reduced: boolean }
export class CompanionMotion {
  mood: PetMood = 'walk'
  elapsed = 0
  time = 0
  x = 150
  facing = 1
  curl = 0
  private idleTime = 0
  private workTime = 0
  private priorWorking = false
  private restTime = 0
  private excursion: 'out' | 'back' | null = null
  private edge = -1
  private outsideTime = 0
  settle() { this.excursion = null; this.idleTime = 24 }
  step(dt: number, width: number, input: MotionInput) {
    const elapsed = Math.max(0, Math.min(dt, 2))
    dt = Math.min(elapsed, .1); this.elapsed += elapsed
    if (input.working && !this.priorWorking) this.workTime = 0
    this.priorWorking = input.working
    if (input.working) this.workTime += elapsed
    if (!input.working && !input.interacting && !input.listening && !input.speaking) this.idleTime += elapsed
    else this.idleTime = 0
    if (input.paused && !input.listening && !input.speaking) this.restTime += elapsed; else this.restTime = 0
    const idle = this.idleTime % 85
    const free = !input.working && !input.interacting && !input.listening && !input.speaking && !input.paused && !input.reduced
    const margin = Math.min(120, width / 3), limit = Math.max(margin, width - margin)
    if (free && idle < 24 && !this.excursion) {
      this.excursion = 'out'; this.edge = this.x < width / 2 ? -1 : 1; this.outsideTime = 0
    }
    if (!free) this.excursion = null
    let desired: PetMood = input.listening ? 'listen' : input.speaking ? 'speak' : input.reduced ? 'sleep' : input.paused ? this.restTime < 6 ? 'circle' : this.restTime < 10 ? 'curl' : 'sleep' : input.working ? Math.floor(this.workTime / 12) % 2 ? 'dig' : 'play' : input.interacting ? 'listen' : this.excursion || idle < 24 ? 'walk' : idle < 30 ? 'circle' : idle < 34 ? 'curl' : 'sleep'
    if (!free && !input.working && !input.reduced && (this.x < margin || this.x > limit)) desired = 'walk'
    if (desired !== this.mood) { this.mood = desired; this.time = 0 } else this.time += elapsed
    const curlTarget = ['sleep','curl'].includes(this.mood) ? 1 : 0
    this.curl += (curlTarget - this.curl) * Math.min(1, dt * 2)
    if (this.mood === 'walk' && this.curl < .05) {
      const goal = this.excursion === 'out' ? this.edge < 0 ? -150 : width + 150 : this.excursion === 'back' ? this.edge < 0 ? margin : limit : Math.max(margin, Math.min(limit, this.x))
      if (Math.abs(goal - this.x) > .1) {
        this.facing = goal > this.x ? 1 : -1
        this.x += this.facing * Math.min(Math.abs(goal - this.x), 32 * dt)
      } else if (this.excursion === 'out') {
        this.outsideTime += dt
        if (this.outsideTime > .7) this.excursion = 'back'
      } else if (this.excursion === 'back') this.settle()
    }
    if (input.reduced) this.x = Math.max(margin, Math.min(limit, this.x))
    // The screen is a viewport, not a physical wall. Working fetches may go
    // farther behind an offscreen ball before bringing it back.
    this.x = Math.max(-420, Math.min(width + 420, this.x))
    return this
  }
}
