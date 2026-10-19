// A small software renderer: boxes in, terminal cells out.
//
// The camera is orthographic and never turns, so the scene is boxes drawn
// into a supersampled z-buffer, lit with one directional light and a shadow
// map, averaged down, and packed two pixels per cell as upper half blocks.
// The hooks runtime interprets rather than compiles, so the inner loops
// avoid calls and allocation.

export type Vec3 = [number, number, number]

// A model is a flat list of boxes, 8 numbers each: x0 y0 z0 x1 y1 z1 color flags.
export type Model = Float32Array

// A 3x4 affine matrix, row major: [m00 m01 m02 tx  m10 m11 m12 ty  m20 m21 m22 tz].
export type Mat = Float64Array

export const FLAG_GROUND = 1 // casts no shadow
export const FLAG_EMISSIVE = 2 // ignores light and shadow
export const FLAG_WATER = 4 // gets moving ripples
export const FLAG_NO_DARKEN = 8 // keeps full color outside the playfield

type Draw = { model: Model; m: Mat; tint: number; amount: number; alpha: number }

const SKY = 0x87c6ff
const AMBIENT = 0.52
const DIFFUSE = 0.6
const SHADOW_KEEP = 0.32
const PLAYFIELD_EDGE = 4.5
const OUTSIDE_DARKEN = 0.6

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

function basis(view: Vec3): [Vec3, Vec3] {
  const right = norm([view[2], 0, -view[0]])
  const up = norm([-view[0] * view[1], view[0] * view[0] + view[2] * view[2], -view[2] * view[1]])
  return [right, up]
}

// The camera looks forward, down and a little to the left, as Crossy Road's does.
export const VIEW = norm([-1, -2.8, 2.9])
export const [RIGHT, UP] = basis(VIEW)
// Points toward the light: from the upper left and behind the camera.
const LIGHT = norm([-0.45, 1, -0.6])
const L_VIEW: Vec3 = [-LIGHT[0], -LIGHT[1], -LIGHT[2]]
const [L_RIGHT, L_UP] = basis(L_VIEW)

// How far up the screen one row forward moves, and one tile right moves, per unit of scale.
export const ROW_RISE = UP[2]
export const TILE_ACROSS = RIGHT[0]

export function compose(
  x: number,
  y: number,
  z: number,
  yaw = 0,
  sx = 1,
  sy = 1,
  sz = 1,
  roll = 0,
  pitch = 0,
): Mat {
  // M = Ry(yaw) * Rx(pitch) * Rz(roll) * diag(s)
  const cy = Math.cos(yaw)
  const sy_ = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const cr = Math.cos(roll)
  const sr = Math.sin(roll)
  const a10 = cp * sr
  const a11 = cp * cr
  const a20 = sp * sr
  const a21 = sp * cr
  const m = new Float64Array(12)
  m[0] = (cy * cr + sy_ * a20) * sx
  m[1] = (-cy * sr + sy_ * a21) * sy
  m[2] = sy_ * cp * sz
  m[3] = x
  m[4] = a10 * sx
  m[5] = a11 * sy
  m[6] = -sp * sz
  m[7] = y
  m[8] = (-sy_ * cr + cy * a20) * sx
  m[9] = (sy_ * sr + cy * a21) * sy
  m[10] = cy * cp * sz
  m[11] = z
  return m
}

export function scaleColor(c: number, k: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k))
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k))
  const b = Math.min(255, Math.round((c & 255) * k))
  return (r << 16) | (g << 8) | b
}

export function mixColor(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t
  const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t
  const bl = (a & 255) * (1 - t) + (b & 255) * t
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl)
}

// The corners of each face of a box, as corner numbers: bit 0 is x, bit 1 y, bit 2 z.
// Faces come in pairs per axis, the low side first.
const FACES = [
  [0, 2, 6, 4],
  [1, 3, 7, 5],
  [0, 1, 5, 4],
  [2, 3, 7, 6],
  [0, 1, 3, 2],
  [4, 5, 7, 6],
]

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64Group(a: number, b: number, c: number): string {
  const v = (a << 16) | (b << 8) | c
  return BASE64[v >> 18]! + BASE64[(v >> 12) & 63]! + BASE64[(v >> 6) & 63]! + BASE64[v & 63]!
}

