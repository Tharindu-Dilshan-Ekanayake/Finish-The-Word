import { BufferAttribute, BufferGeometry, Color } from 'three'

import {
  CHIP_BAG,
  DATA,
  EMOTE_SHOP,
  FLOOR,
  GUIDE_BOARD,
  LAMPS,
  PLANTERS,
  PLAZA_RADIUS,
  rotateXZ,
  SPAWN,
} from './layout'

/**
 * The snack plaza's build: the paving (one mesh) and every box-built prop (lamp
 * posts, bunting, planters, the giant chip bag, the guide board's frame), which
 * join the world's shared scenery instanced mesh: no draw calls of their own.
 */

const DEG = Math.PI / 180
/** Polar -> [x, z], with angles measured from +Z (south) towards +X (east), like layout.js. */
const polar = (r, a) => [r * Math.sin(a), r * Math.cos(a)]

/* ---- Paving ---------------------------------------------------------------------- */

const PAVE = {
  fountainRing: '#ffcf4a',
  sunA: '#ffe9c9',
  sunB: '#ffd7a3',
  band: '#ec7a5c',
  walk: '#fff3dc',
  trim: '#caa77c',
  path: '#fff3dc',
  shopPad: '#d9f1ff',
  boardPad: '#ffe1f0',
  emotePad: '#f0e2ff',
}

/**
 * The plaza floor as one flat geometry: a sunburst of warm tiles around the
 * fountain, a terracotta band, a walkway ring, the entrance path and paved pads
 * under the shops and boards. Colours are vertex colours over one shared tile
 * texture (UVs in world units / `tile`).
 *
 * Pieces that overlap are stacked in layers (rings, then pads, then paths), each
 * FLOOR.plazaStep higher, so overlapping tiles never flicker against each other.
 */
export function createPlazaGeometry(tile) {
  const positions = []
  const colors = []
  const color = new Color()
  let y = 0
  const layer = (n) => {
    y = n * FLOOR.plazaStep
  }

  const tri = (a, b, c) => {
    // Every triangle faces up (+Y), whatever order the corners came in.
    const cross = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1])
    const pts = cross >= 0 ? [a, b, c] : [a, c, b]
    for (const [x, z] of pts) {
      positions.push(x, y, z)
      colors.push(color.r, color.g, color.b)
    }
  }
  const quad = (a, b, c, d) => {
    tri(a, b, c)
    tri(a, c, d)
  }
  /** A ring segment from angle a0 to a1 (radians), in `segments` steps. */
  const arc = (r0, r1, a0, a1, segments, hex) => {
    color.set(hex)
    for (let i = 0; i < segments; i += 1) {
      const t0 = a0 + ((a1 - a0) * i) / segments
      const t1 = a0 + ((a1 - a0) * (i + 1)) / segments
      quad(polar(r0, t0), polar(r1, t0), polar(r1, t1), polar(r0, t1))
    }
  }
  const rect = (x, z, w, d, hex, ry = 0) => {
    color.set(hex)
    const corner = (sx, sz) => {
      const [dx, dz] = rotateXZ((sx * w) / 2, (sz * d) / 2, ry)
      return [x + dx, z + dz]
    }
    quad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1))
  }

  const FULL = Math.PI * 2
  // Layer 0: the rings, side by side.
  layer(0)
  arc(4.3, 5.3, 0, FULL, 48, PAVE.fountainRing)
  // The sunburst: 20 wedges, alternating.
  for (let i = 0; i < 20; i += 1) {
    arc(5.3, 16.3, (i * FULL) / 20, ((i + 1) * FULL) / 20, 3, i % 2 ? PAVE.sunA : PAVE.sunB)
  }
  arc(16.3, 16.9, 0, FULL, 72, PAVE.band)
  arc(16.9, PLAZA_RADIUS - 0.35, 0, FULL, 72, PAVE.walk)
  arc(PLAZA_RADIUS - 0.35, PLAZA_RADIUS, 0, FULL, 72, PAVE.trim)

  // Layer 1: pads under the chair shop's arc (east), the leaderboards' arc (north),
  // the emote stall (west) and the guide board.
  layer(1)
  arc(21.6, 26.4, 38 * DEG, 142 * DEG, 26, PAVE.shopPad)
  arc(22.6, 26.6, 146 * DEG, 214 * DEG, 18, PAVE.boardPad)
  rect(EMOTE_SHOP.x + 0.6, EMOTE_SHOP.z, 6.2, 8.4, PAVE.emotePad)
  rect(GUIDE_BOARD.x, GUIDE_BOARD.z, 6.6, 2.6, PAVE.walk, GUIDE_BOARD.ry)

  // Layer 2: the entrance path from the spawn point (its terracotta edges beside
  // it, not over it) and the spokes joining the pads to the walkway.
  layer(2)
  const pathStart = PLAZA_RADIUS - 0.4
  const pathEnd = SPAWN[2] + 3
  const pathMid = (pathStart + pathEnd) / 2
  const pathLen = pathEnd - pathStart
  rect(0, pathMid, 4.8, pathLen, PAVE.path)
  rect(-2.6, pathMid, 0.4, pathLen, PAVE.band)
  rect(2.6, pathMid, 0.4, pathLen, PAVE.band)
  rect(20.1, 0, 3.4, 3.2, PAVE.walk)
  rect(0, -20.6, 3.2, 4.4, PAVE.walk)
  rect(-19.9, 0, 3.4, 3.2, PAVE.walk)

  const position = new Float32Array(positions)
  const uv = new Float32Array((position.length / 3) * 2)
  const normal = new Float32Array(position.length)
  for (let i = 0; i < position.length / 3; i += 1) {
    uv[i * 2] = position[i * 3] / tile
    uv[i * 2 + 1] = position[i * 3 + 2] / tile
    normal[i * 3 + 1] = 1
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('normal', new BufferAttribute(normal, 3))
  geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.computeBoundingSphere()
  return geometry
}

