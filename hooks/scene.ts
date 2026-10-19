// Turns the game's state into draw calls, and draws the score and banners on top.

import { drawCentered, drawText, textWidth } from './font'
import { EDGE, LOG_TOP, PAD_TOP, SPAN, groundY } from './game'
import type { DeathKind, Game, Row } from './game'
import {
  BIT,
  BUGS,
  CHARACTERS,
  CURSOR,
  FLOWERS,
  LILY_PAD,
  LOGS,
  PROPS,
  RACK_LEDS,
  SIGNAL,
  TOKEN,
  TRAIN,
  TRAIN_CAR,
  TUFT,
} from './models'
import type { BugKind, Character } from './models'
import {
  FLAG_EMISSIVE,
  FLAG_GROUND,
  FLAG_WATER,
  RIGHT,
  ROW_RISE,
  Renderer,
  TILE_ACROSS,
  UP,
  VIEW,
  compose,
} from './render'
import type { Mat, Model } from './render'

// ---- ground ----

const HALF = 1 / 2
const FAR = 14

function boxes(list: number[][]): Model {
  const out = new Float32Array(list.length * 8)
  list.forEach((b, i) => out.set(b, i * 8))
  return out
}

const GRASS = [0xaee665, 0x9cd352]
const GRASS_ROWS = GRASS.map(c => boxes([[-FAR, -0.7, -HALF, FAR, 0, HALF, c, FLAG_GROUND]]))

const ROAD = boxes([[-FAR, -0.7, -HALF, FAR, groundY('road'), HALF, 0x3b3f4a, FLAG_GROUND]])
// lane markings on the line between two roads
const DASHES = boxes(
  Array.from({ length: FAR * 2 }, (_, i) => {
    const x = -FAR + i + 0.25
    return [x, groundY('road'), HALF - 0.035, x + 0.5, groundY('road') + 0.008, HALF + 0.035, 0x8b93a7, FLAG_GROUND]
  }),
)
// the curb along a road's edge, where it meets something else
const CURB = boxes([[-FAR, groundY('road'), -HALF, FAR, groundY('road') + 0.02, -HALF + 0.06, 0x595f6e, FLAG_GROUND]])

const RAIL_Y = groundY('rail')
const RAIL = boxes([
  [-FAR, -0.7, -HALF, FAR, RAIL_Y, HALF, 0x8d7f73, FLAG_GROUND],
  ...Array.from({ length: FAR * 4 }, (_, i) => {
    const x = -FAR + i * 0.5 + 0.16
    return [x, RAIL_Y, -0.36, x + 0.18, RAIL_Y + 0.04, 0.36, 0x6d4c33, FLAG_GROUND]
  }),
  [-FAR, RAIL_Y + 0.04, -0.26, FAR, RAIL_Y + 0.1, -0.2, 0xc8d0d8],
  [-FAR, RAIL_Y + 0.04, 0.2, FAR, RAIL_Y + 0.1, 0.26, 0xc8d0d8],
])

const WATER_Y = groundY('water') - 0.05
const WATER = boxes([[-FAR, -0.9, -HALF, FAR, WATER_Y, HALF, 0x5ec8f2, FLAG_GROUND | FLAG_WATER]])

