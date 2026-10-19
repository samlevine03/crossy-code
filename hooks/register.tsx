// /crossy-code: a Crossy Road style game in a pane, drawn as half-block cells.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CrossySave, CrossyUi } from '../types'
import { Game } from './game'
import type { DeathKind, Dir } from './game'
import { CHARACTERS, character } from './models'
import { Renderer } from './render'
import { deathLine, drawHud, drawPicker, drawWorld, viewFor } from './scene'

const PANE = 'crossy-code'
const SCREEN = 'screen'
const FRAME_MS = 33
// the rows under the picture: the status line and the controls
const CHROME_ROWS = 2

const ui = atom({ plugin: 'crossy-code', key: 'ui' } as const, { screen: 'game', status: '' } as CrossyUi)

const TITLE_STATUS = 'Hop with w a s d. Click this line to use arrow keys or h j k l instead.'
const PLAY_STATUS = 'Keep moving: the cursor comes for anyone who idles.'

export function newSave(): CrossySave {
  return { best: 0, tokens: 0, owned: ['clawd'], selected: 'clawd', games: 0, hops: 0, deaths: {} }
}

// Fills in anything missing from a save written by an older version.
export function loadSave(raw: unknown): CrossySave {
  const base = newSave()
  if (!raw || typeof raw !== 'object') return base
  const s = raw as Partial<CrossySave>
  const owned = Array.isArray(s.owned) ? s.owned.filter(id => CHARACTERS.some(c => c.id === id)) : []
  if (!owned.includes('clawd')) owned.unshift('clawd')
  const selected = typeof s.selected === 'string' && owned.includes(s.selected) ? s.selected : 'clawd'
  return {
    best: typeof s.best === 'number' ? s.best : 0,
    tokens: typeof s.tokens === 'number' ? s.tokens : 0,
    owned,
    selected,
    games: typeof s.games === 'number' ? s.games : 0,
    hops: typeof s.hops === 'number' ? s.hops : 0,
    deaths: s.deaths && typeof s.deaths === 'object' ? { ...s.deaths } : {},
  }
}

// What a key means on each screen.
export type Action = Dir | 'pause' | 'chars' | 'retry' | 'quit' | 'go' | 'stats'

export function actionFor(key: string): Action | null {
  switch (key) {
    case 'f':
      return 'stats'
    case 'up':
    case 'w':
    case 'k':
      return 'up'
    case 'down':
    case 's':
    case 'j':
      return 'down'
    case 'left':
    case 'a':
    case 'h':
      return 'left'
    case 'right':
    case 'd':
    case 'l':
      return 'right'
    case 'return':
    case ' ':
    case 'space':
      return 'go'
    case 'p':
      return 'pause'
    case 'c':
      return 'chars'
    case 'r':
      return 'retry'
    case 'q':
      return 'quit'
    default:
      return null
  }
}

let save = newSave()
let game = new Game(Date.now() >>> 0, 0, 0)
const renderer = new Renderer()
let screen: CrossyUi['screen'] = 'game'
let paused = false
let newBest = 0
let pickIndex = 0
let spin = 0
let clock = 0

// the mounted Raster's size, and the frame loop that repaints it
let cols = 0
let rows = 0
let ss = 2
let slow = 0
let fast = 0
let loop: Timer | undefined
let wait = FRAME_MS / 2
let lastTick = 0
let last = 0
let inFlight = 0
let ticks = 0
let tps = 0
let showStats = false
let renderMs = 0
let fps = 0
let frames = 0
let fpsSince = 0

function who() {
  return character(save.selected)
}

async function persist($: EngineInterface) {
  await $.store.set('save', save)
}

async function setStatus($: EngineInterface, status: string) {
  await update($, ui, u => (u.status === status && u.screen === screen ? u : { screen, status }))
}

function restart() {
  game = new Game(Date.now() >>> 0, save.best, save.tokens)
  paused = false
  newBest = 0
}

function frame(): string {
  const t0 = performance.now()
  if (screen === 'picker') {
    drawPicker(renderer, { index: pickIndex, owned: new Set(save.owned), selected: save.selected, tokens: save.tokens, spin }, clock)
  } else {
    drawWorld(renderer, game, who(), viewFor(renderer.width, renderer.height))
    const stats = showStats ? [`${fps} FPS`, `${Math.round(renderMs)} MS ${ss}X`] : undefined
    drawHud(renderer, game, { paused, newBest, stats })
  }
  const ms = performance.now() - t0
  renderMs = renderMs * 0.9 + ms * 0.1
  adapt(ms)
  frames++
  if (t0 - fpsSince > 1000) {
    fps = Math.round((frames * 1000) / (t0 - fpsSince))
    tps = Math.round((ticks * 1000) / (t0 - fpsSince))
    frames = 0
    ticks = 0
    fpsSince = t0
  }
  return renderer.encode()
}

