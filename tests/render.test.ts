import { expect, test } from 'claude-code/testing'

import { Renderer } from '../hooks/render'

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// The cells as [codepoint, top, bottom] words, read back from base64.
function cells(b64: string): number[][] {
  const bytes: number[] = []
  for (let i = 0; i < b64.length; i += 4) {
    const v = [0, 1, 2, 3].reduce((acc, k) => (acc << 6) | BASE64.indexOf(b64[i + k]!), 0)
    bytes.push(v >> 16, (v >> 8) & 255, v & 255)
  }
  const out: number[][] = []
  for (let i = 0; i < bytes.length; i += 12) {
    const word = (o: number) => bytes[i + o]! | (bytes[i + o + 1]! << 8) | (bytes[i + o + 2]! << 16) | (bytes[i + o + 3]! << 24)
    out.push([word(0), word(4), word(8)])
  }
  return out
}

test('cells round to the 4-bit grid and keep their place', () => {
  const r = new Renderer()
  r.resize(2, 1, 1)
  r.out.set([0x12, 0x34, 0x56, 0xff, 0xee, 0xdd, 0x80, 0x80, 0x80, 0, 0, 0])
  expect(cells(r.encode())).toEqual([
    [0x2580, 0x113355, 0x888888],
    [0x2580, 0xffeedd, 0x000000],
  ])
})

test('a frame never uses more color pairs than the terminal can paint', () => {
  const r = new Renderer()
  r.resize(120, 40, 1)
  let seed = 7
  for (let i = 0; i < r.out.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0
    r.out[i] = seed >>> 24
  }
  const out = cells(r.encode())
  expect(out.length).toBe(120 * 40)
  expect(out.every(c => c[0] === 0x2580)).toBe(true)
  expect(new Set(out.map(c => `${c[1]},${c[2]}`)).size).toBeLessThanOrEqual(1000)
})
