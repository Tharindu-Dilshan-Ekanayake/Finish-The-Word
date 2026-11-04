import { BufferAttribute, Color } from 'three'

import { mergedBoxes } from './instancing'

/**
 * Voxel pets, each species one merged box geometry with its colours baked into
 * vertex colours: one instanced draw call per species, however many follow players
 * around. About 300 triangles each. Built facing +Z, feet at y = 0, ~0.6 tall.
 */

const EYE = '#1d2433'
const WHITE = '#ffffff'
const BEAK = '#ffb21e'
const _color = new Color()

/** [size, at, colour] parts -> one geometry with per-part vertex colours. */
function build(parts) {
  const geometry = mergedBoxes(parts.map(([size, at]) => ({ size, at })))
  const colors = new Float32Array(geometry.getAttribute('position').count * 3)
  // mergedBoxes keeps part order and a BoxGeometry has 24 vertices.
  parts.forEach(([, , hex], i) => {
    _color.set(hex)
    for (let v = i * 24; v < (i + 1) * 24; v += 1) {
      colors[v * 3] = _color.r
      colors[v * 3 + 1] = _color.g
      colors[v * 3 + 2] = _color.b
    }
  })
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

const pair = (part) => [part, [part[0], [-part[1][0], part[1][1], part[1][2]], part[2]]]

/** Four legs, a body, a head with eyes and nose; ears and tail by species. */
function pup(pet) {
  const [main, accent] = pet.colors
  const parts = [
    [[0.34, 0.24, 0.44], [0, 0.25, 0], main],
    [[0.26, 0.04, 0.34], [0, 0.13, 0.02], accent],
    [[0.32, 0.3, 0.3], [0, 0.5, 0.2], main],
    [[0.16, 0.1, 0.1], [0, 0.43, 0.38], accent],
    [[0.06, 0.05, 0.03], [0, 0.46, 0.44], EYE],
    ...pair([[0.05, 0.07, 0.02], [0.08, 0.54, 0.355], EYE]),
    ...pair([[0.08, 0.14, 0.08], [0.11, 0.07, 0.14], main]),
    ...pair([[0.08, 0.14, 0.08], [0.11, 0.07, -0.14], main]),
  ]
  if (pet.ears === 'long') {
    parts.push(...pair([[0.07, 0.28, 0.05], [0.08, 0.78, 0.18], main]))
    parts.push(...pair([[0.035, 0.2, 0.02], [0.08, 0.78, 0.21], accent]))
    parts.push([[0.12, 0.12, 0.12], [0, 0.3, -0.26], WHITE])
  } else if (pet.ears === 'flop') {
    parts.push(...pair([[0.06, 0.18, 0.13], [0.18, 0.52, 0.18], accent]))
    parts.push([[0.06, 0.06, 0.16], [0, 0.36, -0.28], main])
  } else {
    parts.push(...pair([[0.09, 0.11, 0.06], [0.1, 0.69, 0.18], main]))
    parts.push(...pair([[0.045, 0.06, 0.02], [0.1, 0.68, 0.215], accent]))
    // A long tail with a light tip (fox, cat), raised.
    parts.push([[0.08, 0.08, 0.2], [0, 0.34, -0.3], main])
    parts.push([[0.09, 0.09, 0.08], [0, 0.38, -0.43], accent])
  }
  if (pet.horn) {
    parts.push([[0.05, 0.2, 0.05], [0, 0.74, 0.3], '#ffd23d'])
    parts.push([[0.06, 0.22, 0.26], [0, 0.56, 0.06], accent])
  }
  return parts
}

/** A round bird: belly, wings, beak and feet; tufts for the owl, a long tail for the parrot. */
function bird(pet) {
  const [main, accent] = pet.colors
  const owl = pet.id === 'owl'
  const parts = [
    [[0.32, 0.34, 0.3], [0, 0.28, 0], main],
    [[0.22, 0.22, 0.02], [0, 0.26, 0.155], owl ? accent : WHITE],
    [[0.3, 0.22, 0.28], [0, 0.55, 0.02], main],
    ...pair([[0.1, 0.1, 0.02], [0.075, 0.57, 0.165], WHITE]),
    ...pair([[0.05, 0.05, 0.02], [0.075, 0.57, 0.18], EYE]),
    [[0.06, 0.06, 0.07], [0, 0.5, 0.19], owl ? BEAK : accent],
    ...pair([[0.05, 0.24, 0.22], [0.18, 0.3, -0.01], owl ? main : accent]),
    ...pair([[0.07, 0.03, 0.09], [0.07, 0.015, 0.05], BEAK]),
  ]
  if (owl) parts.push(...pair([[0.06, 0.09, 0.04], [0.1, 0.7, 0.02], main]))
  else parts.push([[0.1, 0.04, 0.3], [0, 0.18, -0.27], accent])
  return parts
}

/** A shell on four stubby legs. */
function turtle(pet) {
  const [main, accent] = pet.colors
  return [
    [[0.46, 0.16, 0.5], [0, 0.17, 0], accent],
    [[0.34, 0.1, 0.38], [0, 0.29, 0], '#a8743a'],
    [[0.16, 0.06, 0.18], [0, 0.36, 0], accent],
    [[0.18, 0.16, 0.2], [0, 0.2, 0.32], main],
    ...pair([[0.04, 0.05, 0.02], [0.055, 0.24, 0.42], EYE]),
    ...pair([[0.11, 0.08, 0.11], [0.19, 0.05, 0.17], main]),
    ...pair([[0.11, 0.08, 0.11], [0.19, 0.05, -0.17], main]),
    [[0.06, 0.05, 0.1], [0, 0.12, -0.28], main],
  ]
}

/** A wide body, eyes on stalks, two big claws and six legs. */
function crab(pet) {
  const [main, accent] = pet.colors
  const parts = [
    [[0.42, 0.16, 0.3], [0, 0.17, 0], main],
    [[0.3, 0.04, 0.22], [0, 0.27, 0], accent],
    ...pair([[0.04, 0.12, 0.04], [0.08, 0.31, 0.1], main]),
    ...pair([[0.08, 0.08, 0.08], [0.08, 0.39, 0.1], WHITE]),
    ...pair([[0.04, 0.04, 0.02], [0.08, 0.39, 0.145], EYE]),
    ...pair([[0.13, 0.05, 0.05], [0.22, 0.18, 0.12], main]),
    ...pair([[0.14, 0.13, 0.14], [0.3, 0.22, 0.2], main]),
  ]
  for (const z of [-0.1, 0, 0.1]) parts.push(...pair([[0.14, 0.04, 0.04], [0.25, 0.08, z], accent]))
  return parts
}

/** A little dragon: the pup's body with wings, horns, back spikes and a long tail. */
function dragon(pet) {
  const [main, accent] = pet.colors
  return [
    ...pup({ ...pet, ears: 'none' }).filter((_, i) => i < 11),
    ...pair([[0.04, 0.22, 0.32], [0.22, 0.44, -0.04], accent]),
    ...pair([[0.05, 0.13, 0.05], [0.08, 0.71, 0.14], accent]),
    [[0.06, 0.07, 0.06], [0, 0.4, 0.1], accent],
    [[0.06, 0.07, 0.06], [0, 0.4, -0.05], accent],
    [[0.06, 0.07, 0.06], [0, 0.4, -0.18], accent],
    [[0.08, 0.08, 0.26], [0, 0.26, -0.32], main],
    [[0.1, 0.1, 0.08], [0, 0.28, -0.48], accent],
  ]
}

const BUILDERS = { pup, bird, turtle, crab, dragon }

/** The geometry for one species (a DATA.pets entry). */
export function createPetGeometry(pet) {
  return build((BUILDERS[pet.kind] || pup)(pet))
}

/** Flying pets hover at shoulder height instead of trotting on the ground. */
export const FLIES = new Set(['bird', 'dragon'])
