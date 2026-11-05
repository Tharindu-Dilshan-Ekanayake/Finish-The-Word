import { BufferAttribute, BufferGeometry, Color } from 'three'

import {
  BOARDWALK,
  CROSS_PATHS,
  DATA,
  DECK_Z,
  DECKS,
  EGG_SPOTS,
  EGG_STAND,
  EMOTE_SHOP,
  FLOOR,
  FOUNTAIN,
  GUIDE_BOARD,
  LAMP_ROWS,
  LAMPS,
  PLANTERS,
  PLAZA,
  rotateXZ,
  SHOP_CHAIRS,
  UMBRELLAS,
} from './layout'

/**
 * The summer boardwalk's build: the paving (one mesh) and every box-built prop
 * (lamp posts, bunting, planters, the pet egg stand, beach umbrellas, the guide
 * board's frame), which join the world's shared scenery instanced mesh: no draw
 * calls of their own.
 */

/** Polar -> [x, z] around a centre, angles from +Z (south) towards +X (east), like layout.js. */
const polar = (cx, cz, r, a) => [cx + r * Math.sin(a), cz + r * Math.cos(a)]

/* ---- Paving ---------------------------------------------------------------------- */

/** Summer: sun-bleached planks, sand and pool blue, word-board tiles. */
const PAVE = {
  plankA: '#d9a066',
  plankB: '#c98f55',
  rail: '#8a5a2b',
  fountainRing: '#4fd0e8',
  sunA: '#fff0c2',
  sunB: '#ffd98a',
  band: '#ff7a6b',
  path: '#fff8e6',
  shopPad: '#d9f6ff',
  boardPad: '#ffe6f2',
  emotePad: '#efe3ff',
  eggPad: '#fff1c9',
  grout: '#d8c7a6',
}

/**
 * The word-game board the tables stand on: cream squares with the odd bonus square
 * (triple word red, double word pink, double letter light blue, triple letter blue),
 * scattered the same way on every load.
 */
const TILE = { base: '#f6ead2', tw: '#ff6b6b', dw: '#ffb3c7', dl: '#a8d8ff', tl: '#4f9dff' }
const BONUS = ['tw', 'dw', 'dw', 'dl', 'dl', 'dl', 'tl']
function tileColor(i, j) {
  const h = (i * 37 + j * 17 + ((i * j) % 5)) % 23
  return TILE[BONUS[h] || 'base']
}
const TILE_SIZE = 1
const PLANK = 0.6

