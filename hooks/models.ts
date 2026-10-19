// Voxel models, written as boxes in sixteenths of a tile.
//
// Each model stands on y = 0, is centered on x and z, and faces +z.

import { FLAG_EMISSIVE, FLAG_GROUND } from './render'
import type { Model } from './render'

const U = 1 / 16

type Box = [number, number, number, number, number, number, number, number?]

function model(boxes: Box[]): Model {
  const out = new Float32Array(boxes.length * 8)
  boxes.forEach((b, i) => {
    out.set([b[0] * U, b[1] * U, b[2] * U, b[3] * U, b[4] * U, b[5] * U, b[6], b[7] ?? 0], i * 8)
  })
  return out
}

// Mirrors boxes across x = 0.
function mirror(boxes: Box[]): Box[] {
  return boxes.map(([x0, y0, z0, x1, y1, z1, c, f]) => [-x1, y0, z0, -x0, y1, z1, c, f] as Box)
}

function both(boxes: Box[]): Box[] {
  return [...boxes, ...mirror(boxes)]
}

// ---- characters ----

export type CharacterId = 'clawd' | 'duck' | 'ferris' | 'robot' | 'coffee' | 'floppy' | 'ghost' | 'penguin'

export type Character = {
  id: CharacterId
  name: string
  blurb: string
  price: number
  model: Model
  // the color its debris flies apart in
  bits: number[]
  alpha?: number
}

const CLAUDE = 0xd97757
const CLAUDE_DARK = 0xb85f42
const INK = 0x1b1b1f

const clawd = model([
  [-6, 3, -4.5, 6, 10, 4.5, CLAUDE],
  // eyes, as the banner's notches
  [-3.5, 6.5, 4.5, -1.5, 9, 4.9, INK],
  [1.5, 6.5, 4.5, 3.5, 9, 4.9, INK],
  // arms
  ...both([[6, 5, -1.5, 8, 7.5, 1.5, CLAUDE]]),
  // four legs in a row, as in the banner
  ...both([
    [3.5, 0, -1, 5, 3, 1, CLAUDE_DARK],
    [1.5, 0, -1, 3, 3, 1, CLAUDE_DARK],
  ]),
])

const DUCK = 0xffd43b
const duck = model([
  [-5, 0, -6, 5, 7, 5, DUCK],
  [-4, 7, -6, 4, 8.5, 3, DUCK],
  [-2, 7, -7.5, 2, 10, -5, DUCK],
  [-3.5, 8, -0.5, 3.5, 14, 5.5, DUCK],
  [-2, 9.5, 5.5, 2, 11.5, 8.5, 0xff8c1a],
  [-1.5, 9.5, 8.5, 1.5, 10.5, 9.5, 0xf76707],
  ...both([[3.5, 11, 2.5, 3.8, 12.5, 4, INK]]),
  ...both([[5, 2, -3, 5.6, 5.5, 2, 0xfcc419]]),
])

const RUST = 0xf74c00
const RUST_DARK = 0xc23b00
const ferris = model([
  [-6, 2.5, -4, 6, 7, 4, RUST],
  [-5, 7, -3, 5, 8, 3, RUST],
  // eye stalks
  ...both([
    [1.75, 8, 1.5, 3.25, 10.5, 3, RUST_DARK],
    [1.25, 10.5, 1, 3.75, 13, 3.5, 0xffffff],
    [1.9, 11, 3.5, 3.1, 12.5, 3.8, INK],
  ]),
  // claws
  ...both([
    [6, 3.5, 1, 8, 5.5, 3, RUST_DARK],
    [7, 3, 3, 10, 7, 6, RUST],
    [7, 4.5, 6, 8.5, 7, 8, RUST],
    [8.5, 3, 6, 10, 5, 7.5, RUST],
  ]),
  // legs
  ...both([
    [6, 0, -3.5, 8.5, 3, -2.5, RUST_DARK],
    [6, 0, -1.5, 8.5, 3, -0.5, RUST_DARK],
    [6, 0, 0.5, 8, 3, 1.25, RUST_DARK],
  ]),
  [-3, 5, 4, -1.5, 6, 4.3, INK],
  [1.5, 5, 4, 3, 6, 4.3, INK],
  [-1.5, 4, 4, 1.5, 4.6, 4.3, INK],
])

