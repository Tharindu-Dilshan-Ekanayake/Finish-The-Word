import DATA from '../../../shared/gameData.json'

/**
 * World layout derived from shared/gameData.json, which the server also reads, so
 * table positions and seat checks can never disagree between the two.
 *
 * The lobby is a round snack plaza: a giant chip-bowl fountain in the middle, the
 * ten duel tables in a ring around it (each turned so its players sit with their
 * backs to the fountain), and around the outside the leaderboards (north), the
 * chair shop (east), the emote stall (west) and the entrance arch (south).
 */

export { DATA }
export const TABLE = DATA.table
export const CHIPS = DATA.chips
export const CELLS = CHIPS.cols * CHIPS.rows
export const WORLD_HALF = DATA.world.half
export const SPAWN = DATA.world.spawn

export const PLAYER_HEIGHT = 1.8
/** How far a seated avatar's hips drop and slide back onto the chair. */
export const SEATED_DROP = -0.36
export const SEATED_BACK = 0.12
/**
 * Where a duel's winner dances: up on the tabletop, this far in front of their
 * seat (towards the table's middle).
 */
export const DANCE_FORWARD = 0.75

/** World offset of a point given in an object's own frame (yaw `ry`, three.js convention). */
export function rotateXZ(lx, lz, ry) {
  const c = Math.cos(ry)
  const s = Math.sin(ry)
  return [lx * c + lz * s, -lx * s + lz * c]
}

/** A point in a table's own frame (+Z towards its chairs) -> world [x, z]. */
export function tableLocal(table, lx, lz) {
  const [dx, dz] = rotateXZ(lx, lz, table.ry || 0)
  return [table.x + dx, table.z + dz]
}

export const tableById = (id) => DATA.tables.find((t) => t.id === id) || null

/**
 * A seat: its chair position and the way the seated player faces (towards the
 * table, i.e. the table's -Z).
 */
export function seatPosition(tableId, index) {
  const t = tableById(tableId)
  if (!t) return null
  const [x, z] = tableLocal(t, index === 0 ? -TABLE.seatX : TABLE.seatX, TABLE.seatZ)
  return { x, z, ry: (t.ry || 0) + Math.PI }
}

/* ---- Chips on the table ---------------------------------------------------------- */

/** Size of one chip's square on a plate, and where each seat's plate sits. */
export const CHIP_CELL = 0.4
const PLATE_X = 0.9
const PLATE_Z = 0.08

/**
 * Where chip `cell` of seat `plate`'s plate lies, in the table's frame. Cell 0 is
 * the top-left one as seen by the duel camera (which looks along the table's +Z),
 * so the 3x3 pads on screen match the plates on the table.
 */
export function chipLocal(plate, cell) {
  const col = cell % CHIPS.cols
  const row = Math.floor(cell / CHIPS.cols)
  const cx = plate === 0 ? -PLATE_X : PLATE_X
  return [cx + ((CHIPS.cols - 1) / 2 - col) * CHIP_CELL, PLATE_Z + ((CHIPS.rows - 1) / 2 - row) * CHIP_CELL]
}

export const plateCenterLocal = (plate) => [plate === 0 ? -PLATE_X : PLATE_X, PLATE_Z]
export const PLATE_SIZE = [CHIPS.cols * CHIP_CELL + 0.1, CHIPS.rows * CHIP_CELL + 0.1]

/* ---- Lobby -------------------------------------------------------------------------- */

/**
 * Heights of everything lying flat on the ground, far enough apart that no two ever
 * z-fight (flicker), even in the distance: the plaza paving (in three layers where
 * pieces overlap: rings, pads, paths), rugs, baked shadows, players' blob shadows
 * and aura rings. Polygon offset alone can't separate them: it does nothing for a
 * surface seen straight on.
 */
export const FLOOR = { plaza: 0.012, plazaStep: 0.012, rug: 0.06, shadow: 0.075, blob: 0.09, aura: 0.105 }

/** The central fountain: a basin of this radius at the world origin. */
export const FOUNTAIN = { radius: 4.4 }
/** Paved plaza disc, and the lamp-post ring just inside its edge. */
export const PLAZA_RADIUS = 18.6
export const LAMP_RING = 17.6
/** Lamp posts every 36 degrees, leaving the entrance path (due south) open. */
export const LAMPS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => {
  const a = (k * 36 * Math.PI) / 180
  return [LAMP_RING * Math.sin(a), LAMP_RING * Math.cos(a)]
})

export const SHOP_CHAIRS = DATA.chairs.filter((c) => c.shop)
/** The chair shop is an arc of pedestals on the east side. */
export const CHAIR_SHOP = { x: 27.6, z: 0 }

export const EMOTE_SHOP = DATA.emoteShop

/** The "how to play" board beside the entrance path, turned towards the walk in. */
export const GUIDE_BOARD = { x: -10.5, z: 21.5, ry: 1.25 }
/** A giant chip bag on the other side of the entrance. */
export const CHIP_BAG = { x: 10.5, z: 21.5 }