/**
 * The floor as one flat geometry: the boardwalk's planks and rails, the round
 * fountain plaza (pool-blue ring, sunburst, coral band), the two word-board decks
 * under the tables, paths across to the shops and pads under the shops and boards.
 * Colours are vertex colours over one shared tile texture (UVs in world units /
 * `tile`).
 *
 * Pieces that overlap are stacked in layers, each FLOOR.plazaStep higher, so
 * overlapping pieces never flicker against each other.
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
  /** A ring segment round [cx, cz] from angle a0 to a1 (radians), in `segments` steps. */
  const arc = (cx, cz, r0, r1, a0, a1, segments, hex) => {
    color.set(hex)
    for (let i = 0; i < segments; i += 1) {
      const t0 = a0 + ((a1 - a0) * i) / segments
      const t1 = a0 + ((a1 - a0) * (i + 1)) / segments
      quad(polar(cx, cz, r0, t0), polar(cx, cz, r1, t0), polar(cx, cz, r1, t1), polar(cx, cz, r0, t1))
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
  const { x: px, z: pz, radius: pr } = PLAZA
  const ringIn = FOUNTAIN.radius - 0.1
  const ringOut = FOUNTAIN.radius + 0.9

  // Layer 0: the fountain plaza, and pads under the shops and boards.
  layer(0)
  arc(px, pz, ringIn, ringOut, 0, FULL, 48, PAVE.fountainRing)
  for (let i = 0; i < 16; i += 1) {
    arc(px, pz, ringOut, pr - 0.5, (i * FULL) / 16, ((i + 1) * FULL) / 16, 3, i % 2 ? PAVE.sunA : PAVE.sunB)
  }
  arc(px, pz, pr - 0.5, pr, 0, FULL, 64, PAVE.band)
  const shopZ = SHOP_CHAIRS.map((c) => c.shop[1])
  const shopX = SHOP_CHAIRS[0].shop[0]
  rect(shopX, 0, 4.4, Math.max(...shopZ) - Math.min(...shopZ) + 3.4, PAVE.shopPad)
  for (const lb of DATA.leaderboards) rect(lb.x, lb.z + 0.3, 7.4, 2.4, PAVE.boardPad, lb.ry)
  rect(EMOTE_SHOP.x + 0.6, EMOTE_SHOP.z, 6.2, 8.4, PAVE.emotePad)
  rect(GUIDE_BOARD.x, GUIDE_BOARD.z, 6.6, 2.6, PAVE.path, GUIDE_BOARD.ry)
  rect(EGG_STAND.x, EGG_STAND.z + 0.3, 5.6, 3.2, PAVE.eggPad, EGG_STAND.ry)

  // Layer 1: grout under the deck tiles, and the boardwalk's dark rails.
  layer(1)
  const [z0, z1] = DECK_Z
  for (const [x0, x1] of DECKS) rect((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 + 0.1, z1 - z0 + 0.1, PAVE.grout)
  const walkLen = BOARDWALK.south - BOARDWALK.north
  const walkMid = (BOARDWALK.south + BOARDWALK.north) / 2
  for (const side of [-1, 1]) rect(side * (BOARDWALK.halfWidth + 0.15), walkMid, 0.3, walkLen, PAVE.rail)

  // Layer 2: the deck tiles, and the planks across the boardwalk.
  layer(2)
  DECKS.forEach(([x0, x1], d) => {
    for (let i = 0; x0 + i * TILE_SIZE < x1 - 0.01; i += 1) {
      for (let j = 0; z0 + j * TILE_SIZE < z1 - 0.01; j += 1) {
        const cx = x0 + (i + 0.5) * TILE_SIZE
        const cz = z0 + (j + 0.5) * TILE_SIZE
        rect(cx, cz, TILE_SIZE - 0.08, TILE_SIZE - 0.08, tileColor(i + d * 7, j))
      }
    }
  })
  let k = 0
  for (let z = BOARDWALK.north; z < BOARDWALK.south - 0.01; z += PLANK) {
    rect(0, z + PLANK / 2, BOARDWALK.halfWidth * 2, PLANK, k % 2 ? PAVE.plankA : PAVE.plankB)
    k += 1
  }

  // Layer 3: paths across the decks to the shops, through the gaps between tables.
  layer(3)
  for (const [z, toX] of CROSS_PATHS) {
    const from = Math.sign(toX) * (BOARDWALK.halfWidth + 0.3)
    rect((from + toX) / 2, z, Math.abs(toX - from), 1.3, PAVE.path)
  }

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

/**
 * Every string of bunting: across the boardwalk between each facing pair of lamp
 * posts, and along each side from post to post.
 */
function buntingLines() {
  const [west, east] = LAMP_ROWS
  const lines = west.map((a, k) => [a, east[k]])
  for (const row of LAMP_ROWS) for (let k = 0; k + 1 < row.length; k += 1) lines.push([row[k], row[k + 1]])
  return lines
}

/** Strings of little flags hung between lamp posts, sagging a little. */
function buntingBoxes() {
  const boxes = []
  buntingLines().forEach(([[ax, az], [bx, bz]], k) => {
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
  })
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

/** Boxes given in a prop's own frame ([lx, y, lz], turned by `ry` about [x, z]). */
function placed({ x, z, ry }, parts) {
  return parts.map(([[lx, y, lz], s, c]) => {
    const [dx, dz] = rotateXZ(lx, lz, ry)
    return { p: [x + dx, y, z + dz], s, c, ry }
  })
}

/** Where each egg's pedestal top is (the eggs themselves are drawn by EggStand). */
export const EGG_PEDESTAL_Y = 0.6

/**
 * The pet egg stand: a little beach hut with a striped awning, its counter between
 * two pedestals, one per egg (each trimmed in its egg's colour).
 */
function eggStandBoxes() {
  const parts = [
    // Counter: a blue body, a sandy top and a white kick strip.
    [[0, 0.5, 0], [1.6, 1.0, 0.8], '#4fc3ff'],
    [[0, 1.05, 0.02], [1.75, 0.1, 0.92], '#fff3dc'],
    [[0, 0.08, 0.41], [1.6, 0.16, 0.04], '#ffffff'],
    // Posts and a back board.
    [[-0.75, 1.5, -0.35], [0.14, 3.0, 0.14], '#ffffff'],
    [[0.75, 1.5, -0.35], [0.14, 3.0, 0.14], '#ffffff'],
    [[0, 1.9, -0.38], [1.4, 1.5, 0.08], '#ffe6a8'],
  ]
  // A striped awning, sloping down towards the front.
  for (let k = 0; k < 6; k += 1) {
    parts.push([[-0.95 + k * 0.38, 3.0, 0.1], [0.38, 0.1, 1.3], k % 2 ? '#ffffff' : '#ff6b9a'])
  }
  parts.push([[0, 2.92, 0.78], [2.3, 0.22, 0.06], '#ff6b9a'])
  DATA.eggs.forEach((egg, k) => {
    const [lx, lz] = EGG_SPOTS[k]
    parts.push([[lx, 0.25, lz], [0.9, 0.5, 0.9], '#b9bec6'])
    parts.push([[lx, EGG_PEDESTAL_Y - 0.05, lz], [0.8, 0.1, 0.8], egg.spot])
  })
  return placed(EGG_STAND, parts)
}

const UMBRELLA_COLORS = ['#ff4f5e', '#4fc3ff', '#ffcf4a']
const TOWEL_COLORS = ['#7ddf5a', '#ff8ad8', '#4fc3ff']

/** A beach umbrella (stepped canopy, white bands) over a striped towel. */
function umbrellaBoxes() {
  const boxes = []
  UMBRELLAS.forEach(([x, z], k) => {
    const c = UMBRELLA_COLORS[k % UMBRELLA_COLORS.length]
    const towel = TOWEL_COLORS[k % TOWEL_COLORS.length]
    boxes.push(
      { p: [x, 1.4, z], s: [0.1, 2.8, 0.1], c: '#ffffff' },
      { p: [x, 2.62, z], s: [2.6, 0.12, 2.6], c, ry: k * 0.5 },
      { p: [x, 2.74, z], s: [2.0, 0.12, 2.0], c: '#ffffff', ry: k * 0.5 },
      { p: [x, 2.86, z], s: [1.3, 0.12, 1.3], c, ry: k * 0.5 },
      { p: [x, 2.98, z], s: [0.5, 0.12, 0.5], c: '#ffffff', ry: k * 0.5 },
      // The towel lies just clear of the grass, a white stripe across it.
      { p: [x + 0.9, 0.02, z + 0.3], s: [1.0, 0.04, 1.9], c: towel, ry: 0.3 },
      { p: [x + 0.9, 0.03, z + 0.3], s: [1.02, 0.06, 0.25], c: '#ffffff', ry: 0.3 },
    )
  })
  return boxes
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
  return [
    ...lampBoxes(),
    ...buntingBoxes(),
    ...planterBoxes(),
    ...eggStandBoxes(),
    ...umbrellaBoxes(),
    ...guideFrameBoxes(),
  ]
}