// The four groups of a cell's 12 bytes, indexed by the 4-bit channels they hold.
const CELL_HEAD = base64Group(0x80, 0x25, 0)
// 0, top blue, top green
const CELL_A = Array.from({ length: 256 }, (_, i) => base64Group(0, (i & 15) * 17, (i >> 4) * 17))
// top red, 0, bottom blue
const CELL_B = Array.from({ length: 256 }, (_, i) => base64Group((i >> 4) * 17, 0, (i & 15) * 17))
// bottom green, bottom red, 0
const CELL_C = Array.from({ length: 256 }, (_, i) => base64Group((i & 15) * 17, (i >> 4) * 17, 0))

// a little under the terminal's 1024, so its own mapping never has to step in
const PAIR_BUDGET = 1000

function dist12(a: number, b: number): number {
  const dr = (a >> 8) - (b >> 8)
  const dg = ((a >> 4) & 15) - ((b >> 4) & 15)
  const db = (a & 15) - (b & 15)
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db
}

const bounds = new WeakMap<Model, Float64Array>()

function boundsOf(model: Model): Float64Array {
  let b = bounds.get(model)
  if (b) return b
  b = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity])
  for (let i = 0; i < model.length; i += 8) {
    for (let k = 0; k < 3; k++) {
      b[k] = Math.min(b[k]!, model[i + k]!)
      b[k + 3] = Math.max(b[k + 3]!, model[i + 3 + k]!)
    }
  }
  bounds.set(model, b)
  return b
}

const MODE_FILL = 0
const MODE_SHADOW = 1
const MODE_BLEND = 2

export class Renderer {
  cols = 0
  rows = 0
  // output pixels: one column per cell, two rows per cell
  width = 0
  height = 0
  ss = 2
  sw = 0
  sh = 0
  depth = new Float32Array(0)
  albedo = new Uint32Array(0)
  lit = new Float32Array(0)
  flags = new Uint8Array(0)
  out = new Uint8Array(0)
  private keys = new Int32Array(0)
  private sorted = new Int32Array(0)

  readonly smSize = 320
  smDepth = new Float32Array(320 * 320)
  smCenter: Vec3 = [0, 0, 0]
  smScale = 1

  target: Vec3 = [0, 0, 0]
  scale = 10 // output pixels per world unit
  time = 0
  // the current's speed for water ripples, by row: flowRows[z - flowBase]
  flowBase = 0
  flowRows = new Float32Array(64)

  private list: Draw[] = []
  // projected corners of the box being drawn: x, y, depth for each of 8
  private p = new Float64Array(24)
  // the face being filled
  private qx = new Float64Array(4)
  private qy = new Float64Array(4)
  private qz = new Float64Array(4)

  resize(cols: number, rows: number, ss: number) {
    if (cols === this.cols && rows === this.rows && ss === this.ss) return
    this.cols = cols
    this.rows = rows
    this.ss = ss
    this.width = cols
    this.height = rows * 2
    this.sw = this.width * ss
    this.sh = this.height * ss
    const n = this.sw * this.sh
    this.depth = new Float32Array(n)
    this.albedo = new Uint32Array(n)
    this.lit = new Float32Array(n)
    this.flags = new Uint8Array(n)
    this.out = new Uint8Array(this.width * this.height * 3)
    this.keys = new Int32Array(cols * rows)
    this.sorted = new Int32Array(cols * rows)
  }

  begin(target: Vec3, scale: number, time: number) {
    this.target = target
    this.scale = scale
    this.time = time
    this.list.length = 0
  }

  // `tint` replaces each box's color by `amount` (0 to 1); `alpha` below 1 draws it see-through.
  draw(model: Model, m: Mat, tint = 0, amount = 0, alpha = 1) {
    this.list.push({ model, m, tint, amount, alpha })
  }