// Trades supersampling for speed: drop a level when frames run long, add one back when there is room.
function adapt(ms: number) {
  if (ms > FRAME_MS * 0.75) slow++
  else slow = Math.max(0, slow - 1)
  if (ms < FRAME_MS * 0.25) fast++
  else fast = 0
  if (slow > 8 && ss > 1) {
    ss--
    slow = 0
    renderer.resize(cols, rows, ss)
  } else if (fast > 90 && ss < 3) {
    ss++
    fast = 0
    renderer.resize(cols, rows, ss)
  }
}

async function step($: EngineInterface, dt: number) {
  clock += dt
  if (screen === 'picker') {
    spin += dt * 1.2
    return
  }
  if (paused) return
  game.update(dt)
  newBest = Math.max(0, newBest - dt)
  for (const ev of game.drainEvents()) {
    if (ev.type === 'death') {
      if (ev.kind === 'train') game.shatter(who().bits)
      await setStatus($, deathLine(ev.kind, ev.by))
    } else if (ev.type === 'over') {
      const kind: DeathKind = game.death?.kind ?? 'squash'
      save = {
        ...save,
        best: Math.max(save.best, game.score),
        tokens: game.tokensTotal,
        games: save.games + 1,
        hops: save.hops + game.hops,
        deaths: { ...save.deaths, [kind]: (save.deaths[kind] ?? 0) + 1 },
      }
      await persist($)
      await setStatus($, `${deathLine(kind, game.death?.by ?? null)} Score ${game.score}, top ${save.best}. Press w or r to go again.`)
    } else if (ev.type === 'token') {
      save = { ...save, tokens: ev.total }
    } else if (ev.type === 'best') {
      newBest = 2
    } else if (ev.type === 'hop' && game.hops === 1) {
      await setStatus($, PLAY_STATUS)
    }
  }
}

function stopLoop() {
  loop?.cancel()
  loop = undefined
}

// Each wait starts after the last frame's work, so the wait is cut by however late the frames have been coming.
function schedule($: EngineInterface) {
  loop = $.clock.after(Math.max(1, Math.round(wait)), () => {
    const now = performance.now()
    wait = Math.max(1, Math.min(FRAME_MS, wait + (FRAME_MS - (now - lastTick)) * 0.3))
    lastTick = now
    void tick($).finally(() => {
      if (loop) schedule($)
    })
  })
}

function startLoop($: EngineInterface) {
  if (loop) return
  last = performance.now()
  lastTick = last
  schedule($)
}

async function tick($: EngineInterface) {
  const now = performance.now()
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  ticks++
  await step($, dt)
  // blits resolve a frame or so later; keep two on the way at most rather than queue up
  if (inFlight >= 2 || cols === 0) return
  inFlight++
  void $.ui.blit({ requestId: PANE, key: SCREEN, cells: frame(), columns: cols, rows }).then(res => {
    inFlight--
    if (res.deny) {
      // closed, hidden or resized: stop until the pane is drawn again
      stopLoop()
      if (game.phase === 'play') paused = true
    }
  })
}

async function act($: EngineInterface, action: Action) {
  if (action === 'stats') {
    showStats = !showStats
    return
  }
  if (screen === 'picker') return pick($, action)
  if (action === 'quit') return close($)
  if (action === 'chars') {
    if (game.phase === 'play' && !paused) paused = true
    screen = 'picker'
    pickIndex = Math.max(0, CHARACTERS.findIndex(c => c.id === save.selected))
    await setStatus($, pickerStatus())
    return
  }
  if (action === 'pause') {
    if (game.phase !== 'play') return
    paused = !paused
    return
  }
  if (game.phase === 'over') {
    if (action === 'retry' || action === 'up' || action === 'go') {
      restart()
      await setStatus($, TITLE_STATUS)
    }
    return
  }
  if (action === 'retry') {
    if (game.phase === 'play' || game.phase === 'dying') {
      restart()
      await setStatus($, TITLE_STATUS)
    }
    return
  }
  if (paused) {
    paused = false
    if (action === 'go') return
  }
  game.input(action === 'go' ? 'up' : action)
}

