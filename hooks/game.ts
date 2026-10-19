// The game's rules: an endless strip of rows, the things that move on them,
// and a character hopping forward one tile at a time.
//
// x runs across the screen (the playfield is -4..4), z runs forward, y is up.
// Times are in seconds and speeds in tiles per second.

import { BUGS, TRAIN_CAR } from './models'
import type { BugKind, PropKind } from './models'

export type RowKind = 'grass' | 'road' | 'rail' | 'water'
export type Phase = 'title' | 'play' | 'dying' | 'over'
export type Dir = 'up' | 'down' | 'left' | 'right'
export type DeathKind = 'squash' | 'sideswipe' | 'train' | 'drown' | 'edge' | 'cursor'
export type TrainCar = 'engine' | 'passing' | 'failing' | 'pending'

export type Mover = {
  x: number
  length: number
  // logs dip when landed on; 1 just after, easing back to 0
  sink: number
  // which log model or bug kind
  kind: number
}

export type Rail = {
  state: 'idle' | 'warn' | 'pass'
  timer: number
  // the front of the train
  x: number
  cars: TrainCar[]
}

export type Decor = { x: number; dz: number; kind: number }

export type Row = {
  z: number
  kind: RowKind
  // grass: what stands on each tile, indexed x + SPAN
  props: (PropKind | null)[]
  decor: Decor[]
  dir: 1 | -1
  speed: number
  bug: BugKind
  movers: Mover[]
  rail: Rail | null
  pads: number[]
  padSink: number[]
  token: number | null
}

export type Particle = {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  max: number
  color: number
  size: number
  spin: number
  floor: number
  emissive: boolean
}

export type Popup = { x: number; y: number; z: number; text: string; t: number }

export type Death = {
  kind: DeathKind
  t: number
  // what did it: a bug kind, or nothing
  by: BugKind | null
  // the row and mover the character is stuck to, if any
  row: Row | null
  mover: Mover | null
  offset: number
}

export type GameEvent =
  | { type: 'hop' }
  | { type: 'token'; total: number }
  | { type: 'death'; kind: DeathKind; by: BugKind | null }
  | { type: 'over' }
  | { type: 'best'; score: number }

// Movers wrap around a loop this wide, centered on the playfield.
export const SPAN = 15
const LOOP = SPAN * 2
export const EDGE = 4
const HOP = 0.16
const HOP_HEIGHT = 0.5
const BODY = 0.3
const TRAIN_SPEED = 30
const DANGER = 2.8
const GRAVITY = 24
export const OVER_DELAY = 1.3

export function groundY(kind: RowKind): number {
  switch (kind) {
    case 'grass':
      return 0
    case 'road':
      return -0.1
    case 'rail':
      return -0.06
    case 'water':
      return -0.3
  }
}

// The top of a log, which floats with its top just above the grass.
export const LOG_TOP = 0.05
export const PAD_TOP = -0.24

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PROP_WEIGHTS: [PropKind, number][] = [
  ['tree', 0.42],
  ['tallTree', 0.16],
  ['rack', 0.16],
  ['box', 0.12],
  ['rock', 0.14],
]

const BUG_WEIGHTS: [BugKind, number][] = [
  ['ladybug', 0.34],
  ['beetle', 0.28],
  ['roach', 0.22],
  ['centipede', 0.16],
]

export class Game {
  rand: () => number
  rows = new Map<number, Row>()
  phase: Phase = 'title'
  time = 0
  // time since the phase began
  phaseTime = 0

  // the character
  x = 0
  y = 0
  z = 0
  // facing the camera until the first hop
  yaw = Math.PI
  private yawFrom = Math.PI
  private yawTo = Math.PI
  private yawT = 1
  // the hop in progress: t runs 0..1, or -1 standing
  hopT = -1
  private fromX = 0
  private fromY = 0
  private fromZ = 0
  private toX = 0
  private toY = 0
  private toZ = 0
  // the squash after landing, 1 just landed, easing to 0
  land = 0
  // a hop into a wall: the character turns and flinches in place
  bump = 0
  private queued: Dir | null = null
  riding: { row: Row; mover: Mover } | null = null
  onPad: { row: Row; index: number } | null = null

  camX = 0
  camZ = 0
  // set from the view each frame: how many tiles fit across, and rows below the center
  viewHalfX = 6
  viewHalfRows = 6