const robot = model([
  ...both([[1, 0, -2, 4, 2.5, 2.5, 0x4b5563]]),
  [-5, 2.5, -3.5, 5, 10, 3.5, 0x9aa5b1],
  [-3, 4.5, 3.5, 3, 8, 3.8, 0x6b7280],
  [-2, 6, 3.8, -0.5, 7, 4, 0x2ecc71, FLAG_EMISSIVE],
  [0.5, 6, 3.8, 2, 7, 4, 0xf1c40f, FLAG_EMISSIVE],
  ...both([[5, 4.5, -1.5, 7, 9, 1.5, 0x6b7280]]),
  [-4, 10, -3.5, 4, 15, 3.5, 0x7b8794],
  [-3, 11.5, 3.5, 3, 13.5, 3.9, 0x22d3ee, FLAG_EMISSIVE],
  [-0.5, 15, -0.5, 0.5, 18, 0.5, 0x4b5563],
  [-1, 18, -1, 1, 20, 1, 0xff4d4f, FLAG_EMISSIVE],
])

const coffee = model([
  [-5, 0, -5, 5, 11, 5, 0xf1f2f6],
  [-5.15, 4, -5.15, 5.15, 6, 5.15, CLAUDE],
  [-4, 10.5, -4, 4, 11.15, 4, 0x6f4e37],
  // handle
  [5, 3, -1, 8, 4.5, 1, 0xe4e6ec],
  [5, 8.5, -1, 8, 10, 1, 0xe4e6ec],
  [6.5, 4.5, -1, 8, 8.5, 1, 0xe4e6ec],
  // face
  [-3, 7.5, 5, -1.5, 9, 5.3, INK],
  [1.5, 7.5, 5, 3, 9, 5.3, INK],
  // steam
  [-2, 12.5, -0.5, -1, 15, 0.5, 0xffffff, FLAG_EMISSIVE],
  [1, 13.5, -0.5, 2, 16.5, 0.5, 0xffffff, FLAG_EMISSIVE],
])

const floppy = model([
  [-6, 1.5, -1, 6, 13.5, 1, 0x3451d1],
  [-6, 1.5, -1, -4.5, 3, 1.1, 0x2541b2],
  // shutter and hub on the back
  [-3, 9, -1.3, 3.5, 13.5, -1, 0xc8ccd4],
  [0.5, 10, -1.5, 2, 12.5, -1.3, 0x7d8592],
  [-1.5, 4, -1.3, 1.5, 7, -1, 0xc8ccd4],
  // label and face on the front
  [-4.5, 2.5, 1, 4.5, 9, 1.3, 0xf8f9fa],
  [-4.5, 7.5, 1.3, 4.5, 8.2, 1.4, 0xff6b6b],
  [-2.5, 4.5, 1.3, -1, 6, 1.5, INK],
  [1, 4.5, 1.3, 2.5, 6, 1.5, INK],
  ...both([[2, 0, -0.75, 3.5, 1.5, 0.75, 0x2541b2]]),
])

const GHOST = 0xf5f6ff
const ghost = model([
  [-5, 3, -5, 5, 13, 5, GHOST],
  [-4, 13, -4, 4, 15, 4, GHOST],
  [-5, 1, -5, -2.5, 3, 5, GHOST],
  [0, 1, -5, 2.5, 3, 5, GHOST],
  [-2.5, 2, -5, 0, 3, 5, GHOST],
  [2.5, 2, -5, 5, 3, 5, GHOST],
  [-3.5, 8, 5, -1.5, 11.5, 5.3, INK],
  [1.5, 8, 5, 3.5, 11.5, 5.3, INK],
  [-1, 5.5, 5, 1, 7, 5.3, INK],
  ...both([[5, 7, -1.5, 6.5, 10, 1.5, GHOST]]),
])

const penguin = model([
  [-5, 1, -4, 5, 13, 4, 0x2d3436],
  [-4, 13, -3.5, 4, 14.5, 3.5, 0x2d3436],
  [-3.5, 2, 4, 3.5, 10.5, 4.3, 0xf8f9fa],
  ...both([[1.25, 10.5, 4, 3, 12.5, 4.3, 0xf8f9fa]]),
  ...both([[1.75, 11, 4.3, 2.5, 12, 4.5, INK]]),
  [-1.5, 9, 4, 1.5, 10.5, 6.5, 0xfd9644],
  ...both([[5, 4, -2, 6.5, 10, 2, 0x1e272e]]),
  ...both([[1, 0, -1, 4, 1, 5, 0xfd9644]]),
])

