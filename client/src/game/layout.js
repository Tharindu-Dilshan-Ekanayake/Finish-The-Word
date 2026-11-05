import DATA from '../../../shared/gameData.json'

/**
 * World layout derived from shared/gameData.json, which the server also reads, so
 * table positions and seat checks can never disagree between the two.
 *
 * The lobby is a summer boardwalk. From the spawn point (south) a wooden boardwalk
 * runs north through the entrance arch, under strings of bunting, to a round plaza
 * with the letter-block fountain, the four leaderboards fanned out behind it. The
 * fifteen duel tables (thirty seats: a full room) stand in two rows of seven either
 * side of the boardwalk, on decks tiled like a giant word-game board, each turned so
 * its players sit with their backs to the boardwalk; the fifteenth, the Center
 * Stage, stands at the boardwalk's end with the fountain behind its players. Beyond them: the chair showroom in a straight row (east),
 * the emote stall and beach umbrellas (west), the pet egg stand and the "how to
 * play" board by the arch, and palms round the edge.
 */

export { DATA }
export const TABLE = DATA.table
export const WORLD_HALF = DATA.world.half
export const SPAWN = DATA.world.spawn
/** A spot on the spawn point, a little to either side, so arrivals don't stand inside each other. */
export const spawnPoint = () => [SPAWN[0] + (Math.random() - 0.5) * 3.2, SPAWN[1], SPAWN[2] + (Math.random() - 0.5) * 1.6]

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

/* ---- Lobby -------------------------------------------------------------------------- */

/**
 * Heights of everything lying flat on the ground, far enough apart that no two ever
 * z-fight (flicker), even in the distance: the paving (in four layers where pieces
 * overlap: plaza and pads, then grout and rails, then tiles and planks, then
 * paths), baked shadows, players' blob shadows and aura rings. Polygon offset alone
 * can't separate them: it does nothing for a surface seen straight on.
 */
export const FLOOR = { plaza: 0.012, plazaStep: 0.012, shadow: 0.075, blob: 0.09, aura: 0.105 }

/** The wooden boardwalk, from just behind the spawn point to the fountain plaza. */
export const BOARDWALK = { halfWidth: 2.6, south: SPAWN[2] + 3, north: -15.2 }
/** The fountain at the boardwalk's north end, and the round plaza around it. */
export const FOUNTAIN = { x: 0, z: -21, radius: 4.4 }
export const PLAZA = { x: FOUNTAIN.x, z: FOUNTAIN.z, radius: 6.6 }
/**
 * The two decks the tables stand on, either side of the boardwalk, tiled like a
 * word-game board: [xMin, xMax], and the z span they share.
 */
export const DECKS = [
  [4, 11],
  [-11, -4],
]
export const DECK_Z = [-16.6, 16.6]
/** Lamp posts along both edges of the boardwalk, in the gaps between the tables. */
const LAMP_Z = [17.1, 12.25, 7.35, 2.45, -2.45, -7.35]
export const LAMP_ROWS = [-1, 1].map((side) => LAMP_Z.map((z) => [side * 3.3, z]))
export const LAMPS = LAMP_ROWS.flat()
/** Cross paths from the boardwalk to the shops, through gaps between tables: [z, toX]. */
export const CROSS_PATHS = [
  [2.45, 16.8],
  [-2.45, -18],
]
/** The Center Stage: the table at the boardwalk's north end, in front of the fountain. */
export const STAGE_TABLE = DATA.tables.find((t) => t.stage) || null

export const SHOP_CHAIRS = DATA.chairs.filter((c) => c.shop)
/** The chair showroom: a straight row of pedestals on the east side, facing west. */
export const CHAIR_SHOP = { x: 22.6, z: 0 }
export const SHOP_FACING = -Math.PI / 2

export const EMOTE_SHOP = DATA.emoteShop

/** The "how to play" board beside the entrance path, turned towards the walk in. */
export const GUIDE_BOARD = { x: -10.5, z: 21.5, ry: 1.25 }
/**
 * The pet egg stand on the other side of the entrance, facing the path (its front
 * is its local +Z turned by `ry`): a counter with an egg on a pedestal either side.
 */