  score = 0
  best: number
  tokens = 0
  tokensTotal: number
  hops = 0
  death: Death | null = null
  cursor: { t: number; x: number; y: number; z: number; grabbed: boolean } | null = null
  particles: Particle[] = []
  popups: Popup[] = []
  shake = 0
  events: GameEvent[] = []
  private beatBest = false

  // generator state
  private nextZ = 0
  private reach: boolean[] = []
  private keepClear = new Set<number>()
  private lastCluster: RowKind = 'grass'

  constructor(seed: number, best: number, tokensTotal: number) {
    this.rand = mulberry32(seed)
    this.best = best
    this.tokensTotal = tokensTotal
    this.reach = new Array(EDGE * 2 + 1).fill(true)
    this.nextZ = -9
    // a wall of trees behind, and open grass in front of the camera
    for (let z = -9; z < -3; z++) this.addRow(this.grassRow(z, 'solid'))
    for (let z = -3; z < 4; z++) this.addRow(this.grassRow(z, 'empty'))
    this.fill()
  }

  get difficulty(): number {
    return Math.min(1, Math.max(0, this.z / 220))
  }

  // ---- generation ----

  private pick<T>(weights: [T, number][]): T {
    let r = this.rand() * weights.reduce((s, w) => s + w[1], 0)
    for (const [v, w] of weights) {
      r -= w
      if (r <= 0) return v
    }
    return weights[weights.length - 1]![0]
  }

  private between(lo: number, hi: number): number {
    return lo + this.rand() * (hi - lo)
  }

  private int(lo: number, hi: number): number {
    return lo + Math.floor(this.rand() * (hi - lo + 1))
  }

  private blankRow(z: number, kind: RowKind): Row {
    return {
      z,
      kind,
      props: new Array(SPAN * 2 + 1).fill(null),
      decor: [],
      dir: 1,
      speed: 0,
      bug: 'ladybug',
      movers: [],
      rail: null,
      pads: [],
      padSink: [],
      token: null,
    }
  }

  private addRow(row: Row) {
    this.rows.set(row.z, row)
    this.nextZ = row.z + 1
  }

  private grassRow(z: number, fill: 'solid' | 'empty' | 'random'): Row {
    const row = this.blankRow(z, 'grass')
    // the walls of trees past the playfield
    for (let x = -SPAN; x <= SPAN; x++) {
      if (Math.abs(x) <= EDGE && fill !== 'solid') continue
      const r = this.rand()
      row.props[x + SPAN] = r < 0.62 ? 'tree' : r < 0.82 ? 'tallTree' : r < 0.92 ? 'rack' : 'rock'
    }
    for (let i = this.int(1, 4); i > 0; i--) {
      row.decor.push({ x: this.between(-8, 8), dz: this.between(-0.38, 0.38), kind: this.int(0, 3) })
    }
    if (fill === 'random') {
      const d = this.difficulty
      for (let attempt = 0; attempt < 12; attempt++) {
        const props: (PropKind | null)[] = new Array(EDGE * 2 + 1).fill(null)
        const count = Math.min(5, Math.floor(this.rand() * (3.2 + d * 2.2)) + (attempt < 6 ? 0 : -9))
        for (let i = 0; i < count; i++) {
          const x = this.int(-EDGE, EDGE)
          if (this.keepClear.has(x)) continue
          props[x + EDGE] = this.pick(PROP_WEIGHTS)
        }
        const reach = this.reachable(props)
        if (reach.some(Boolean)) {
          for (let x = -EDGE; x <= EDGE; x++) row.props[x + SPAN] = props[x + EDGE]!
          this.reach = reach
          break
        }
      }
    } else {
      this.reach = new Array(EDGE * 2 + 1).fill(fill === 'empty')
    }
    this.keepClear.clear()
    if (fill === 'random' && this.rand() < 0.09) {
      const free = this.reach.map((ok, i) => (ok ? i - EDGE : null)).filter((x): x is number => x !== null)
      if (free.length > 0) row.token = free[this.int(0, free.length - 1)]!
    }
    return row
  }

