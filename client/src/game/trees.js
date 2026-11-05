/**
 * Voxel trees, built from boxes for the world's shared scenery mesh (no draw calls
 * of their own). Two kinds for the summer island, picked per tree, each turned and
 * scaled a little so no two look alike:
 *
 *   palm - a leaning ringed trunk, coconuts and drooping fronds
 *   oak  - chunky rounded canopy in two greens, a branch, roots and a few apples
 */

const BARK = '#7a4a26'
const BARK_DARK = '#5e3820'

/** Deterministic 0..1 per tree, so the forest is the same on every load. */
const rand = (i, k) => {
  const v = Math.sin(i * 91.17 + k * 47.31) * 43758.5453
  return v - Math.floor(v)
}

/** Boxes of an oak-style tree: [offset, size, colour, extra yaw]. */
function roundTree(leaves, accent) {
  const [base, shade, light] = leaves
  const parts = [
    // Trunk, roots and one branch.
    [[0, 1.3, 0], [0.7, 2.6, 0.7], BARK],
    [[0.45, 0.15, 0], [0.4, 0.3, 0.4], BARK_DARK],
    [[-0.45, 0.15, 0.1], [0.4, 0.3, 0.4], BARK_DARK],
    [[0, 0.15, 0.45], [0.4, 0.3, 0.4], BARK_DARK],
    [[0.65, 2.3, 0], [0.9, 0.26, 0.26], BARK],
    // Canopy: a core, four side bulges, a top and a crown.
    [[0, 3.7, 0], [3.2, 2.2, 3.2], base],
    [[1.75, 3.5, 0.2], [0.9, 1.5, 2.2], shade],
    [[-1.75, 3.6, -0.2], [0.9, 1.5, 2.2], shade],
    [[0.2, 3.5, 1.75], [2.2, 1.5, 0.9], shade],
    [[-0.2, 3.6, -1.75], [2.2, 1.5, 0.9], shade],
    [[0, 5.0, 0], [2.4, 1.0, 2.4], light],
    [[0.2, 5.7, -0.1], [1.3, 0.6, 1.3], light],
  ]
  if (accent) {
    // Fruit / flowers dotted over the canopy.
    for (const at of [[1.62, 3.9, 1.0], [-1.0, 4.3, 1.62], [0.6, 3.0, -1.62], [-1.62, 3.2, -0.6]]) {
      parts.push([at, [0.3, 0.3, 0.3], accent])
    }
  }
  return parts
}

const PALM_TRUNK = ['#b07a45', '#9a6638']
const FRONDS = ['#3fae3a', '#5fd65a']
const FROND_COUNT = 7
const FROND_SEGMENTS = 3

/**
 * A palm: a ringed trunk leaning a little more with each block, coconuts under the
 * crown and fronds radiating out, each stepping down towards its tip. A frond
 * segment is a flat box along its own X, so `ry` alone aims it.
 */
function palmTree() {
  const parts = []
  const blocks = 7
  let lean = 0
  for (let k = 0; k < blocks; k += 1) {
    lean += 0.06 + k * 0.012
    parts.push([[lean, 0.35 + k * 0.62, 0], [0.5 - k * 0.025, 0.64, 0.5 - k * 0.025], PALM_TRUNK[k % 2]])
  }
  const topX = lean
  const topY = 0.35 + blocks * 0.62
  for (const [cx, cz] of [[0.22, 0.12], [-0.18, 0.16], [0.02, -0.22]]) {
    parts.push([[topX + cx, topY - 0.25, cz], [0.28, 0.28, 0.28], '#6b4a26'])
  }
  parts.push([[topX, topY + 0.05, 0], [0.7, 0.3, 0.7], FRONDS[0]])
  for (let f = 0; f < FROND_COUNT; f += 1) {
    const a = (f / FROND_COUNT) * Math.PI * 2
    for (let s = 0; s < FROND_SEGMENTS; s += 1) {
      const d = 0.6 + s * 0.62
      parts.push([
        [topX + Math.cos(a) * d, topY + 0.1 - s * s * 0.16, -Math.sin(a) * d],
        [0.72, 0.1, 0.42 - s * 0.08],
        FRONDS[(f + s) % 2],
        a,
      ])
    }
  }
  return parts
}

const OAK = () => roundTree(['#3fae3a', '#379a33', '#5fd65a'], '#e8382f')
const KINDS = [palmTree, OAK, palmTree, palmTree, OAK, palmTree, palmTree, OAK]

/**
 * Every box of every tree, as instances ({ p, s, c, ry }).
 * @param {Array<[number, number]>} spots tree positions [x, z]
 */
export function treeBoxes(spots) {
  const boxes = []
  spots.forEach(([x, z], i) => {
    const parts = KINDS[i % KINDS.length]()
    const scale = 0.85 + rand(i, 1) * 0.35
    const yaw = rand(i, 2) * Math.PI * 2
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    for (const [[ox, oy, oz], [w, h, d], c, ry = 0] of parts) {
      boxes.push({
        p: [x + (ox * cos + oz * sin) * scale, oy * scale, z + (-ox * sin + oz * cos) * scale],
        s: [w * scale, h * scale, d * scale],
        c,
        ry: yaw + ry,
      })
    }
  })
  return boxes
}