/* ---- Props ----------------------------------------------------------------------- */

const LAMP_METAL = '#3c3f52'
const BUNTING = ['#ff4f5e', '#ffcf4a', '#4fc3ff', '#7ddf5a', '#ff8ad8']
const LAMP_TOP = 3.98
const ROPE_Y = 3.62
const SAG = 0.45

/** The glowing lantern panes, drawn unlit in their own mesh (see World). */
export const LAMP_BULBS = LAMPS.map(([x, z]) => ({ p: [x, LAMP_TOP, z], s: [0.32, 0.42, 0.32] }))

function lampBoxes() {
  const boxes = []
  for (const [x, z] of LAMPS) {
    boxes.push(
      { p: [x, 0.15, z], s: [0.55, 0.3, 0.55], c: LAMP_METAL },
      { p: [x, 0.38, z], s: [0.32, 0.18, 0.32], c: '#ffcf4a' },
      { p: [x, 2.0, z], s: [0.15, 3.3, 0.15], c: LAMP_METAL },
      { p: [x, LAMP_TOP - 0.25, z], s: [0.44, 0.07, 0.44], c: LAMP_METAL },
      { p: [x, LAMP_TOP + 0.25, z], s: [0.52, 0.09, 0.52], c: LAMP_METAL },
      { p: [x, LAMP_TOP + 0.36, z], s: [0.24, 0.14, 0.24], c: '#ffcf4a' },
    )
  }
  return boxes
}

/** Strings of little flags hung between neighbouring lamp posts, sagging a little. */
function buntingBoxes() {
  const boxes = []
  for (let k = 0; k + 1 < LAMPS.length; k += 1) {
    const [ax, az] = LAMPS[k]
    const [bx, bz] = LAMPS[k + 1]
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz)
    const ry = Math.atan2(-dz, dx)
    const at = (s) => [ax + dx * s, ROPE_Y - SAG * 4 * s * (1 - s), az + dz * s]
    const ropeSegments = 8
    for (let i = 0; i < ropeSegments; i += 1) {
      const [x, y, z] = at((i + 0.5) / ropeSegments)
      boxes.push({ p: [x, y, z], s: [len / ropeSegments + 0.05, 0.035, 0.035], c: '#fdf6e3', ry })
    }
    const flags = 7
    for (let i = 0; i < flags; i += 1) {
      const [x, y, z] = at((i + 0.5) / flags)
      boxes.push({ p: [x, y - 0.2, z], s: [0.32, 0.36, 0.03], c: BUNTING[(i + k) % BUNTING.length], ry })
    }
  }
  return boxes
}

const FLOWERS = ['#ff4f8b', '#ffd23d', '#ffffff', '#b56bff', '#ff7a3d']