/** Voxel trees around the edge of the island, clear of the shops and boards. */
export const TREES = [
  [-27.5, -27.5], [27.5, -27.5], [-27.5, 27.5], [27.5, 27.5],
  [-18.5, -28], [18.5, -28], [-28.5, -13], [-28.5, 13],
  [-17, 28.5], [17, 28.5], [28.5, 22.5], [28.5, -22.5],
]

/** Flower planters lining the walk in from the spawn point: [x, z, width, depth]. */
export const PLANTERS = [
  [-4.6, 25, 1.3, 4.4],
  [4.6, 25, 1.3, 4.4],
]

/**
 * The welcome arch over the spawn path: pillars at ±ARCH.halfWidth. Tall enough
 * that the follow camera (~5 units up by default) passes under the beam.
 */
export const ARCH = { z: 20.4, halfWidth: 3.4, height: 6 }

/** Rocks along the beach, just outside the fence: [x, z, size]. */
export const ROCKS = [
  [-33.5, -20, 1.6], [-33, 6, 1.1], [-34, 25, 1.9], [-12, 33.5, 1.3], [9, 34, 1.8],
  [33.5, 22, 1.2], [33, -4, 1.7], [34, -24, 1.1], [14, -33.5, 1.5], [-6, -34, 1.2],
  [-25, -33.5, 1.8], [26, 33.5, 1.4],
]

/** Distant islands out in the ocean: [x, z, width, depth]. */
export const ISLANDS = [
  [-110, -150, 60, 34],
  [130, -170, 46, 30],
  [-170, 60, 40, 50],
  [160, 90, 34, 40],
  [20, 190, 70, 26],
]

/**
 * What the player can't walk through, in XZ: turned boxes
 * `{ x, z, hw, hd, c, s }` (half sizes, cos/sin of the yaw) and circles `{ x, z, r }`.
 */
export const COLLIDERS = []

const box = (x, z, w, d, ry = 0) =>
  COLLIDERS.push({ x, z, hw: w / 2, hd: d / 2, c: Math.cos(ry), s: Math.sin(ry) })

for (const t of DATA.tables) box(t.x, t.z, TABLE.width, TABLE.depth, t.ry)
for (const lb of DATA.leaderboards) box(lb.x, lb.z, 6, 0.6, lb.ry)
for (const c of SHOP_CHAIRS) box(c.shop[0], c.shop[1], 2, 2, Math.atan2(-c.shop[0], -c.shop[1]))
box(EMOTE_SHOP.x, EMOTE_SHOP.z, 1.6, 5)
box(GUIDE_BOARD.x, GUIDE_BOARD.z, 5.4, 0.5, GUIDE_BOARD.ry)
box(CHIP_BAG.x, CHIP_BAG.z, 2.6, 1.8)
for (const [x, z, w, d] of PLANTERS) box(x, z, w, d)
for (const [x, z] of TREES) box(x, z, 1, 1)
for (const [x, z] of LAMPS) box(x, z, 0.5, 0.5)
for (const side of [-1, 1]) box(side * ARCH.halfWidth, ARCH.z, 1.5, 1.5)
COLLIDERS.push({ x: 0, z: 0, r: FOUNTAIN.radius + 0.1 })

/** A point `distance` closer to the plaza's centre than [x, z]. */
function towardCentre(x, z, distance) {
  const len = Math.hypot(x, z) || 1
  return [x - (x / len) * distance, z - (z / len) * distance]
}

/** What the player can interact with by walking up to it and pressing E. */
export const INTERACTABLES = [
  ...DATA.tables.map((t) => {
    // Players walk up on the chair side (the plaza's inside).
    const [x, z] = tableLocal(t, 0, 0.9)
    return { kind: 'table', id: t.id, x, z, range: TABLE.sitRange }
  }),
  ...SHOP_CHAIRS.map((c) => {
    const [x, z] = towardCentre(c.shop[0], c.shop[1], 1.7)
    return { kind: 'chair', id: c.id, x, z, range: 2.4 }
  }),
  { kind: 'emoteShop', id: 'emotes', x: EMOTE_SHOP.x + 1.6, z: EMOTE_SHOP.z, range: 3.5 },
]

export const RARITY_COLORS = {
  common: '#9aa3ad',
  uncommon: '#2fd14f',
  rare: '#3aa0ff',
  epic: '#ff7a1f',
  legendary: '#c04dff',
  mythic: '#ff3dc8',
}

/** How strong a chair's aura is per rarity (scales its size, glow and sparkles). */
export const RARITY_AURA = {
  common: 0.75,
  uncommon: 0.9,
  rare: 1.05,
  epic: 1.2,
  legendary: 1.4,
  mythic: 1.6,
}

export const titleById = (id) => DATA.titles.find((t) => t.id === id) || null

export const haloById = (id) => DATA.halos.find((h) => h.id === id) || null

export const chairById = (id) => DATA.chairs.find((c) => c.id === id) || DATA.chairs[0]
export const emoteById = (id) => DATA.emotes.find((e) => e.id === id)
