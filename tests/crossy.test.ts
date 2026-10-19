import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { CrossySave } from '../types'
import { actionFor, loadSave } from '../hooks/register'

const PANE = {
  plugin: 'crossy-code',
  component: 'Pane',
  requestId: 'crossy-code',
  props: {
    title: 'Crossy Code',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30, contentRows: 30 },
    view: {},
  },
} as const

async function start($: Engine, on: On, saved?: Partial<CrossySave>) {
  mock.clock(on, { now: Date.parse('2026-10-19T12:00:00') })
  const store = new Map<string, unknown>(saved ? [['save', saved]] : [])
  const opened: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.blit', () => ({ value: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const save = () => store.get('save') as CrossySave | undefined
  return { opened, save }
}

test('/crossy-code opens the game pane', async ($, on) => {
  const { opened } = await start($, on)
  const out = await $.command.run({ command: 'crossy-code', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(opened).toEqual(['crossy-code'])
  expect(out.text).toContain('Crossy Code is open')
})

test('the terminal gets a picture the size of the pane, less two rows for text', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const raster = await ui.find({ key: 'screen' })
  expect(raster?.type).toBe('Raster')
  expect(raster?.props).toMatchObject({ columns: 80, rows: 28 })
  expect(await ui.find({ key: 'up' })).toBeDefined()
  await ui.unmount()
})

test('a surface without Raster says where to play', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ text: /draws its picture in the terminal/ })).toBeDefined()
  await ui.unmount()
})

test('a character bought with tokens is kept and picked', async ($, on) => {
  const { save } = await start($, on, { tokens: 60 })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.post({ key: 'c' })
  expect(await ui.find({ in: 'keys', text: /Clawd/ })).toBeDefined()
  await ui.post({ key: 'right' })
  expect(await ui.find({ in: 'keys', text: /Rubber Duck costs 50 tokens\. You have 60/ })).toBeDefined()
  await ui.press({ key: 'up' })
  expect(save()?.owned).toEqual(['clawd', 'duck'])
  expect(save()?.selected).toBe('duck')
  expect(save()?.tokens).toBe(10)
  await ui.unmount()
})

test('a character the player cannot afford stays locked', async ($, on) => {
  const { save } = await start($, on, { tokens: 20 })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.post({ key: 'c' })
  await ui.post({ key: 'right' })
  await ui.press({ key: 'up' })
  expect(save()).toEqual({ tokens: 20 })
  expect(await ui.find({ in: 'keys', text: /30 to go/ })).toBeDefined()
  await ui.unmount()
})

test('arrow keys, vim keys and wasd all steer', () => {
  expect(['up', 'w', 'k'].map(actionFor)).toEqual(['up', 'up', 'up'])
  expect(['left', 'a', 'h'].map(actionFor)).toEqual(['left', 'left', 'left'])
  expect(['down', 's', 'j'].map(actionFor)).toEqual(['down', 'down', 'down'])
  expect(['right', 'd', 'l'].map(actionFor)).toEqual(['right', 'right', 'right'])
  expect(actionFor('x')).toBeNull()
})

test('an old or broken save is filled in', () => {
  expect(loadSave(undefined)).toMatchObject({ best: 0, tokens: 0, owned: ['clawd'], selected: 'clawd' })
  expect(loadSave({ best: 12, owned: ['duck', 'nope'], selected: 'nope' })).toMatchObject({
    best: 12,
    owned: ['clawd', 'duck'],
    selected: 'clawd',
  })
})