  // Which tiles of a new grass row can be reached from the row before it, walking sideways around obstacles.
  private reachable(props: (PropKind | null)[]): boolean[] {
    const n = EDGE * 2 + 1
    const out = new Array(n).fill(false)
    for (let i = 0; i < n; i++) if (!props[i] && this.reach[i]) out[i] = true
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < n; i++) if (out[i - 1] && !props[i]) out[i] = true
      for (let i = n - 2; i >= 0; i--) if (out[i + 1] && !props[i]) out[i] = true
    }
    return out
  }

  private roadRow(z: number): Row {
    const row = this.blankRow(z, 'road')
    const d = this.difficulty
    row.dir = this.rand() < 0.5 ? 1 : -1
    row.bug = this.pick(BUG_WEIGHTS)
    const length = BUGS[row.bug].length
    row.speed = (1.6 + this.rand() * 2.2 + d * 1.8) * (row.bug === 'centipede' ? 0.7 : 1)
    const most = row.bug === 'centipede' ? 2 : 3
    const n = this.int(1, most)
    const spacing = LOOP / n
    const start = this.between(-SPAN, SPAN)
    for (let i = 0; i < n; i++) {
      const jitter = this.between(0, Math.max(0, spacing - length - 4))
      row.movers.push({ x: wrap(start + i * spacing + jitter), length, sink: 0, kind: 0 })
    }
    this.reach = new Array(EDGE * 2 + 1).fill(true)
    if (this.rand() < 0.06) row.token = this.int(-EDGE, EDGE)
    return row
  }

  private railRow(z: number): Row {
    const row = this.blankRow(z, 'rail')
    row.dir = this.rand() < 0.5 ? 1 : -1
    row.rail = { state: 'idle', timer: this.between(1, 6), x: 0, cars: [] }
    this.reach = new Array(EDGE * 2 + 1).fill(true)
    return row
  }

  private waterRow(z: number, prev: Row | undefined): Row {
    const row = this.blankRow(z, 'water')
    const d = this.difficulty
    const padsBefore = prev?.kind === 'water' && prev.pads.length > 0
    const logsBefore = prev?.kind === 'water' && prev.movers.length > 0
    if (!padsBefore && this.rand() < 0.3) {
      // lily pads, at least one reachable from the row before
      const reachable = this.reach.map((ok, i) => (ok ? i - EDGE : null)).filter((x): x is number => x !== null)
      const first = reachable.length > 0 ? reachable[this.int(0, reachable.length - 1)]! : 0
      const pads = new Set([first])
      for (let i = this.int(1, 3); i > 0; i--) pads.add(this.int(-EDGE, EDGE))
      row.pads = [...pads].sort((a, b) => a - b)
      row.padSink = row.pads.map(() => 0)
      this.reach = new Array(EDGE * 2 + 1).fill(false)
      for (const x of row.pads) {
        this.reach[x + EDGE] = true
        this.keepClear.add(x)
      }
      return row
    }
    row.dir = logsBefore ? (-prev!.dir as 1 | -1) : this.rand() < 0.5 ? 1 : -1
    row.speed = 1.0 + this.rand() * 1.4 + d * 0.9
    let pos = this.between(0, LOOP)
    const start = pos
    while (true) {
      const kind = this.int(0, 2)
      const length = kind + 2
      if (pos - start + length > LOOP - 1.5) break
      row.movers.push({ x: wrap(pos + length / 2), length, sink: 0, kind })
      pos += length + this.between(1.5, 3.6 + d)
    }
    this.reach = new Array(EDGE * 2 + 1).fill(true)
    this.keepClear.clear()
    return row
  }

  // Adds rows until the strip reaches well past the top of the view.
  private fill() {
    while (this.nextZ < this.camZ + this.viewHalfRows + 26) this.cluster()
    for (const z of [...this.rows.keys()]) if (z < this.camZ - this.viewHalfRows - 12) this.rows.delete(z)
  }

  private cluster() {
    const d = this.difficulty
    let kind: RowKind
    if (this.lastCluster !== 'grass' && this.rand() < 0.72) kind = 'grass'
    else {
      const options: [RowKind, number][] = [
        ['road', 0.42],
        ['water', 0.3],
        ['rail', 0.16 + d * 0.12],
      ]
      kind = this.pick(options.filter(([k]) => k !== this.lastCluster))
    }
    this.lastCluster = kind
    const count =
      kind === 'grass'
        ? this.rand() < 0.65
          ? 1
          : this.int(2, 3)
        : kind === 'road'
          ? Math.min(5, this.int(1, 2 + Math.round(d * 2)))
          : kind === 'water'
            ? Math.min(4, this.int(1, 2 + Math.round(d)))
            : this.rand() < 0.35
              ? 2
              : 1
    for (let i = 0; i < count; i++) {
      const z = this.nextZ
      const prev = this.rows.get(z - 1)
      const row =
        kind === 'grass'
          ? this.grassRow(z, 'random')
          : kind === 'road'
            ? this.roadRow(z)
            : kind === 'rail'
              ? this.railRow(z)
              : this.waterRow(z, prev)
      this.addRow(row)
    }
    // a row of lily pads at the end of a river leaves its tiles open on the grass after it
    if (kind !== 'water') this.keepClear.clear()
  }

  // ---- queries ----

  row(z: number): Row | undefined {
    return this.rows.get(z)
  }

  private blocked(x: number, z: number): boolean {
    const row = this.rows.get(z)
    if (!row) return true
    if (row.kind === 'water') return Math.abs(x) > EDGE + 0.5
    if (Math.abs(x) > EDGE) return true
    return row.kind === 'grass' && row.props[Math.round(x) + SPAN] !== null
  }

  private standY(): number {
    if (this.riding) return LOG_TOP - this.riding.mover.sink * 0.06
    if (this.onPad) return PAD_TOP - this.onPad.row.padSink[this.onPad.index]! * 0.05
    const row = this.rows.get(Math.round(this.z))
    return row ? groundY(row.kind) : 0
  }

  // ---- input ----

  input(dir: Dir) {
    if (this.phase === 'dying' || this.phase === 'over') return
    if (this.hopT >= 0) {
      if (this.hopT < 0.5) {
        this.queued = dir
        return
      }
      this.finishHop()
      if (this.phase !== 'play') return
    }
    this.hop(dir)
  }

  private face(dir: Dir) {
    const target = dir === 'up' ? 0 : dir === 'down' ? Math.PI : dir === 'right' ? Math.PI / 2 : -Math.PI / 2
    let delta = target - this.yaw
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    this.yawFrom = this.yaw
    this.yawTo = this.yaw + delta
    this.yawT = 0
  }

  private hop(dir: Dir) {
    this.face(dir)
    const dz = dir === 'up' ? 1 : dir === 'down' ? -1 : 0
    const dx = dir === 'right' ? 1 : dir === 'left' ? -1 : 0
    const tz = Math.round(this.z) + dz
    const target = this.rows.get(tz)
    // on water the character keeps its place across; on land it lines up with the tiles
    let tx = this.x + dx
    // off a log near the edge, land on the nearest tile inside the playfield
    if (!target || target.kind !== 'water' || target.pads.length > 0) tx = Math.max(-EDGE, Math.min(EDGE, Math.round(tx)))
    if (dx !== 0 && Math.abs(this.x + dx) > EDGE + 0.5 && target?.kind !== 'water') tx = this.x + dx
    if (target?.kind === 'water' && target.pads.length > 0) {
      const near = target.pads.reduce((a, b) => (Math.abs(b - tx) < Math.abs(a - tx) ? b : a))
      if (Math.abs(near - this.x - dx) < 0.75) tx = near
    }
    if (this.blocked(tx, tz)) {
      this.bump = 1
      return
    }
    if (this.phase === 'title') {
      this.phase = 'play'
      this.phaseTime = 0
    }
    this.fromX = this.x
    this.fromY = this.y
    this.fromZ = this.z
    this.toX = tx
    this.toZ = tz
    this.toY = target ? (target.kind === 'water' ? (target.pads.length > 0 ? PAD_TOP : LOG_TOP) : groundY(target.kind)) : 0
    this.hopT = 0
    this.riding = null
    this.onPad = null
    this.hops++
    this.events.push({ type: 'hop' })
  }

  private finishHop() {
    this.hopT = -1
    this.x = this.toX
    this.z = this.toZ
    this.y = this.toY
    this.land = 1
    this.landed()
  }

  private landed() {
    const z = Math.round(this.z)
    const row = this.rows.get(z)
    if (!row) return
    if (z > this.score) {
      this.score = z
      if (!this.beatBest && this.best > 0 && this.score > this.best) {
        this.beatBest = true
        this.events.push({ type: 'best', score: this.score })
      }
    }
    if (row.kind === 'water') {
      if (row.pads.length > 0) {
        const index = row.pads.findIndex(p => Math.abs(p - this.x) < 0.45)
        if (index >= 0) {
          this.onPad = { row, index }
          row.padSink[index] = 1
          this.x = row.pads[index]!
          return
        }
      } else {
        const mover = row.movers.find(m => Math.abs(wrap(this.x - m.x)) < m.length / 2 + 0.12)
        if (mover) {
          this.riding = { row, mover }
          mover.sink = 1
          // stay on the log, even when landing on its very end
          const off = wrap(this.x - mover.x)
          const limit = mover.length / 2 - 0.3
          if (Math.abs(off) > limit) this.x = mover.x + Math.sign(off) * limit
          return
        }
      }
      this.die('drown', null)
      return
    }
    if (row.token !== null && Math.round(this.x) === row.token) {
      row.token = null
      this.tokens++
      this.tokensTotal++
      this.events.push({ type: 'token', total: this.tokensTotal })
      this.popups.push({ x: this.x, y: this.y + 1.1, z: this.z, text: '+1', t: 0 })
      this.burst(this.x, this.y + 0.5, this.z, [0xf9ca24, 0xffe66d, 0xffffff], 9, 3.5, 0.06, true)
    }
  }

  // ---- update ----

  update(dt: number) {
    dt = Math.min(dt, 0.1)
    this.time += dt
    this.phaseTime += dt
    this.moveWorld(dt)
    if (this.phase === 'play' || this.phase === 'title') this.moveCharacter(dt)
    if (this.phase === 'play') {
      this.checkHits()
      this.moveCamera(dt)
    } else if (this.phase === 'title') {
      this.moveCamera(dt)
    } else if (this.phase === 'dying') {
      this.animateDeath(dt)
      if (this.phaseTime > OVER_DELAY) {
        this.phase = 'over'
        this.phaseTime = 0
        if (this.score > this.best) this.best = this.score
        this.events.push({ type: 'over' })
      }
    } else if (this.phase === 'over') {
      this.animateDeath(dt)
    }
    this.moveParticles(dt)
    this.shake = Math.max(0, this.shake - dt * 3)
    this.fill()
  }

  private moveWorld(dt: number) {
    for (const row of this.rows.values()) {
      for (const m of row.movers) {
        m.x = wrap(m.x + row.dir * row.speed * dt)
        m.sink = Math.max(0, m.sink - dt * 4)
      }
      for (let i = 0; i < row.padSink.length; i++) row.padSink[i] = Math.max(0, row.padSink[i]! - dt * 4)
      const rail = row.rail
      if (!rail) continue
      rail.timer -= dt
      if (rail.state === 'idle' && rail.timer <= 0) {
        rail.state = 'warn'
        rail.timer = 1.1
      } else if (rail.state === 'warn' && rail.timer <= 0) {
        rail.state = 'pass'
        const n = this.int(3, 5)
        const colors: TrainCar[] = ['passing', 'passing', 'failing', 'pending']
        rail.cars = ['engine', ...Array.from({ length: n }, () => colors[this.int(0, 3)]!)]
        rail.x = -row.dir * (SPAN + 2)
        if (Math.abs(row.z - this.z) < this.viewHalfRows + 3) this.shake = Math.max(this.shake, 0.35)
      } else if (rail.state === 'pass') {
        rail.x += row.dir * TRAIN_SPEED * dt
        const back = rail.x - row.dir * rail.cars.length * TRAIN_CAR
        if (back * row.dir > SPAN + 2) {
          rail.state = 'idle'
          rail.timer = this.between(2.5, 7 - this.difficulty * 2.5)
          rail.cars = []
        }
      }
    }
  }

  private moveCharacter(dt: number) {
    if (this.yawT < 1) {
      this.yawT = Math.min(1, this.yawT + dt / 0.08)
      this.yaw = this.yawFrom + (this.yawTo - this.yawFrom) * this.yawT
    }
    this.land = Math.max(0, this.land - dt / 0.14)
    this.bump = Math.max(0, this.bump - dt / 0.18)
    if (this.hopT >= 0) {
      this.hopT += dt / HOP
      if (this.hopT >= 1) {
        this.finishHop()
        if (this.queued && this.phase === 'play') {
          const q = this.queued
          this.queued = null
          this.hop(q)
        }
      } else {
        const t = this.hopT
        this.x = this.fromX + (this.toX - this.fromX) * t
        this.z = this.fromZ + (this.toZ - this.fromZ) * t
        this.y = this.fromY + (this.toY - this.fromY) * t + HOP_HEIGHT * Math.sin(Math.PI * t)
      }
      return
    }
    if (this.riding) {
      const { row } = this.riding
      this.x += row.dir * row.speed * dt
      if (Math.abs(this.x) > EDGE + 0.85) {
        this.riding = null
        this.die('edge', null)
        return
      }
    }
    this.y = this.standY()
  }

  private checkHits() {
    if (this.phase !== 'play') return
    const z = Math.round(this.z)
    const row = this.rows.get(z)
    if (!row) return
    const airborne = this.hopT > 0.15 && this.hopT < 0.85
    if (row.kind === 'road') {
      for (const m of row.movers) {
        const off = wrap(this.x - m.x)
        if (Math.abs(off) < m.length / 2 + BODY - 0.05) {
          if (airborne && Math.abs(this.toZ - this.fromZ) > 0) this.die('sideswipe', row.bug, row, m)
          else this.die('squash', row.bug, row, m)
          return
        }
      }
    } else if (row.kind === 'rail' && row.rail?.state === 'pass') {
      const front = row.rail.x
      const back = front - row.dir * row.rail.cars.length * TRAIN_CAR
      if (this.x > Math.min(front, back) - BODY && this.x < Math.max(front, back) + BODY) this.die('train', null, row)
    }
    if (this.z < this.camZ - DANGER && !this.cursor) this.die('cursor', null)
  }

  private moveCamera(dt: number) {
    const d = this.difficulty
    if (this.phase === 'play') this.camZ += (0.36 + d * 0.3) * dt
    if (this.z > this.camZ) this.camZ += (this.z - this.camZ) * Math.min(1, dt * 4)
    const pan = Math.max(0, EDGE + 0.8 - this.viewHalfX)
    const goal = Math.max(-pan, Math.min(pan, this.x))
    this.camX += (goal - this.camX) * Math.min(1, dt * 5)
  }

  // ---- dying ----

  private die(kind: DeathKind, by: BugKind | null, row: Row | null = null, mover: Mover | null = null) {
    if (this.phase !== 'play') return
    this.phase = 'dying'
    this.phaseTime = 0
    this.queued = null
    this.death = { kind, t: 0, by, row, mover, offset: 0 }
    this.events.push({ type: 'death', kind, by })
    if (kind === 'sideswipe' && row && mover) {
      // stuck flat to the bug's side
      this.hopT = -1
      const side = Math.sign(wrap(this.x - mover.x)) || -row.dir
      this.death.offset = side * (mover.length / 2 + 0.1)
      this.z = row.z
      this.y = groundY(row.kind) + 0.15
      this.yaw = side > 0 ? Math.PI / 2 : -Math.PI / 2
    } else if (kind === 'squash') {
      this.hopT = -1
      if (row) this.z = row.z
      this.y = row ? groundY(row.kind) : 0
    } else if (kind === 'train' && row) {
      this.hopT = -1
      this.shake = 1
      this.burst(this.x, this.y + 0.4, row.z, [0xffffff, 0xdfe6e9], 6, 4, 0.08, false, row.dir * 8)
    } else if (kind === 'drown' || kind === 'edge') {
      this.hopT = -1
      this.splash(this.x, this.z)
    } else if (kind === 'cursor') {
      this.hopT = -1
      this.cursor = { t: 0, x: this.x, y: 4, z: this.z + 8, grabbed: false }
    }
  }

  private animateDeath(dt: number) {
    const death = this.death
    if (!death) return
    death.t += dt
    if (death.kind === 'sideswipe' && death.mover) this.x = death.mover.x + death.offset
    if (death.kind === 'drown' || death.kind === 'edge') {
      this.y = Math.max(-1.2, this.y - dt * 2.2)
      if (death.kind === 'edge' && death.t < 0.1) this.x += Math.sign(this.x) * dt * 2
    }
    const c = this.cursor
    if (c) {
      c.t += dt
      // swoop down from the top of the screen, grab, and carry off past the bottom
      c.z -= (c.grabbed ? 9 : 12) * dt
      if (!c.grabbed && c.z <= this.z) {
        c.grabbed = true
        this.shake = 0.5
      }
      if (c.grabbed) {
        c.y += 1.6 * dt
        this.x = c.x
        this.y = c.y - 0.75
        this.z = c.z - 0.15
      } else {
        c.y = Math.max(this.y + 0.75, 4 - (8 - (c.z - this.z)) * 0.45)
      }
    }
  }

  // ---- particles ----

  private burst(
    x: number,
    y: number,
    z: number,
    colors: number[],
    count: number,
    speed: number,
    size: number,
    emissive: boolean,
    push = 0,
  ) {
    for (let i = 0; i < count; i++) {
      const a = this.rand() * Math.PI * 2
      const s = speed * (0.4 + this.rand() * 0.6)
      this.particles.push({
        x,
        y,
        z,
        vx: Math.cos(a) * s + push,
        vy: speed * (0.8 + this.rand()),
        vz: Math.sin(a) * s,
        life: 0,
        max: 0.6 + this.rand() * 0.5,
        color: colors[i % colors.length]!,
        size: size * (0.6 + this.rand() * 0.8),
        spin: this.rand() * 10,
        floor: groundY(this.rows.get(Math.round(z))?.kind ?? 'grass'),
        emissive,
      })
    }
  }

  splash(x: number, z: number) {
    const colors = [0xffffff, 0xd6f0ff, 0x9fd8ff]
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      const s = 1 + this.rand() * 1.5
      this.particles.push({
        x: x + Math.cos(a) * 0.15,
        y: groundY('water'),
        z: z + Math.sin(a) * 0.15,
        vx: Math.cos(a) * s,
        vy: 4 + this.rand() * 3,
        vz: Math.sin(a) * s,
        life: 0,
        max: 0.7 + this.rand() * 0.3,
        color: colors[i % 3]!,
        size: 0.05 + this.rand() * 0.05,
        spin: 0,
        floor: groundY('water') - 0.2,
        emissive: false,
      })
    }
  }

  // Bits of the character flying apart; the scene picks the colors.
  shatter(colors: number[]) {
    this.burst(this.x, this.y + 0.3, this.z, colors, 18, 4.5, 0.07, false)
  }

  private moveParticles(dt: number) {
    const ps = this.particles
    let n = 0
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]!
      p.life += dt
      if (p.life >= p.max) continue
      p.vy -= GRAVITY * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      if (p.y < p.floor) {
        p.y = p.floor
        p.vy = -p.vy * 0.3
        p.vx *= 0.6
        p.vz *= 0.6
      }
      ps[n++] = p
    }
    ps.length = n
    const pops = this.popups
    let k = 0
    for (let i = 0; i < pops.length; i++) {
      const p = pops[i]!
      p.t += dt
      p.y += dt * 1.2
      if (p.t < 0.9) pops[k++] = p
    }
    pops.length = k
  }

  // The squash and stretch to draw the character with: [across, up, along].
  pose(): [number, number, number] {
    if (this.death?.kind === 'squash') return [1.7, 0.08, 1.7]
    if (this.death?.kind === 'sideswipe') return [1.25, 1.25, 0.1]
    if (this.hopT >= 0) {
      const s = Math.sin(Math.PI * this.hopT)
      return [1 - 0.1 * s, 1 + 0.25 * s, 1 - 0.1 * s]
    }
    const l = this.land * this.land
    const b = Math.sin(this.bump * Math.PI) * 0.12
    // a slow breath while waiting to start
    const idle = this.phase === 'title' ? Math.sin(this.time * 3) * 0.03 : 0
    return [1 + 0.15 * l + b - idle, 1 - 0.25 * l - b + idle, 1 + 0.15 * l + b - idle]
  }

  drainEvents(): GameEvent[] {
    const out = this.events
    this.events = []
    return out
  }
}

export function wrap(x: number): number {
  let v = (x + SPAN) % LOOP
  if (v < 0) v += LOOP
  return v - SPAN
}
