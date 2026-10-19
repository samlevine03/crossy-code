import { expect, test } from 'claude-code/testing'

import { EDGE, Game, SPAN } from '../hooks/game'
import type { Row } from '../hooks/game'

const STEP = 1 / 30

function run(g: Game, seconds: number) {
  for (let t = 0; t < seconds; t += STEP) g.update(STEP)
}

// The first row of a kind ahead of the start, with the start area's grass behind it.
function firstRow(g: Game, kind: Row['kind'], ok: (row: Row) => boolean = () => true): Row {
  for (let z = 4; z < 400; z++) {
    if (!g.row(z)) {
      g.camZ = z - 10
      g.update(0)
    }
    const row = g.row(z)
    if (row?.kind === kind && ok(row)) return row
  }
  throw new Error(`no ${kind} row`)
}

function standOn(g: Game, z: number, x = 0) {
  g.phase = 'play'
  g.x = x
  g.z = z
  g.camZ = z
}

test('a hop forward lands one row on and scores it', () => {
  const g = new Game(1, 0, 0)
  g.input('up')
  expect(g.phase).toBe('play')
  run(g, 0.3)
  expect(g.z).toBe(1)
  expect(g.score).toBe(1)
})

test('a tree in the way turns the hop into a bump', () => {
  const g = new Game(1, 0, 0)
  g.row(1)!.props[0 + SPAN] = 'tree'
  g.input('up')
  run(g, 0.3)
  expect(g.z).toBe(0)
  expect(g.phase).toBe('title')
})

test('the playfield edge stops sideways hops on land', () => {
  const g = new Game(1, 0, 0)
  for (let i = 0; i < EDGE + 3; i++) {
    g.input('right')
    run(g, 0.3)
  }
  expect(g.x).toBe(EDGE)
})

test('standing in a lane until a bug comes is a squash', () => {
  const g = new Game(3, 0, 0)
  const road = firstRow(g, 'road')
  standOn(g, road.z, 0)
  const deaths: string[] = []
  for (let t = 0; t < 30 && deaths.length === 0; t += STEP) {
    g.update(STEP)
    for (const e of g.drainEvents()) if (e.type === 'death') deaths.push(e.kind)
  }
  expect(deaths).toEqual(['squash'])
})

test('hopping into open water is a drowning', () => {
  const g = new Game(5, 0, 0)
  const water = firstRow(g, 'water', row => row.pads.length > 0)
  const gap = [-4, -3, -2, -1, 0, 1, 2, 3, 4].find(x => !water.pads.includes(x))!
  standOn(g, water.z - 1, gap)
  g.row(water.z - 1)!.kind = 'grass'
  g.input('up')
  run(g, 0.3)
  expect(g.death?.kind).toBe('drown')
})

test('a log carries whoever lands on it', () => {
  const g = new Game(5, 0, 0)
  const water = firstRow(g, 'water', row => row.movers.length > 0)
  const log = water.movers[0]!
  standOn(g, water.z - 1, 0)
  // put the log under the landing spot and let it drift
  log.x = 0
  g.input('up')
  run(g, 0.2)
  expect(g.riding?.mover).toBe(log)
  const x = g.x
  run(g, 0.5)
  expect(Math.sign(g.x - x)).toBe(water.dir)
})

test('idling lets the camera pass and the cursor take you', () => {
  const g = new Game(1, 0, 0)
  g.input('up')
  run(g, 20)
  expect(g.death?.kind).toBe('cursor')
  expect(g.phase).toBe('over')
})

test('every grass row leaves a way through, and lily pads line up with open grass', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = new Game(seed, 0, 0)
    for (let z = 4; z < 300; z++) {
      if (!g.row(z)) {
        g.camZ = z - 10
        g.update(0)
      }
      const row = g.row(z)!
      const open = (r: Row, x: number) => r.props[x + SPAN] === null
      if (row.kind === 'grass') {
        expect([-4, -3, -2, -1, 0, 1, 2, 3, 4].some(x => open(row, x))).toBe(true)
      }
      const prev = g.row(z - 1)!
      if (row.kind === 'water' && row.pads.length > 0 && prev.kind === 'grass') {
        expect(row.pads.some(x => open(prev, x))).toBe(true)
      }
      const next = g.row(z + 1)
      if (row.kind === 'water' && row.pads.length > 0 && next?.kind === 'grass') {
        expect(row.pads.some(x => open(next, x))).toBe(true)
      }
    }
  }
})