  // Renders the draw list into `out` (RGB bytes, width x height).
  render() {
    this.shadowPass()
    this.depth.fill(Infinity)
    this.flags.fill(0)
    const list = this.list
    for (let i = 0; i < list.length; i++) if (list[i]!.alpha >= 1) this.drawModel(list[i]!, MODE_FILL)
    this.light()
    for (let i = 0; i < list.length; i++) if (list[i]!.alpha < 1) this.drawModel(list[i]!, MODE_BLEND)
    this.resolve()
  }

  // ---- geometry ----

  private drawModel(d: Draw, mode: number) {
    const model = d.model
    const m = d.m
    const shadow = mode === MODE_SHADOW
    const r = shadow ? L_RIGHT : RIGHT
    const u = shadow ? L_UP : UP
    const f = shadow ? L_VIEW : VIEW
    const o = shadow ? this.smCenter : this.target
    const s = shadow ? this.smScale : this.scale * this.ss
    const w = shadow ? this.smSize : this.sw
    const h = shadow ? this.smSize : this.sh
    const cx = w / 2
    const cy = h / 2

    // A maps the model's own coordinates straight to (screen x, screen y, depth).
    const m0 = m[0]!
    const m1 = m[1]!
    const m2 = m[2]!
    const m4 = m[4]!
    const m5 = m[5]!
    const m6 = m[6]!
    const m8 = m[8]!
    const m9 = m[9]!
    const m10 = m[10]!
    const tx = m[3]! - o[0]
    const ty = m[7]! - o[1]
    const tz = m[11]! - o[2]
    const a00 = s * (r[0] * m0 + r[1] * m4 + r[2] * m8)
    const a01 = s * (r[0] * m1 + r[1] * m5 + r[2] * m9)
    const a02 = s * (r[0] * m2 + r[1] * m6 + r[2] * m10)
    const a03 = cx + s * (r[0] * tx + r[1] * ty + r[2] * tz)
    const a10 = -s * (u[0] * m0 + u[1] * m4 + u[2] * m8)
    const a11 = -s * (u[0] * m1 + u[1] * m5 + u[2] * m9)
    const a12 = -s * (u[0] * m2 + u[1] * m6 + u[2] * m10)
    const a13 = cy - s * (u[0] * tx + u[1] * ty + u[2] * tz)
    const a20 = f[0] * m0 + f[1] * m4 + f[2] * m8
    const a21 = f[0] * m1 + f[1] * m5 + f[2] * m9
    const a22 = f[0] * m2 + f[1] * m6 + f[2] * m10
    const a23 = f[0] * tx + f[1] * ty + f[2] * tz

    // skip the model when its bounding box lands off screen
    const bb = boundsOf(model)
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 0; i < 8; i++) {
      const x = i & 1 ? bb[3]! : bb[0]!
      const y = i & 2 ? bb[4]! : bb[1]!
      const z = i & 4 ? bb[5]! : bb[2]!
      const sx = a00 * x + a01 * y + a02 * z + a03
      const sy = a10 * x + a11 * y + a12 * z + a13
      if (sx < minX) minX = sx
      if (sx > maxX) maxX = sx
      if (sy < minY) minY = sy
      if (sy > maxY) maxY = sy
    }
    if (maxX < 0 || minX > w || maxY < 0 || minY > h) return

    // Each local axis's direction in the world; the face on the side facing the viewer is the one drawn.
    const l0 = Math.hypot(m0, m4, m8)
    const l1 = Math.hypot(m1, m5, m9)
    const l2 = Math.hypot(m2, m6, m10)
    const v0 = l0 > 1e-9 ? (m0 * f[0] + m4 * f[1] + m8 * f[2]) / l0 : 0
    const v1 = l1 > 1e-9 ? (m1 * f[0] + m5 * f[1] + m9 * f[2]) / l1 : 0
    const v2 = l2 > 1e-9 ? (m2 * f[0] + m6 * f[1] + m10 * f[2]) / l2 : 0
    const k0 = l0 > 1e-9 ? (m0 * LIGHT[0] + m4 * LIGHT[1] + m8 * LIGHT[2]) / l0 : 0
    const k1 = l1 > 1e-9 ? (m1 * LIGHT[0] + m5 * LIGHT[1] + m9 * LIGHT[2]) / l1 : 0
    const k2 = l2 > 1e-9 ? (m2 * LIGHT[0] + m6 * LIGHT[1] + m10 * LIGHT[2]) / l2 : 0
    // the face index drawn per axis (-1 for none) and its light
    const fx = v0 > 1e-6 ? 0 : v0 < -1e-6 ? 1 : -1
    const fy = v1 > 1e-6 ? 2 : v1 < -1e-6 ? 3 : -1
    const fz = v2 > 1e-6 ? 4 : v2 < -1e-6 ? 5 : -1
    const nx = Math.max(0, fx === 0 ? -k0 : k0)
    const ny = Math.max(0, fy === 2 ? -k1 : k1)
    const nz = Math.max(0, fz === 4 ? -k2 : k2)