export const CHARACTERS: Character[] = [
  { id: 'clawd', name: 'Clawd', blurb: 'Ships it.', price: 0, model: clawd, bits: [CLAUDE, CLAUDE_DARK, 0xf0a58a] },
  { id: 'duck', name: 'Rubber Duck', blurb: 'Listens to your bugs.', price: 50, model: duck, bits: [DUCK, 0xff8c1a] },
  { id: 'ferris', name: 'Ferris', blurb: 'Fearless concurrency.', price: 100, model: ferris, bits: [RUST, RUST_DARK] },
  { id: 'robot', name: 'CI Bot', blurb: 'All checks have passed.', price: 100, model: robot, bits: [0x9aa5b1, 0x22d3ee] },
  { id: 'coffee', name: 'Cold Brew', blurb: 'Turns into code.', price: 150, model: coffee, bits: [0xf1f2f6, 0x6f4e37] },
  { id: 'floppy', name: 'Save Icon', blurb: 'Ctrl+S, obviously.', price: 150, model: floppy, bits: [0x3451d1, 0xf8f9fa] },
  { id: 'penguin', name: 'Kernel Hacker', blurb: 'Compiles from source.', price: 200, model: penguin, bits: [0x2d3436, 0xf8f9fa, 0xfd9644] },
  { id: 'ghost', name: 'Zombie Process', blurb: 'Kill -9 it. Go on.', price: 300, model: ghost, bits: [GHOST, 0xdfe4ea], alpha: 0.8 },
]

export function character(id: string): Character {
  return CHARACTERS.find(c => c.id === id) ?? CHARACTERS[0]!
}

// ---- bugs (the traffic) ----

export type BugKind = 'ladybug' | 'beetle' | 'roach' | 'centipede'

// A bug is a body and two sets of legs that step in turn.
export type BugModel = { body: Model; legsA: Model; legsB: Model; length: number }

function legs(zs: number[], reach: number, color: number, side: 1 | -1, start: number): Box[] {
  return zs
    .filter((_, i) => (i + start) % 2 === 0)
    .map(z => {
      const x0 = side > 0 ? reach - 2.5 : -reach
      const x1 = side > 0 ? reach : -reach + 2.5
      return [x0, 0, z - 0.75, x1, 3.5, z + 0.75, color] as Box
    })
}

function gait(zs: number[], reach: number, color: number): [Box[], Box[]] {
  return [
    [...legs(zs, reach, color, 1, 0), ...legs(zs, reach, color, -1, 1)],
    [...legs(zs, reach, color, 1, 1), ...legs(zs, reach, color, -1, 0)],
  ]
}

function bug(body: Box[], zs: number[], reach: number, legColor: number, length: number): BugModel {
  const [a, b] = gait(zs, reach, legColor)
  return { body: model(body), legsA: model(a), legsB: model(b), length }
}

const ladybug = bug(
  [
    [-6, 2.5, -6, 6, 9, 5, 0xe53935],
    [-5, 9, -5, 5, 10.5, 4, 0xef5350],
    [-0.5, 2.5, -6.2, 0.5, 10.7, 4.2, INK],
    ...both([
      [2, 10.5, -3.5, 4, 10.8, -1.5, INK],
      [1.5, 10.5, 1, 3.5, 10.8, 3, INK],
      [6, 5, -3, 6.2, 7, -1, INK],
    ]),
    [-4, 2.5, 5, 4, 7.5, 8, INK],
    ...both([
      [1.5, 5, 8, 3, 6.5, 8.3, 0xffffff],
      [1.5, 7, 7, 2, 11, 7.5, INK],
    ]),
  ],
  [-3.5, 0, 3.5],
  7.5,
  INK,
  1,
)