function pickerStatus(): string {
  const c = CHARACTERS[pickIndex]!
  if (save.owned.includes(c.id)) return `${c.name}: ${c.blurb} Press w to play as ${c.name}, a and d to browse, c to go back.`
  const short = c.price - save.tokens
  return short > 0
    ? `${c.name} costs ${c.price} tokens. You have ${save.tokens}: ${short} to go. Pick up tokens on the way.`
    : `${c.name} costs ${c.price} tokens. You have ${save.tokens}. Press w to buy.`
}

async function pick($: EngineInterface, action: Action) {
  const n = CHARACTERS.length
  if (action === 'left' || action === 'right') {
    pickIndex = (pickIndex + (action === 'left' ? -1 : 1) + n) % n
    spin = 0
  } else if (action === 'up' || action === 'go') {
    const c = CHARACTERS[pickIndex]!
    if (!save.owned.includes(c.id)) {
      if (save.tokens < c.price) return
      save = { ...save, tokens: save.tokens - c.price, owned: [...save.owned, c.id] }
    }
    save = { ...save, selected: c.id }
    await persist($)
    screen = 'game'
    // a new character starts a new run, unless the run has not begun
    if (game.phase !== 'title') restart()
    game.tokensTotal = save.tokens
    await setStatus($, TITLE_STATUS)
    return
  } else if (action === 'chars' || action === 'quit' || action === 'down') {
    screen = 'game'
    await setStatus($, game.phase === 'title' ? TITLE_STATUS : PLAY_STATUS)
    return
  }
  await setStatus($, pickerStatus())
}

async function close($: EngineInterface) {
  stopLoop()
  if (game.phase === 'play') paused = true
  await persist($)
  await $.ui.close({ id: PANE })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'crossy-code', description: 'Play Crossy Code: hop across bugs, merge trains and log streams' })
    save = loadSave(await $.store.get('save'))
    restart()
    return next(e)
  })

  on('command.run', { command: 'crossy-code' }, async $ => {
    await setStatus($, game.phase === 'title' ? TITLE_STATUS : PLAY_STATUS)
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Crossy Code', focus: true, closeOnEscape: true, rows: 44, columns: 110 })
    return { text: isPlaced ? 'Crossy Code is open. Hop with w a s d.' : 'Crossy Code will open once there is room for the pane.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    stopLoop()
    if (game.phase === 'play') paused = true
    void persist($).catch(() => {})
    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    const data = e.data as { key?: unknown } | null
    const action = typeof data?.key === 'string' ? actionFor(data.key) : null
    if (action) await act($, action)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const state = await read($, ui)
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Raster = 'Raster' in elements ? elements.Raster : undefined
    const Client = 'Client' in elements ? elements.Client : undefined
    // Raster draws only in the terminal; elsewhere it is an empty fragment
    if (!Raster || e.surface !== 'terminal') {
      return (
        <Box flexDirection="column">
          <Text>Crossy Code draws its picture in the terminal. Open it there with /crossy-code.</Text>
        </Box>
      )
    }
    // typing elsewhere would leave the player to the cursor
    if (!e.props.isFocused && game.phase === 'play') paused = true
    const width = Math.max(20, Math.min(512, e.props.bodyColumns))
    const height = Math.max(6, Math.min(256, e.props.scroll.bodyRows - CHROME_ROWS))
    if (width !== cols || height !== rows) {
      cols = width
      rows = height
      renderer.resize(cols, rows, ss)
    }
    const press = (action: Action) => () => act($, action)
    const control = (key: string, hotkey: string, label: string, action: Action) => (
      <Button key={key} plain hotkey={hotkey} onPress={press(action)}>
        {label}
      </Button>
    )
    const cells = frame()
    startLoop($)
    return (
      <Box flexDirection="column">
        <Raster key={SCREEN} columns={cols} rows={rows} cells={cells} />
        {Client ? (
          <Client key="keys" module="./keys.tsx" props={{ label: state.status }} width={cols} height={1} />
        ) : (
          <Text wrap="truncate-end">{state.status}</Text>
        )}
        <Box flexDirection="row" columnGap={1}>
          <Button key="up" plain hotkey="w" autoFocus onPress={press('go')}>
            ↑
          </Button>
          {control('left', 'a', '←', 'left')}
          {control('down', 's', '↓', 'down')}
          {control('right', 'd', '→', 'right')}
          {control('pause', 'p', 'pause', 'pause')}
          {control('chars', 'c', 'chars', 'chars')}
          {control('retry', 'r', 'retry', 'retry')}
          {control('stats', 'f', 'fps', 'stats')}
          {control('quit', 'q', 'quit', 'quit')}
        </Box>
      </Box>
    )
  })
}