export const EGG_STAND = { x: 10.5, z: 21.5, ry: -1.25 }
/** Where each egg sits on the stand, in the stand's frame (same order as DATA.eggs). */
export const EGG_SPOTS = [
  [-1.35, 0.15],
  [1.35, 0.15],
]
/** Beach umbrellas with towels: on the west lawn and either side of the entrance. */
export const UMBRELLAS = [
  [-21.5, 11.5],
  [-21.5, -11.5],
  [-16.5, 23.5],
  [16.5, 23.5],
]

/** Voxel trees around the edge of the island, clear of the shops and boards. */
export const TREES = [
  [-27.5, -27.5], [27.5, -27.5], [-27.5, 27.5], [27.5, 27.5],
  [-18.5, -28], [18.5, -28], [-28.5, -13], [-28.5, 13],
  [-17, 28.5], [17, 28.5], [28.5, 22.5], [28.5, -22.5],
  [22.5, 18.5], [-25.5, 0.5], [25, -16],
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
for (const c of SHOP_CHAIRS) box(c.shop[0], c.shop[1], 2, 2, SHOP_FACING)
box(EMOTE_SHOP.x, EMOTE_SHOP.z, 1.6, 5)
box(GUIDE_BOARD.x, GUIDE_BOARD.z, 5.4, 0.5, GUIDE_BOARD.ry)
box(EGG_STAND.x, EGG_STAND.z, 3.6, 1.4, EGG_STAND.ry)
for (const [x, z] of UMBRELLAS) COLLIDERS.push({ x, z, r: 0.35 })
for (const [x, z, w, d] of PLANTERS) box(x, z, w, d)
for (const [x, z] of TREES) box(x, z, 1, 1)
for (const [x, z] of LAMPS) box(x, z, 0.5, 0.5)
for (const side of [-1, 1]) box(side * ARCH.halfWidth, ARCH.z, 1.5, 1.5)
COLLIDERS.push({ x: FOUNTAIN.x, z: FOUNTAIN.z, r: FOUNTAIN.radius + 0.1 })

/** What the player can interact with by walking up to it and pressing E. */
export const INTERACTABLES = [
  ...DATA.tables.map((t) => {
    // Just behind the chairs, towards the boardwalk: walking up the boardwalk's
    // side passes within reach of every table on that side.
    const [x, z] = tableLocal(t, 0, 1.6)
    return { kind: 'table', id: t.id, x, z, range: TABLE.sitRange }
  }),
  ...SHOP_CHAIRS.map((c) => {
    // In front of the pedestal, on the showroom's west side.
    const [dx, dz] = rotateXZ(0, 1.7, SHOP_FACING)
    return { kind: 'chair', id: c.id, x: c.shop[0] + dx, z: c.shop[1] + dz, range: 2.4 }
  }),
  { kind: 'emoteShop', id: 'emotes', x: EMOTE_SHOP.x + 1.6, z: EMOTE_SHOP.z, range: 3.5 },
  (() => {
    // In front of the counter.
    const [dx, dz] = rotateXZ(0, 1.6, EGG_STAND.ry)
    return { kind: 'eggs', id: 'eggs', x: EGG_STAND.x + dx, z: EGG_STAND.z + dz, range: 3.2 }
  })(),
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
export const petById = (id) => DATA.pets.find((p) => p.id === id) || null
export const eggById = (id) => DATA.eggs.find((e) => e.id === id) || null

/** What a pet does in a duel, in words: ['+2s each turn', '1 hint', …]. */
export function petPerks(pet) {
  if (!pet) return []
  const perks = []
  if (pet.time) perks.push(`⏱️ +${pet.time}s each turn`)
  if (pet.hints) perks.push(`💡 ${pet.hints} hint${pet.hints > 1 ? 's' : ''} per duel`)
  if (pet.shields) perks.push(`🛡️ ${pet.shields} heart shield`)
  if (pet.cash) perks.push(`💵 +${pet.cash}% cash`)
  return perks
}