const beetle = bug(
  [
    [-6, 2.5, -9, 6, 8.5, 6, 0x1e8449],
    [-5, 8.5, -8, 5, 10, 5, 0x27ae60],
    [-0.4, 2.5, -9.2, 0.4, 10.2, 5.2, 0x145a32],
    ...both([[1.5, 10, -6, 3, 10.3, 3, 0x58d68d]]),
    [-4.5, 2.5, 6, 4.5, 7.5, 9.5, 0x0b3d20],
    ...both([
      [1.5, 5, 9.5, 3, 6.5, 9.8, 0xf4d03f, FLAG_EMISSIVE],
      [2.5, 3.5, 9.5, 4, 5, 13, 0x0b3d20],
    ]),
  ],
  [-5.5, -1, 3.5],
  7.5,
  0x0b3d20,
  1.3,
)

const roach = bug(
  [
    [-6, 2, -12, 6, 6.5, 8, 0x6d4c41],
    [-5, 6.5, -11, 5, 7.5, 7, 0x8d6e63],
    [-0.4, 2, -12.2, 0.4, 7.7, 7.2, 0x4e342e],
    [-4.5, 2, 8, 4.5, 6, 11, 0x4e342e],
    ...both([
      [1.5, 4, 11, 3, 5.5, 11.3, 0xffffff],
      [1.5, 5, 11, 2, 5.6, 19, 0x4e342e],
      [4, 3, -15, 4.6, 3.6, -11, 0x4e342e],
    ]),
  ],
  [-8, -2, 4],
  8,
  0x3e2723,
  1.6,
)

function centipedeBody(): Box[] {
  const out: Box[] = []
  const seg = 7
  for (let i = 0; i < 6; i++) {
    const z0 = -24 + i * (seg + 1)
    const color = i % 2 === 0 ? 0xff7043 : 0xf4511e
    out.push([-6, 2, z0, 6, 8.5, z0 + seg, color])
    out.push([-5, 8.5, z0 + 1, 5, 9.5, z0 + seg - 1, 0xffab91])
    out.push([-6.2, 3.5, z0 + 2, 6.2, 5, z0 + 5, 0xbf360c])
  }
  out.push([-5, 2, 24, 5, 8, 30, 0x3e2723])
  out.push(...both([
    [1.5, 5, 30, 3.5, 6.5, 30.3, 0xffee58, FLAG_EMISSIVE],
    [3, 2.5, 30, 5, 4, 33, 0x3e2723],
  ]))
  return out
}

const centipede = bug(
  centipedeBody(),
  [-20.5, -12.5, -4.5, 3.5, 11.5, 19.5],
  8,
  0x3e2723,
  3.8,
)

export const BUGS: Record<BugKind, BugModel> = { ladybug, beetle, roach, centipede }

// ---- the merge train ----

export const TRAIN_CAR = 2.5

const trainEngine = model([
  [-7, 0, -19, 7, 3, 19, 0x263238],
  [-6.5, 3, -19, 6.5, 13, 10, 0x6c5ce7],
  [-6.6, 7, -19.1, 6.6, 8.5, 10.1, 0xffffff],
  [-5.5, 3, 10, 5.5, 9, 18, 0x5847d6],
  [-4, 9, 12, 4, 10, 17, 0x463ab8],
  [-6, 13, -18, 6, 14.5, 9, 0x463ab8],
  ...both([
    [6.5, 9.5, -15, 6.8, 12, -11, 0xa5f3fc, FLAG_EMISSIVE],
    [6.5, 9.5, -9, 6.8, 12, -5, 0xa5f3fc, FLAG_EMISSIVE],
  ]),
  [-4, 9.5, 10, 4, 12, 10.2, 0xa5f3fc, FLAG_EMISSIVE],
  [-2, 5, 18, 2, 7.5, 18.4, 0xfff3b0, FLAG_EMISSIVE],
  [-6, 0, 18, 6, 2.5, 21, 0x95a5a6],
  [-1.5, 9, 13, 1.5, 15, 16, 0x2d3436],
  ...both([
    [6.5, 0, -15, 7.5, 3.5, -10, INK],
    [6.5, 0, -4, 7.5, 3.5, 1, INK],
    [6.5, 0, 8, 7.5, 3.5, 13, INK],
  ]),
])

