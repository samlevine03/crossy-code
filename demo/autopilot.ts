// Demo-only autopilot: reads the live game state and picks a hop that stays safe for a while.

import { EDGE, SPAN, wrap } from '../hooks/game'
import type { Dir, Game, Row } from '../hooks/game'
import { TRAIN_CAR } from '../hooks/models'

const HOP = 0.16
const BODY = 0.3
const DWELL = 0.55
const STEP = 0.02

type Move = { dir: Dir | null; x: number; z: number }

function target(g: Game, dir: Dir | null): Move | null {
  if (!dir) return { dir, x: g.x, z: Math.round(g.z) }
  const dz = dir === 'up' ? 1 : dir === 'down' ? -1 : 0
  const dx = dir === 'right' ? 1 : dir === 'left' ? -1 : 0
  const tz = Math.round(g.z) + dz
  const row = g.row(tz)
  if (!row) return null
  let tx = g.x + dx
  if (row.kind !== 'water' || row.pads.length > 0) tx = Math.max(-EDGE, Math.min(EDGE, Math.round(tx)))
  if (row.kind === 'water' && row.pads.length > 0) {
    const near = row.pads.reduce((a, b) => (Math.abs(b - tx) < Math.abs(a - tx) ? b : a))
    if (Math.abs(near - g.x - dx) < 0.75) tx = near
  }
  if (row.kind === 'water') {
    if (Math.abs(tx) > EDGE + 0.5) return null
  } else if (Math.abs(tx) > EDGE || (row.kind === 'grass' && row.props[Math.round(tx) + SPAN] !== null)) return null
  return { dir, x: tx, z: tz }
}

// Is standing at x on this row safe from t0 to t1 seconds from now?
function safe(row: Row, x: number, t0: number, t1: number, landAt: number): boolean {
  if (row.kind === 'grass') return true
  if (row.kind === 'road') {
    for (let t = t0; t <= t1; t += STEP)
      for (const m of row.movers) if (Math.abs(wrap(x - (m.x + row.dir * row.speed * t))) < m.length / 2 + BODY + 0.2) return false
    return true
  }
  if (row.kind === 'rail') {
    const rail = row.rail!
    if (rail.state === 'idle') return rail.timer + 1.1 > t1 + 0.4
    if (rail.state === 'warn') return rail.timer > t1 + 0.4
    for (let t = t0; t <= t1 + 0.3; t += STEP) {
      const front = rail.x + row.dir * 30 * t
      const back = front - row.dir * rail.cars.length * TRAIN_CAR
      if (x > Math.min(front, back) - BODY - 0.4 && x < Math.max(front, back) + BODY + 0.4) return false
    }
    return true
  }
  // water: something to land on, and no drifting off the edge
  if (row.pads.length > 0) return row.pads.some(p => Math.abs(p - x) < 0.4)
  const on = row.movers.find(m => Math.abs(wrap(x - (m.x + row.dir * row.speed * landAt))) < m.length / 2 - 0.15)
  if (!on) return false
  return Math.abs(x + row.dir * row.speed * (t1 - landAt)) < EDGE + 0.4
}

function moveSafe(g: Game, m: Move): boolean {
  const row = g.row(m.z)
  if (!row) return false
  if (!m.dir) return safe(row, m.x, 0, DWELL * 0.7, 0)
  return safe(row, m.x, HOP * 0.4, HOP + DWELL, HOP)
}

// Which tiles can lead somewhere, ignoring anything that moves: a few rows of lookahead.
const AHEAD = 5
function open(row: Row | undefined, x: number): boolean {
  if (!row || Math.abs(x) > EDGE) return false
  if (row.kind === 'grass') return row.props[x + SPAN] === null
  if (row.kind === 'water' && row.pads.length > 0) return row.pads.includes(x)
  return true
}
function goodRows(g: Game): Map<number, boolean[]> {
  const z0 = Math.round(g.z)
  const out = new Map<number, boolean[]>()
  let above = new Array(EDGE * 2 + 1).fill(true)
  for (let z = z0 + AHEAD; z >= z0; z--) {
    const row = g.row(z)
    const ok = above.map((_, i) => open(row, i - EDGE))
    const good = ok.map((o, i) => o && above[i])
    // spread along each open segment, except across pads and logs where sideways hops are risky
    if (row && !(row.kind === 'water')) {
      for (let i = 1; i < good.length; i++) if (ok[i] && good[i - 1]) good[i] = true
      for (let i = good.length - 2; i >= 0; i--) if (ok[i] && good[i + 1]) good[i] = true
    }
    if (row && row.kind === 'water' && row.pads.length === 0) good.fill(above.some(Boolean))
    out.set(z, good)
    above = good
  }
  return out
}

export class Autopilot {
  wait = 0

  decide(g: Game, dt: number): Dir | null {
    this.wait -= dt
    if (g.phase !== 'play' || g.hopT >= 0 || this.wait > 0) return null
    const z = Math.round(g.z)
    const good = goodRows(g)
    const here = good.get(z)!
    const next = good.get(z + 1)!
    const xi = Math.max(-EDGE, Math.min(EDGE, Math.round(g.x)))
    const onLog = g.row(z)?.kind === 'water' && g.row(z)!.pads.length === 0
    // the nearest column on this row from which up leads somewhere
    let goal = xi
    if (!next[xi + EDGE] && !onLog) {
      let bestD = 99
      for (let i = 0; i < next.length; i++) {
        const x = i - EDGE
        if (!next[i] || !here[i]) continue
        // the way along the row must be open
        let clear = true
        for (let k = Math.min(x, xi); k <= Math.max(x, xi); k++) if (!open(g.row(z), k)) clear = false
        if (clear && Math.abs(x - xi) < bestD) {
          bestD = Math.abs(x - xi)
          goal = x
        }
      }
    }
    const urgent = g.z < g.camZ - 1.6
    const stay = target(g, null)!
    let best: Dir | null = null
    let score = moveSafe(g, stay) ? 3 : -100
    const consider = (dir: Dir, value: number) => {
      const m = target(g, dir)
      if (!m || !moveSafe(g, m)) return
      if (value > score) {
        score = value
        best = dir
      }
    }
    const up = target(g, 'up')
    if (up && (next[Math.round(up.x) + EDGE] || g.row(z + 1)?.kind === 'water')) consider('up', 10)
    if (goal !== xi) consider(goal < xi ? 'left' : 'right', 6)
    else if (!onLog) {
      // drift toward the middle now and then, and pick up tokens beside us
      for (const dir of ['left', 'right'] as const) {
        const m = target(g, dir)
        if (!m) continue
        const tok = g.row(z)?.token === Math.round(m.x)
        consider(dir, (tok ? 3.5 : 0) + (Math.abs(m.x) < Math.abs(g.x) && Math.abs(g.x) > 2 ? 3.2 : 0) + (urgent ? 0 : 0))
      }
    }
    if (onLog) {
      // ride toward the middle rather than off the edge
      const row = g.row(z)!
      if (Math.abs(g.x) > EDGE - 1.2 && Math.sign(g.x) === row.dir) consider(g.x > 0 ? 'left' : 'right', 5)
    }
    consider('down', -50)
    if (best) this.wait = best === 'up' ? 0.08 + Math.random() * 0.14 : 0.1
    return best
  }
}