function planterBoxes() {
  const boxes = []
  PLANTERS.forEach(([x, z, w, d], k) => {
    boxes.push({ p: [x, 0.28, z], s: [w, 0.56, d], c: '#d9774f' })
    boxes.push({ p: [x, 0.58, z], s: [w + 0.12, 0.08, d + 0.12], c: '#f0a36c' })
    // A low hedge growing out of the rim (no faces level with it), flowers along it.
    boxes.push({ p: [x, 0.83, z], s: [w - 0.35, 0.5, d - 0.35], c: '#3fae3a' })
    for (let i = 0; i < 7; i += 1) {
      const fz = z - d / 2 + 0.45 + (i * (d - 0.9)) / 6
      const fx = x + (i % 2 ? 0.28 : -0.28)
      boxes.push({ p: [fx, 1.12, fz], s: [0.2, 0.2, 0.2], c: FLOWERS[(i + k * 2) % FLOWERS.length], ry: i * 0.7 })
    }
  })
  return boxes
}

/** A giant bag of chips, burst open at the top: the plaza's photo spot. */
function chipBagBoxes() {
  const { x, z } = CHIP_BAG
  return [
    { p: [x, 0.12, z], s: [2.9, 0.24, 2.0], c: '#f2e6d0' },
    { p: [x, 1.6, z], s: [2.3, 2.75, 1.3], c: '#e8343c' },
    { p: [x, 3.06, z], s: [2.4, 0.2, 0.5], c: '#b8222a' },
    { p: [x, 1.75, z + 0.66], s: [1.6, 1.25, 0.05], c: '#ffd23d' },
    { p: [x, 1.75, z + 0.69], s: [1.1, 0.75, 0.05], c: '#fff3c4' },
    { p: [x, 0.55, z + 0.66], s: [2.3, 0.22, 0.05], c: '#ffffff' },
    // Chips spilling out of the top.
    { p: [x - 0.55, 3.35, z], s: [0.75, 0.55, 0.1], c: '#f7c43f', ry: 0.4 },
    { p: [x + 0.1, 3.5, z + 0.1], s: [0.8, 0.6, 0.1], c: '#f9cc4f', ry: -0.3 },
    { p: [x + 0.65, 3.3, z - 0.1], s: [0.7, 0.5, 0.1], c: '#f3bb34', ry: 1.1 },
  ]
}

/** The guide board's posts and frame; its face is drawn by GuideBoard. */
export const GUIDE = { width: 4.8, height: 3.3, y: 2.55 }

function guideFrameBoxes() {
  const { x, z, ry } = GUIDE_BOARD
  const at = (lx, lz) => {
    const [dx, dz] = rotateXZ(lx, lz, ry)
    return [x + dx, z + dz]
  }
  const boxes = []
  for (const side of [-1, 1]) {
    const [px, pz] = at(side * (GUIDE.width / 2 + 0.12), 0)
    boxes.push({ p: [px, GUIDE.y / 2 + 0.9, pz], s: [0.28, GUIDE.y + 1.8, 0.28], c: '#8a4f2a', ry })
  }
  const [fx, fz] = at(0, -0.06)
  boxes.push({ p: [fx, GUIDE.y, fz], s: [GUIDE.width + 0.3, GUIDE.height + 0.3, 0.16], c: '#6e3d20', ry })
  const [rx, rz] = at(0, 0)
  boxes.push({ p: [rx, GUIDE.y + GUIDE.height / 2 + 0.28, rz], s: [GUIDE.width + 0.8, 0.22, 0.6], c: '#ec7a5c', ry })
  return boxes
}

/** Every prop box of the plaza, for the scenery mesh. */
export function lobbyBoxes() {
  return [...lampBoxes(), ...buntingBoxes(), ...planterBoxes(), ...chipBagBoxes(), ...guideFrameBoxes()]
}

/** Rug colours cycled around the ring of tables. */
export const RUG_COLORS = ['#e85d5d', '#f2a93b', '#4aa3df', '#9b6bd6', '#3cb878']

/** A rug under each table and its two chairs, turned with it. */
export const RUG_ITEMS = DATA.tables.map((t, i) => {
  const [dx, dz] = rotateXZ(0, 0.45, t.ry)
  return {
    p: [t.x + dx, FLOOR.rug, t.z + dz],
    s: [DATA.table.width + 2.2, 1, DATA.table.depth + 3.2],
    ry: t.ry,
    c: RUG_COLORS[i % RUG_COLORS.length],
  }
})