function container(color: number, rib: number): Model {
  const boxes: Box[] = [
    [-7, 0, -19, 7, 3, 19, 0x263238],
    [-6.5, 3, -18, 6.5, 15, 18, color],
  ]
  for (let z = -15; z <= 15; z += 5) {
    boxes.push([-6.7, 3.5, z - 0.6, 6.7, 14.5, z + 0.6, rib])
  }
  boxes.push([-6.5, 15, -18, 6.5, 15.3, 18, rib])
  boxes.push(...both([
    [6.5, 0, -15, 7.5, 3.5, -10, INK],
    [6.5, 0, 10, 7.5, 3.5, 15, INK],
  ]))
  return model(boxes)
}

export const TRAIN = {
  engine: trainEngine,
  passing: container(0x2ecc71, 0x27ae60),
  failing: container(0xe74c3c, 0xc0392b),
  pending: container(0xf1c40f, 0xd4ac0d),
}

// ---- the river ----

export function log(length: number): Model {
  const half = (length * 16) / 2 - 0.5
  const boxes: Box[] = [
    [-half, -2.5, -5.5, half, 3, 5.5, 0x8d5a2b],
    [-half + 1, 3, -4.5, half - 1, 4, 4.5, 0x9c6a37],
    [-half - 0.4, -2, -5, -half, 2.5, 5, 0xd9a066],
    [half, -2, -5, half + 0.4, 2.5, 5, 0xd9a066],
    [-half - 0.5, -0.5, -2, -half - 0.4, 1.5, 2, 0xa9713a],
    [half + 0.4, -0.5, -2, half + 0.5, 1.5, 2, 0xa9713a],
  ]
  for (let x = -half + 3; x < half - 3; x += 7) {
    boxes.push([x, 4, -2.5, x + 3, 4.2, -1.5, 0x6f451f])
    boxes.push([x + 2, 4, 1.5, x + 5, 4.2, 2.5, 0x6f451f])
  }
  return model(boxes)
}

export const LOGS = [log(2), log(3), log(4)]

export const LILY_PAD = model([
  [-6, -0.5, -4, 6, 0.5, 4, 0x43a047],
  [-4, -0.5, -6, 4, 0.5, 6, 0x43a047],
  [-5, -0.5, -5, 5, 0.5, 5, 0x43a047],
  [-0.5, -0.4, 0, 0.5, 0.6, 6.2, 0x2e7d32],
  [-3, 0.5, -3, -1, 0.7, -1, 0x66bb6a],
])

// ---- tokens ----

export const TOKEN = model([
  [-3, -4, -0.75, 3, 4, 0.75, 0xf9ca24],
  [-4, -3, -0.75, 4, 3, 0.75, 0xf9ca24],
  [-3.5, -3.5, -0.8, 3.5, 3.5, 0.8, 0xf6b93b],
  [-0.75, -2.5, -1, 0.75, 2.5, 1, CLAUDE],
  [-2.5, -0.75, -1, 2.5, 0.75, 1, CLAUDE],
  [-1.75, -1.75, -0.9, 1.75, 1.75, 0.9, 0xe58e6e],
])

// ---- things on the grass ----

export type PropKind = 'tree' | 'tallTree' | 'rack' | 'box' | 'rock'

function tree(tall: boolean): Model {
  const top = tall ? 22 : 15
  const boxes: Box[] = [
    [-2, 0, -2, 2, 5, 2, 0x7a4f2a],
    [-6, 5, -6, 6, top, 6, 0x4caf50],
    [-5, top, -5, 5, top + 1.5, 5, 0x66bb6a],
    // the dependencies: little packages hanging on the tree
    [6, 7, -4, 6.6, 9, -2, 0xe74c3c],
    [6, top - 5, 1, 6.6, top - 3, 3, 0x3498db],
    [-2, 7, -6.6, 0, 9, -6, 0xf1c40f],
    [2, top - 4, -6.6, 4, top - 2, -6, 0x9b59b6],
  ]
  return model(boxes)
}