// tokens, lamps and rack lights that glow
const GLOW = (c: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
  boxes([[x0, y0, z0, x1, y1, z1, c, FLAG_EMISSIVE]])

const U = 1 / 16
const LAMP_RED = GLOW(0xff3b30, -2.2 * U, 20 * U, -1.8 * U, -0.6 * U, 23 * U, -1.5 * U)
const LAMP_RED_B = GLOW(0xff3b30, 0.6 * U, 20 * U, -1.8 * U, 2.2 * U, 23 * U, -1.5 * U)
const LAMP_GREEN = GLOW(0x2ecc71, -2.2 * U, 20 * U, -1.8 * U, -0.6 * U, 23 * U, -1.5 * U)
const LAMP_DARK = boxes([
  [-2.2 * U, 20 * U, -1.8 * U, -0.6 * U, 23 * U, -1.5 * U, 0x3a2526, 0],
  [0.6 * U, 20 * U, -1.8 * U, 2.2 * U, 23 * U, -1.5 * U, 0x3a2526, 0],
])
const LAMP_DARK_B = boxes([[0.6 * U, 20 * U, -1.8 * U, 2.2 * U, 23 * U, -1.5 * U, 0x3a2526, 0]])

const LED_COLORS = [0x2ecc71, 0x2ecc71, 0x2ecc71, 0xf1c40f, 0x3498db]
const LEDS = LED_COLORS.map(c =>
  boxes(RACK_LEDS.map(([x, y]) => [x * U, y * U, -6.4 * U, (x + 1) * U, (y + 1) * U, -6.2 * U, c, FLAG_EMISSIVE])),
)
const LED_ONE = LED_COLORS.map(c => boxes([[0, 0, -6.4 * U, U, U, -6.2 * U, c, FLAG_EMISSIVE]]))

const TOP_LINE = boxes(
  Array.from({ length: 18 }, (_, i) => {
    const x = -EDGE - 0.5 + i * 0.5
    return [x + 0.06, 0.005, -0.05, x + 0.38, 0.03, 0.05, i % 2 ? 0xffffff : 0xf9ca24, FLAG_GROUND | FLAG_EMISSIVE]
  }),
)

const SPARK = boxes([[-U, -U, -U, U, U, U, 0xffffff, FLAG_EMISSIVE]])

// A matrix that turns a flat sprite to face the camera, its x along the screen's right and y up.
function billboard(x: number, y: number, z: number, s: number): Mat {
  const m = new Float64Array(12)
  m[0] = RIGHT[0] * s
  m[1] = UP[0] * s
  m[2] = -VIEW[0] * s
  m[3] = x
  m[4] = RIGHT[1] * s
  m[5] = UP[1] * s
  m[6] = -VIEW[1] * s
  m[7] = y
  m[8] = RIGHT[2] * s
  m[9] = UP[2] * s
  m[10] = -VIEW[2] * s
  m[11] = z
  return m
}

function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// ---- the camera ----

export type View = { scale: number; lookAhead: number; halfX: number; halfRows: number }

export function viewFor(width: number, height: number): View {
  // at least 7.5 tiles across (the camera pans for the rest) and 9 rows up the screen
  const scale = Math.min(width / (7.5 * TILE_ACROSS), height / (9 * ROW_RISE))
  const halfRows = height / 2 / (scale * ROW_RISE)
  return {
    scale,
    lookAhead: Math.max(0.6, Math.min(3.2, halfRows - 3.6)),
    halfX: width / 2 / (scale * TILE_ACROSS),
    halfRows,
  }
}

// ---- the world ----

export function drawWorld(r: Renderer, g: Game, who: Character, view: View) {
  g.viewHalfX = view.halfX
  g.viewHalfRows = view.halfRows
  const t = g.time
  const shake = g.shake * g.shake * 0.12
  const target: [number, number, number] = [
    g.camX + Math.sin(t * 61) * shake,
    Math.cos(t * 53) * shake * 0.5,
    g.camZ + view.lookAhead + Math.sin(t * 47 + 1) * shake,
  ]
  r.begin(target, view.scale, t)
  const top = Math.ceil(target[2] + view.halfRows + 2)
  const bottom = Math.floor(target[2] - view.halfRows - 3)
  const left = target[0] - view.halfX - 1.5
  const right = target[0] + view.halfX + 1.5
  r.flowBase = bottom
  r.flowRows.fill(0)

  for (let z = bottom; z <= top; z++) {
    const row = g.row(z)
    if (!row) continue
    drawRow(r, g, row, left, right, t)
  }

  // a line across the world where the last top score was
  if (g.best > 0 && g.best >= bottom && g.best <= top) {
    const row = g.row(g.best)
    r.draw(TOP_LINE, compose(0, row ? groundY(row.kind) : 0, g.best + HALF - 0.05))
  }

  drawCharacter(r, g, who)

  const c = g.cursor
  if (c) r.draw(CURSOR, billboard(c.x - 0.05, c.y + 0.1, c.z, 0.7))

  for (const p of g.particles) {
    const fade = p.life / p.max
    const s = (p.size / 0.0625) * (fade > 0.7 ? (1 - fade) / 0.3 : 1)
    if (s <= 0.01) continue
    const m = compose(p.x, p.y, p.z, p.spin * p.life, s, s, s, p.spin * p.life * 0.7)
    if (p.emissive) r.draw(SPARK, m, p.color, 1)
    else r.draw(BIT, m, p.color, 1)
  }
  r.render()
}

function drawRow(r: Renderer, g: Game, row: Row, left: number, right: number, t: number) {
  const z = row.z
  const at = compose(0, 0, z)
  switch (row.kind) {
    case 'grass': {
      r.draw(GRASS_ROWS[z & 1]!, at)
      for (const d of row.decor) {
        if (d.x < left || d.x > right) continue
        const model = d.kind === 3 ? TUFT : d.kind === 0 ? TUFT : FLOWERS[d.kind - 1]!
        r.draw(model, compose(d.x, 0, z + d.dz, d.x * 7))
      }
      const x0 = Math.max(-SPAN, Math.floor(left))
      const x1 = Math.min(SPAN, Math.ceil(right))
      for (let x = x0; x <= x1; x++) {
        const kind = row.props[x + SPAN]
        if (!kind) continue
        const m = compose(x, 0, z)
        r.draw(PROPS[kind], m)
        if (kind === 'rack') drawLeds(r, m, x, z, t)
      }
      break
    }
    case 'road': {
      r.draw(ROAD, at)
      const next = g.row(z + 1)
      if (next?.kind === 'road') r.draw(DASHES, at)
      const prev = g.row(z - 1)
      if (prev?.kind !== 'road') r.draw(CURB, at)
      const bug = BUGS[row.bug]
      const yaw = row.dir > 0 ? Math.PI / 2 : -Math.PI / 2
      const step = Math.floor(t * row.speed * 5) & 1
      for (const m of row.movers) {
        if (m.x + m.length / 2 < left || m.x - m.length / 2 > right) continue
        const mat = compose(m.x, groundY('road'), z, yaw)
        r.draw(bug.body, mat)
        r.draw(step ? bug.legsA : bug.legsB, mat)
      }
      break
    }
    case 'rail': {
      r.draw(RAIL, at)
      const rail = row.rail!
      const post = compose(-EDGE - 0.75, 0, z - 0.38)
      r.draw(SIGNAL, compose(-EDGE - 0.75, RAIL_Y, z - 0.38))
      if (rail.state === 'idle') {
        r.draw(LAMP_GREEN, post)
        r.draw(LAMP_DARK_B, post)
      } else {
        const on = Math.floor(t / 0.2) & 1
        r.draw(on ? LAMP_RED : LAMP_RED_B, post)
        r.draw(on ? LAMP_DARK_B : LAMP_DARK, post)
      }
      if (rail.state === 'pass') {
        const yaw = row.dir > 0 ? Math.PI / 2 : -Math.PI / 2
        rail.cars.forEach((car, i) => {
          const x = rail.x - row.dir * (i + 0.5) * TRAIN_CAR
          if (x + TRAIN_CAR < left || x - TRAIN_CAR > right) return
          r.draw(TRAIN[car], compose(x, RAIL_Y + 0.04, z, yaw))
        })
      }
      break
    }
    case 'water': {
      r.draw(WATER, at)
      r.flowRows[(z - r.flowBase) & 63] = row.pads.length > 0 ? 0.15 : row.dir * row.speed
      for (const m of row.movers) {
        if (m.x + m.length / 2 < left || m.x - m.length / 2 > right) continue
        const bob = Math.sin(t * 2.2 + m.x * 0.3 + z) * 0.012
        r.draw(LOGS[m.kind]!, compose(m.x, LOG_TOP - 0.25 - m.sink * 0.06 + bob, z))
      }
      row.pads.forEach((x, i) => {
        const sink = row.padSink[i]! * 0.05
        r.draw(LILY_PAD, compose(x, PAD_TOP - 0.035 - sink, z, (x * 1.7 + z * 0.9) % (Math.PI * 2)))
      })
      break
    }
  }
  if (row.token !== null) {
    const bob = Math.sin(t * 3 + row.token) * 0.06
    r.draw(TOKEN, compose(row.token, groundY(row.kind) + 0.42 + bob, z, t * 3))
  }
}

function drawLeds(r: Renderer, m: Mat, x: number, z: number, t: number) {
  // most lights hold steady; one per rack blinks like disk activity
  r.draw(LEDS[Math.floor(hash(x, z) * 3)]!, m)
  const blink = Math.floor(t * 6 + hash(z, x) * 20)
  if (blink & 1) {
    const [lx, ly] = RACK_LEDS[blink % RACK_LEDS.length]!
    const color = LED_ONE[3 + (blink & 2 ? 1 : 0)]!
    const mm = new Float64Array(m)
    mm[3]! += (lx + 1.5) * U
    mm[7]! += (ly - 0.5) * U
    r.draw(color, mm)
  }
}

function drawCharacter(r: Renderer, g: Game, who: Character) {
  const death = g.death
  if (death?.kind === 'train') return
  if ((death?.kind === 'drown' || death?.kind === 'edge') && g.y < -1) return
  const [sx, sy, sz] = g.pose()
  const m = compose(g.x, g.y, g.z, g.yaw, sx, sy, sz)
  r.draw(who.model, m, 0, 0, who.alpha ?? 1)
}

// ---- words ----

const BUG_NAMES: Record<BugKind, string> = {
  ladybug: 'ladybug',
  beetle: 'beetle',
  roach: 'cockroach',
  centipede: 'centipede',
}

export function deathBanner(kind: DeathKind): string {
  switch (kind) {
    case 'squash':
      return 'SEGFAULT'
    case 'sideswipe':
      return 'RACE CONDITION'
    case 'train':
      return 'MERGE CONFLICT'
    case 'drown':
      return '/DEV/NULL'
    case 'edge':
      return 'OUT OF BOUNDS'
    case 'cursor':
      return 'SIGKILL'
  }
}

export function deathLine(kind: DeathKind, by: BugKind | null): string {
  const bug = by ? BUG_NAMES[by] : 'bug'
  switch (kind) {
    case 'squash':
      return `Segmentation fault: squashed by a ${bug}.`
    case 'sideswipe':
      return `Race condition: hopped right into a ${bug}.`
    case 'train':
      return 'Run over by the merge train.'
    case 'drown':
      return 'Piped to /dev/null.'
    case 'edge':
      return 'Index out of range: a log carried you off the screen.'
    case 'cursor':
      return 'Killed for idling: the cursor came for you.'
  }
}

// ---- the overlay ----

const INK = 0x1b1b1f
const GOLD = 0xf9ca24
const ORANGE = 0xd97757

export type Hud = {
  paused: boolean
  // frame rate and timing, shown when asked for
  stats?: string[]
  // seconds left to flash "NEW TOP!"
  newBest: number
}

function coin(r: Renderer, x: number, y: number) {
  const art = ['.ooo.', 'oo*oo', 'o***o', 'oo*oo', '.ooo.']
  art.forEach((line, j) =>
    [...line].forEach((ch, i) => {
      if (ch === '.') return
      r.pixel(x + i, y + j, ch === 'o' ? GOLD : ORANGE)
    }),
  )
  for (const [dx, dy] of [
    [1, -1],
    [2, -1],
    [3, -1],
    [-1, 1],
    [-1, 2],
    [-1, 3],
    [5, 1],
    [5, 2],
    [5, 3],
    [1, 5],
    [2, 5],
    [3, 5],
  ] as const)
    r.pixel(x + dx, y + dy, INK)
}

export function drawHud(r: Renderer, g: Game, hud: Hud) {
  const w = r.width
  const big = w >= 64 ? 2 : 1
  const t = g.time

  // floating "+1"s over picked-up tokens
  for (const p of g.popups) {
    const [px, py] = r.project(p.x, p.y, p.z)
    drawCentered(r, p.text, Math.round(px), Math.round(py), { color: GOLD, outline: INK, alpha: Math.min(1, 1.6 - p.t * 1.6) })
  }

  if (g.phase !== 'title') {
    drawText(r, String(g.score), 2, 2, { scale: big, color: 0xffffff, outline: INK })
    const best = Math.max(g.best, g.score)
    drawText(r, `TOP ${best}`, 2, 3 + 7 * big + 2, { color: 0xffffff, outline: INK })
    if (hud.newBest > 0 && Math.floor(t * 6) % 2 === 0)
      drawText(r, 'NEW TOP!', 2, 3 + 7 * big + 12, { color: GOLD, outline: INK })
  }

  const count = String(g.tokensTotal)
  const tw = textWidth(count)
  drawText(r, count, w - tw - 3, 3, { color: GOLD, outline: INK })
  coin(r, w - tw - 11, 4)

  if (hud.stats) {
    const bottom = r.height - (g.phase === 'title' ? 18 : 9)
    hud.stats.forEach((line, i) => drawText(r, line, 2, bottom - (hud.stats!.length - 1 - i) * 9, { color: 0xffffff, outline: INK }))
  }
  if (g.phase === 'title') drawTitle(r, t)
  if (g.phase === 'over' && g.death) {
    const appear = Math.min(1, g.phaseTime / 0.25)
    drawBanner(r, deathBanner(g.death.kind), `SCORE ${g.score}`, appear)
  } else if (hud.paused) {
    drawBanner(r, 'PAUSED', 'P TO RESUME', 1)
  }
}

function drawTitle(r: Renderer, t: number) {
  const w = r.width
  const scale = [3, 2, 1].find(s => textWidth('<CODE/>', s) + s * 2 + 4 <= w && 7 * s * 2 + 10 <= r.height * 0.45) ?? 1
  const y = Math.max(3, Math.round(r.height * 0.1))
  // a little bounce on the logo, like the game's own
  const lift = Math.round(Math.abs(Math.sin(t * 2.4)) * scale)
  drawCentered(r, 'CROSSY', w / 2, y - lift, {
    scale,
    color: 0xffffff,
    shadow: 0x2d3436,
    shadowDepth: scale,
    outline: INK,
  })
  drawCentered(r, '<CODE/>', w / 2, y + 8 * scale + 2 - lift, {
    scale,
    color: ORANGE,
    shadow: 0x7a3a24,
    shadowDepth: scale,
    outline: INK,
  })
  const hop = textWidth('PRESS W TO HOP') + 4 <= w ? 'PRESS W TO HOP' : 'W TO HOP'
  if (Math.floor(t * 2) % 2 === 0) drawCentered(r, hop, w / 2, y + 16 * scale + 6, { color: 0xffffff, outline: INK })
  drawCentered(r, textWidth('C: CHARACTERS') + 4 <= w ? 'C: CHARACTERS' : 'C: CHARS', w / 2, r.height - 9, { color: 0xdfe6e9, outline: INK })
}

function drawBanner(r: Renderer, title: string, sub: string, appear: number) {
  const w = r.width
  // as big as fits; a title too wide for one line goes on two
  const scale = textWidth(title, 2) + 8 <= w ? 2 : 1
  const lines = textWidth(title, scale) + 4 <= w ? [title] : title.split(' ')
  const lineH = 8 * scale + 1
  const bandH = lines.length * lineH + 20
  const y = Math.round(r.height * 0.4 - bandH / 2 + (1 - appear) * 6)
  r.rect(0, y, w, bandH, INK, 0.62 * appear)
  r.rect(0, y, w, 1, ORANGE, appear)
  r.rect(0, y + bandH - 1, w, 1, ORANGE, appear)
  lines.forEach((line, i) =>
    drawCentered(r, line, w / 2, y + 5 + i * lineH, { scale, color: 0xffffff, shadow: 0xc0392b, shadowDepth: scale, alpha: appear }),
  )
  drawCentered(r, sub, w / 2, y + bandH - 11, { color: GOLD, alpha: appear })
}

// ---- choosing a character ----

export type Picker = { index: number; owned: Set<string>; selected: string; tokens: number; spin: number }

export function drawPicker(r: Renderer, p: Picker, time: number) {
  const w = r.width
  const h = r.height
  const big = w >= 90 && h >= 90 ? 2 : 1
  // the models stand between the heading and the two lines under them
  const top = 12
  const bottom = h - (big === 2 ? 30 : 22)
  const mid = (top + bottom) / 2
  const scale = Math.max(4, Math.min(w / 5, (bottom - top) / 1.7))
  const ty = 0.45 - (h / 2 - mid) / (UP[1] * scale)
  r.begin([0, ty, 0], scale, time)
  r.flowRows.fill(0)
  const n = CHARACTERS.length
  for (let i = -3; i <= 3; i++) {
    const c = CHARACTERS[(((p.index + i) % n) + n) % n]!
    const x = i * 1.6
    r.draw(PEDESTAL[i === 0 ? 1 : 0]!, compose(x, -0.1, 0))
    const spin = i === 0 ? Math.PI - 0.5 + p.spin : Math.PI * 0.85
    const hop = i === 0 ? Math.abs(Math.sin(time * 4)) * 0.18 : 0
    const s = i === 0 ? 1.15 : 0.85
    const m = compose(x, hop, 0, spin, s, s * (1 + hop * 0.6), s)
    if (p.owned.has(c.id)) r.draw(c.model, m, 0, 0, c.alpha ?? 1)
    else r.draw(c.model, m, 0x2d3436, 0.88)
  }
  r.render()
  const c = CHARACTERS[p.index]!
  const owned = p.owned.has(c.id)
  const name = textWidth(c.name.toUpperCase(), big) + 4 <= w ? c.name.toUpperCase() : c.name.toUpperCase().split(' ')[0]!
  drawCentered(r, name, w / 2, bottom + 2, { scale: big, color: 0xffffff, outline: INK })
  const line = owned ? (p.selected === c.id ? 'PLAYING' : 'OWNED') : `${c.price}`
  const lw = textWidth(line) + (owned ? 0 : 8)
  const lx = Math.round(w / 2 - lw / 2)
  const ly = bottom + 7 * big + 5
  if (!owned) coin(r, lx, ly + 1)
  drawText(r, line, lx + (owned ? 0 : 8), ly, { color: owned ? 0xdfe6e9 : p.tokens >= c.price ? GOLD : 0xff7675, outline: INK })
  const arrowY = Math.round(mid - 3)
  drawText(r, '<', 2, arrowY, { color: 0xffffff, outline: INK })
  drawText(r, '>', w - 7, arrowY, { color: 0xffffff, outline: INK })
  const count = String(p.tokens)
  const tw = textWidth(count)
  drawText(r, count, w - tw - 3, 3, { color: GOLD, outline: INK })
  coin(r, w - tw - 11, 4)
  if (textWidth('CHARACTERS') + tw + 18 <= w) drawText(r, 'CHARACTERS', 2, 3, { color: 0xffffff, outline: INK })
}

const PEDESTAL = [
  boxes([
    [-0.55, -0.4, -0.55, 0.55, 0.1, 0.55, 0x9dd655, 0],
    [-0.6, -0.6, -0.6, 0.6, -0.4, 0.6, 0x7a4f2a, 0],
  ]),
  boxes([
    [-0.55, -0.4, -0.55, 0.55, 0.1, 0.55, 0xa8e05f, 0],
    [-0.6, -0.6, -0.6, 0.6, -0.4, 0.6, ORANGE, 0],
  ]),
]