    const p = this.p
    const tint = d.tint
    const amount = d.amount
    const alpha = d.alpha
    for (let b = 0; b < model.length; b += 8) {
      const flags = model[b + 7]!
      if (shadow && flags & FLAG_GROUND) continue
      const x0 = model[b]!
      const y0 = model[b + 1]!
      const z0 = model[b + 2]!
      const dx = model[b + 3]! - x0
      const dy = model[b + 4]! - y0
      const dz = model[b + 5]! - z0
      // eyes, lights and other small details cast no shadow worth the time
      if (shadow && dx < 0.16 && dy < 0.16 && dz < 0.16) continue
      const px = a00 * x0 + a01 * y0 + a02 * z0 + a03
      const py = a10 * x0 + a11 * y0 + a12 * z0 + a13
      const pz = a20 * x0 + a21 * y0 + a22 * z0 + a23
      const exx = a00 * dx
      const exy = a10 * dx
      const exz = a20 * dx
      const eyx = a01 * dy
      const eyy = a11 * dy
      const eyz = a21 * dy
      const ezx = a02 * dz
      const ezy = a12 * dz
      const ezz = a22 * dz
      for (let i = 0; i < 8; i++) {
        let x = px
        let y = py
        let z = pz
        if (i & 1) {
          x += exx
          y += exy
          z += exz
        }
        if (i & 2) {
          x += eyx
          y += eyy
          z += eyz
        }
        if (i & 4) {
          x += ezx
          y += ezy
          z += ezz
        }
        p[i * 3] = x
        p[i * 3 + 1] = y
        p[i * 3 + 2] = z
      }
      let color = model[b + 6]!
      if (amount > 0) color = amount >= 1 ? tint : mixColor(color, tint, amount)
      if (fx >= 0) this.face(FACES[fx]!, mode, color, flags, nx, alpha)
      if (fy >= 0) this.face(FACES[fy]!, mode, color, flags, ny, alpha)
      if (fz >= 0) this.face(FACES[fz]!, mode, color, flags, nz, alpha)
    }
  }

  // Fills one projected face: the depth buffer (shadow), the g-buffer (fill), or a blend over the lit picture.
  private face(corners: number[], mode: number, color: number, flags: number, ndl: number, alpha: number) {
    const p = this.p
    const xs = this.qx
    const ys = this.qy
    const zs = this.qz
    for (let i = 0; i < 4; i++) {
      const c = corners[i]! * 3
      xs[i] = p[c]!
      ys[i] = p[c + 1]!
      zs[i] = p[c + 2]!
    }
    let area = 0
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3
      area += xs[i]! * ys[j]! - xs[j]! * ys[i]!
    }
    if (area < 1e-6 && area > -1e-6) return
    const sign = area > 0 ? 1 : -1
    // depth is a plane over the screen: z = az + zx (x - ax) + zy (y - ay)
    const ax = xs[0]!
    const ay = ys[0]!
    const az = zs[0]!
    let ex1 = xs[1]! - ax
    let ey1 = ys[1]! - ay
    let ez1 = zs[1]! - az
    let ex2 = xs[2]! - ax
    let ey2 = ys[2]! - ay
    let ez2 = zs[2]! - az
    let den = ex1 * ey2 - ex2 * ey1
    if (den < 1e-9 && den > -1e-9) {
      ex1 = ex2
      ey1 = ey2
      ez1 = ez2
      ex2 = xs[3]! - ax
      ey2 = ys[3]! - ay
      ez2 = zs[3]! - az
      den = ex1 * ey2 - ex2 * ey1
      if (den < 1e-9 && den > -1e-9) return
    }
    const zx = (ez1 * ey2 - ez2 * ey1) / den
    const zy = (ez2 * ex1 - ez1 * ex2) / den

    const shadow = mode === MODE_SHADOW
    const w = shadow ? this.smSize : this.sw
    const h = shadow ? this.smSize : this.sh
    let minY = ys[0]!
    let maxY = ys[0]!
    for (let i = 1; i < 4; i++) {
      if (ys[i]! < minY) minY = ys[i]!
      if (ys[i]! > maxY) maxY = ys[i]!
    }
    const yStart = Math.max(0, Math.ceil(minY - 0.5))
    const yEnd = Math.min(h - 1, Math.floor(maxY - 0.5))
    if (yEnd < yStart) return

    // A projected box face is a parallelogram: two edges bound each row on the left and two on
    // the right, each as x = b + k * y. Edges are oriented so the inside is to their left.
    let lk0 = 0
    let lb0 = -1e30
    let lk1 = 0
    let lb1 = -1e30
    let hk0 = 0
    let hb0 = 1e30
    let hk1 = 0
    let hb1 = 1e30
    let nl = 0
    let nh = 0
    for (let e = 0; e < 4; e++) {
      const f = (e + 1) & 3
      const ex = (xs[f]! - xs[e]!) * sign
      const ey = (ys[f]! - ys[e]!) * sign
      if (ey < 1e-9 && ey > -1e-9) continue
      const k = ex / ey
      const bb = xs[e]! - k * ys[e]!
      if (ey < 0) {
        if (nl === 0) {
          lk0 = k
          lb0 = bb
        } else {
          lk1 = k
          lb1 = bb
        }
        nl++
      } else {
        if (nh === 0) {
          hk0 = k
          hb0 = bb
        } else {
          hk1 = k
          hb1 = bb
        }
        nh++
      }
    }

    const depth = shadow ? this.smDepth : this.depth
    const albedo = this.albedo
    const lit = this.lit
    const fl = this.flags
    let sr = 0
    let sg = 0
    let sb = 0
    if (mode === MODE_BLEND) {
      const shaded = scaleColor(color, flags & FLAG_EMISSIVE ? 1 : AMBIENT + DIFFUSE * ndl)
      sr = ((shaded >> 16) & 255) * alpha
      sg = ((shaded >> 8) & 255) * alpha
      sb = (shaded & 255) * alpha
    }
    for (let y = yStart; y <= yEnd; y++) {
      const py = y + 0.5
      let lo = lb0 + lk0 * py
      const lo1 = lb1 + lk1 * py
      if (lo1 > lo) lo = lo1
      let hi = hb0 + hk0 * py
      const hi1 = hb1 + hk1 * py
      if (hi1 < hi) hi = hi1
      const x0 = Math.max(0, Math.ceil(lo - 0.5))
      const x1 = Math.min(w - 1, Math.floor(hi - 0.5))
      if (x1 < x0) continue
      let z = az + zx * (x0 + 0.5 - ax) + zy * (py - ay)
      let i = y * w + x0
      const end = i + (x1 - x0)
      if (mode === MODE_FILL) {
        for (; i <= end; i++, z += zx) {
          if (z < depth[i]!) {
            depth[i] = z
            albedo[i] = color
            lit[i] = ndl
            fl[i] = flags
          }
        }
      } else if (shadow) {
        for (; i <= end; i++, z += zx) if (z < depth[i]!) depth[i] = z
      } else {
        const keep = 1 - alpha
        for (; i <= end; i++, z += zx) {
          if (z < depth[i]!) {
            const v = albedo[i]!
            albedo[i] =
              ((((v >> 16) & 255) * keep + sr) << 16) | ((((v >> 8) & 255) * keep + sg) << 8) | ((v & 255) * keep + sb)
          }
        }
      }
    }
  }

  private shadowPass() {
    this.smDepth.fill(Infinity)
    // cover what the camera sees, with room for the shadows of things just off screen
    const viewW = this.width / this.scale
    const viewH = this.height / this.scale / Math.abs(ROW_RISE)
    const extent = Math.max(viewW, viewH) * 0.7 + 2.5
    const texel = (extent * 2) / this.smSize
    this.smScale = 1 / texel
    // snap the center to whole texels so shadows do not shimmer as the camera moves
    const t = this.target
    const u = Math.round((t[0] * L_RIGHT[0] + t[1] * L_RIGHT[1] + t[2] * L_RIGHT[2]) / texel) * texel
    const v = Math.round((t[0] * L_UP[0] + t[1] * L_UP[1] + t[2] * L_UP[2]) / texel) * texel
    this.smCenter = [L_RIGHT[0] * u + L_UP[0] * v, L_RIGHT[1] * u + L_UP[1] * v, L_RIGHT[2] * u + L_UP[2] * v]
    const list = this.list
    for (let i = 0; i < list.length; i++) if (list[i]!.alpha >= 1) this.drawModel(list[i]!, MODE_SHADOW)
  }

  // ---- shading ----

  private light() {
    const w = this.sw
    const h = this.sh
    const s = this.scale * this.ss
    const t = this.target
    const depth = this.depth
    const albedo = this.albedo
    const lit = this.lit
    const fl = this.flags
    const sm = this.smDepth
    const n = this.smSize
    const half = n / 2
    const sms = this.smScale
    const time = this.time
    const flowBase = this.flowBase
    const flowRows = this.flowRows
    const bias = 0.045
    // The world point of a sample is base + RIGHT * u + VIEW * d, with base fixed per row,
    // so everything needed from it is linear in u and d: work out the terms once.
    const ox = t[0] - this.smCenter[0]
    const oy = t[1] - this.smCenter[1]
    const oz = t[2] - this.smCenter[2]
    const du = 1 / s
    // shadow map x, y and depth along the light, per unit of u and of d
    const sxU = sms * (RIGHT[0] * L_RIGHT[0] + RIGHT[2] * L_RIGHT[2])
    const sxD = sms * (VIEW[0] * L_RIGHT[0] + VIEW[2] * L_RIGHT[2])
    const syU = -sms * (RIGHT[0] * L_UP[0] + RIGHT[1] * L_UP[1] + RIGHT[2] * L_UP[2])
    const syD = -sms * (VIEW[0] * L_UP[0] + VIEW[1] * L_UP[1] + VIEW[2] * L_UP[2])
    const ldU = RIGHT[0] * L_VIEW[0] + RIGHT[1] * L_VIEW[1] + RIGHT[2] * L_VIEW[2]
    const ldD = VIEW[0] * L_VIEW[0] + VIEW[1] * L_VIEW[1] + VIEW[2] * L_VIEW[2]
    const u0 = (0.5 - w / 2) / s
    for (let y = 0; y < h; y++) {
      const v = (h / 2 - (y + 0.5)) / s
      const bx = UP[0] * v + ox
      const by = UP[1] * v + oy
      const bz = UP[2] * v + oz
      const sxRow = half + sms * (bx * L_RIGHT[0] + bz * L_RIGHT[2]) + sxU * u0
      const syRow = half - sms * (bx * L_UP[0] + by * L_UP[1] + bz * L_UP[2]) + syU * u0
      const ldRow = bx * L_VIEW[0] + by * L_VIEW[1] + bz * L_VIEW[2] + ldU * u0 - bias
      const wxRow = t[0] + UP[0] * v + RIGHT[0] * u0
      const wzRow = t[2] + UP[2] * v + RIGHT[2] * u0
      const sxStep = sxU * du
      const syStep = syU * du
      const ldStep = ldU * du
      const wxStep = RIGHT[0] * du
      const wzStep = RIGHT[2] * du
      let i = y * w
      for (let x = 0; x < w; x++, i++) {
        const d = depth[i]!
        if (d === Infinity) {
          albedo[i] = SKY
          continue
        }
        const f = fl[i]!
        const base = albedo[i]!
        const wx = wxRow + wxStep * x + VIEW[0] * d
        let k = 1
        if (!(f & FLAG_EMISSIVE)) {
          const ndl = lit[i]!
          let shade = 1
          if (ndl > 0) {
            const sx = Math.floor(sxRow + sxStep * x + sxD * d)
            const sy = Math.floor(syRow + syStep * x + syD * d)
            if (sx >= 0 && sy >= 0 && sx < n && sy < n) {
              if (ldRow + ldStep * x + ldD * d > sm[sy * n + sx]!) shade = SHADOW_KEEP
            }
          }
          k = AMBIENT + DIFFUSE * ndl * shade
        }
        let r = (base >> 16) & 255
        let g = (base >> 8) & 255
        let b = base & 255
        if (f & FLAG_WATER) {
          // long thin streaks drifting with the current, three lanes per row
          const wz = wzRow + wzStep * x + VIEW[2] * d
          const row = Math.round(wz)
          const flow = flowRows[(row - flowBase) & 63]!
          const band = (wz - row + 0.5) * 3
          const lane = Math.floor(band)
          const across = band - lane
          if (across > 0.4 && across < 0.6) {
            const along = (wx - time * flow) * 0.55 + lane * 0.37 + row * 0.61
            if (along - Math.floor(along) < 0.22) {
              r += (255 - r) * 0.45
              g += (255 - g) * 0.45
              b += (255 - b) * 0.45
            }
          }
        }
        if (!(f & FLAG_NO_DARKEN) && (wx > PLAYFIELD_EDGE || wx < -PLAYFIELD_EDGE)) k *= OUTSIDE_DARKEN
        r *= k
        g *= k
        b *= k
        albedo[i] = ((r > 255 ? 255 : r) << 16) | ((g > 255 ? 255 : g) << 8) | (b > 255 ? 255 : b)
      }
    }
  }

  private resolve() {
    const ss = this.ss
    const w = this.width
    const h = this.height
    const sw = this.sw
    const src = this.albedo
    const out = this.out
    const inv = 1 / (ss * ss)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0
        let g = 0
        let b = 0
        for (let dy = 0; dy < ss; dy++) {
          let i = (y * ss + dy) * sw + x * ss
          for (let dx = 0; dx < ss; dx++, i++) {
            const c = src[i]!
            r += (c >> 16) & 255
            g += (c >> 8) & 255
            b += c & 255
          }
        }
        const o = (y * w + x) * 3
        out[o] = r * inv
        out[o + 1] = g * inv
        out[o + 2] = b * inv
      }
    }
  }

  // ---- 2D overlay, in output pixels ----

  // Where a world point lands in output pixels, for labels that follow things in the scene.
  project(x: number, y: number, z: number): [number, number] {
    const t = this.target
    const dx = x - t[0]
    const dy = y - t[1]
    const dz = z - t[2]
    return [
      this.width / 2 + (RIGHT[0] * dx + RIGHT[1] * dy + RIGHT[2] * dz) * this.scale,
      this.height / 2 - (UP[0] * dx + UP[1] * dy + UP[2] * dz) * this.scale,
    ]
  }

  pixel(x: number, y: number, color: number, alpha = 1) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const o = (y * this.width + x) * 3
    const out = this.out
    if (alpha >= 1) {
      out[o] = (color >> 16) & 255
      out[o + 1] = (color >> 8) & 255
      out[o + 2] = color & 255
      return
    }
    out[o] = out[o]! * (1 - alpha) + ((color >> 16) & 255) * alpha
    out[o + 1] = out[o + 1]! * (1 - alpha) + ((color >> 8) & 255) * alpha
    out[o + 2] = out[o + 2]! * (1 - alpha) + (color & 255) * alpha
  }

  rect(x: number, y: number, w: number, h: number, color: number, alpha = 1) {
    for (let j = Math.max(0, y); j < Math.min(this.height, y + h); j++)
      for (let i = Math.max(0, x); i < Math.min(this.width, x + w); i++) this.pixel(i, j, color, alpha)
  }

  // Packs `out` as Raster cells: one upper half block per cell, top pixel in front.
  //
  // The terminal paints at most 1024 distinct color pairs a frame, mapping the rest to its
  // nearest, at 4 bits a channel. Rounding to that grid here and folding the rarest pairs into
  // their closest kept neighbor keeps the choice ours, so small text never loses its colors.
  encode(): string {
    const w = this.width
    const n = w * this.rows
    const out = this.out
    const keys = this.keys
    let k = 0
    for (let r = 0; r < this.rows; r++) {
      let t = 2 * r * w * 3
      let b = (2 * r + 1) * w * 3
      for (let c = 0; c < w; c++, t += 3, b += 3) {
        const top = (((out[t]! + 8) / 17) << 8) | (((out[t + 1]! + 8) / 17) << 4) | ((out[t + 2]! + 8) / 17)
        const bot = (((out[b]! + 8) / 17) << 8) | (((out[b + 1]! + 8) / 17) << 4) | ((out[b + 2]! + 8) / 17)
        keys[k++] = (top << 12) | bot
      }
    }
    this.budgetPairs(n)
    // each cell is 12 bytes, little-endian: U+2580, then the top and bottom colors, so 16 base64
    // characters, and with 16 levels a channel every group of three bytes comes from a table
    const parts: string[] = new Array(n)
    for (let i = 0; i < n; i++) {
      const key = keys[i]!
      const top = key >> 12
      const bot = key & 4095
      parts[i] = CELL_HEAD + CELL_A[top & 255]! + CELL_B[((top >> 4) & 240) | (bot & 15)]! + CELL_C[(bot >> 4) & 255]!
    }
    return parts.join('')
  }

  private budgetPairs(n: number) {
    const keys = this.keys
    const sorted = this.sorted
    sorted.set(keys)
    sorted.sort()
    let distinct = 0
    for (let i = 0; i < n; i++) if (i === 0 || sorted[i] !== sorted[i - 1]) distinct++
    if (distinct <= PAIR_BUDGET) return
    // each distinct pair and how many cells use it, most used first
    const pairs: number[] = []
    const counts: number[] = []
    for (let i = 0; i < n; i++) {
      if (i > 0 && sorted[i] === sorted[i - 1]) counts[counts.length - 1]!++
      else {
        pairs.push(sorted[i]!)
        counts.push(1)
      }
    }
    const order = pairs.map((_, i) => i).sort((a, b) => counts[b]! - counts[a]!)
    const byTop = new Map<number, number[]>()
    const byBot = new Map<number, number[]>()
    const kept: number[] = []
    for (let i = 0; i < PAIR_BUDGET; i++) {
      const key = pairs[order[i]!]!
      kept.push(key)
      const top = key >> 12
      const bot = key & 4095
      const a = byTop.get(top)
      if (a) a.push(bot)
      else byTop.set(top, [bot])
      const b = byBot.get(bot)
      if (b) b.push(top)
      else byBot.set(bot, [top])
    }
    const remap = new Map<number, number>()
    for (let i = PAIR_BUDGET; i < order.length; i++) {
      const key = pairs[order[i]!]!
      const top = key >> 12
      const bot = key & 4095
      let best = kept[0]!
      let bestD = Infinity
      const sameTop = byTop.get(top)
      const sameBot = byBot.get(bot)
      if (sameTop) {
        for (const b of sameTop) {
          const d = dist12(bot, b)
          if (d < bestD) {
            bestD = d
            best = (top << 12) | b
          }
        }
      }
      if (sameBot) {
        for (const t of sameBot) {
          const d = dist12(top, t)
          if (d < bestD) {
            bestD = d
            best = (t << 12) | bot
          }
        }
      }
      if (bestD === Infinity) {
        for (const kk of kept) {
          const d = dist12(top, kk >> 12) + dist12(bot, kk & 4095)
          if (d < bestD) {
            bestD = d
            best = kk
          }
        }
      }
      remap.set(key, best)
    }
    for (let i = 0; i < n; i++) {
      const to = remap.get(keys[i]!)
      if (to !== undefined) keys[i] = to
    }
  }
}