export const PROPS: Record<PropKind, Model> = {
  tree: tree(false),
  tallTree: tree(true),
  rack: model([
    [-6, 0, -6, 6, 24, 6, 0x2f3640],
    [-6.5, 23, -6.5, 6.5, 24.5, 6.5, 0x232831],
    [-5, 3, -6.2, 5, 5, -6, 0x57606f],
    [-5, 8, -6.2, 5, 10, -6, 0x57606f],
    [-5, 13, -6.2, 5, 15, -6, 0x57606f],
    [-5, 18, -6.2, 5, 20, -6, 0x57606f],
    [6, 2, -4, 6.2, 22, 4, 0x3d4450],
  ]),
  box: model([
    [-6.5, 0, -6.5, 6.5, 12, 6.5, 0xc8a165],
    [-1.5, 12, -6.6, 1.5, 12.2, 6.6, 0xe6d3a3],
    [-1.5, 0.5, -6.7, 1.5, 12, -6.5, 0xe6d3a3],
    [-5, 4, -6.8, 5, 9, -6.6, 0xf8f9fa],
    [-4, 7, -6.9, 3, 7.6, -6.8, 0x34495e],
    [-4, 5.5, -6.9, 1, 6.1, -6.8, 0x2ecc71],
  ]),
  rock: model([
    [-6, 0, -5, 6, 7, 5, 0x95a5a6],
    [-4.5, 7, -4, 4.5, 10, 4, 0xa5b1b2],
    [2, 0, -6, 6.5, 5, -2, 0x7f8c8d],
    [-6.5, 0, 1, -2, 4, 5.5, 0x839192],
  ]),
}

// Where each rack's lights sit, on its front face.
export const RACK_LEDS: [number, number][] = [
  [-4, 3.5],
  [-2.5, 3.5],
  [-4, 8.5],
  [-4, 13.5],
  [-2.5, 13.5],
  [-4, 18.5],
]

export const TUFT = model([
  [-1.5, 0, -0.5, -0.5, 2, 0.5, 0x7cb342, FLAG_GROUND],
  [0, 0, -0.5, 1, 3, 0.5, 0x7cb342, FLAG_GROUND],
  [1.5, 0, 0, 2.5, 1.5, 1, 0x7cb342, FLAG_GROUND],
])

export function flower(color: number): Model {
  return model([
    [-0.4, 0, -0.4, 0.4, 2.5, 0.4, 0x558b2f, FLAG_GROUND],
    [-1.2, 2.5, -1.2, 1.2, 3.5, 1.2, color, FLAG_GROUND],
    [-0.5, 3.5, -0.5, 0.5, 3.8, 0.5, 0xfff176, FLAG_GROUND],
  ])
}

export const FLOWERS = [flower(0xff6b9d), flower(0xffffff), flower(0x74b9ff)]

// The railway's status light: a post and a head; the lamps are drawn each frame.
export const SIGNAL = model([
  [-0.75, 0, -0.75, 0.75, 18, 0.75, 0x57606f],
  [-3, 18, -1.5, 3, 25, 1.5, 0x1e272e],
  [-3.5, 25, -2, 3.5, 25.5, 2, 0x1e272e],
  [-2, 0, -2, 2, 1, 2, 0x57606f],
])

// ---- the cursor that swoops on idle players ----

const CURSOR_ART = [
  'B           ',
  'BB          ',
  'BWB         ',
  'BWWB        ',
  'BWWWB       ',
  'BWWWWB      ',
  'BWWWWWB     ',
  'BWWWWWWB    ',
  'BWWWWWWWB   ',
  'BWWWWWWWWB  ',
  'BWWWWWWWWWB ',
  'BWWWWWWBBBBB',
  'BWWWBWWB    ',
  'BWWBBWWB    ',
  'BWB  BWWB   ',
  'BB   BWWB   ',
  'B     BWWB  ',
  '      BWWB  ',
  '       BB   ',
]

// The tip is at the origin; the arrow hangs down and to the right in the xy plane.
function cursor(): Model {
  const px = 2.5
  const boxes: Box[] = []
  CURSOR_ART.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]!
      if (ch === ' ') {
        x++
        continue
      }
      let end = x
      while (end < row.length && row[end] === ch) end++
      const color = ch === 'B' ? 0x111111 : 0xffffff
      boxes.push([x * px, -(y + 1) * px, -1.5, end * px, -y * px, 1.5, color, FLAG_EMISSIVE])
      x = end
    }
  })
  return model(boxes)
}

export const CURSOR = cursor()

// ---- particles ----

export const BIT = model([[-1, -1, -1, 1, 1, 1, 0xffffff]])
