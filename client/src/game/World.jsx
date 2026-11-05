import { useLayoutEffect, useMemo } from 'react'
import { BoxGeometry, MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial, PlaneGeometry } from 'three'

import { FLOOR, ISLANDS, ROCKS, TREES, WORLD_HALF } from './layout'
import Leaderboards from './Leaderboards'
import { createPlazaGeometry, LAMP_BULBS, lobbyBoxes } from './lobby'
import { useSettings } from './quality'
import { FENCE, GROUND, OCEAN } from './sceneStyle'
import Shops from './Shops'
import Tables from './Tables'
import { createStudTexture, createWorldBoxGeometry } from './textures'
import { archBoxes } from './arch'
import { treeBoxes } from './trees'
import ContactShadows from './ContactShadows'
import ArchSign from './ArchGate'
import Fountain from './Fountain'
import GuideBoard from './GuideBoard'
import Instanced from './Instanced'
import { mergedBoxes } from './instancing'
import { useDisposable } from './useDisposable'

/** World size of one ground texture repeat (4 x 4 studs of 0.5 units). */
const GROUND_TILE = 2
const FENCE_HEIGHT = 1.3
const FENCE_POST_SPACING = 3

/** Every post position for a straight fence from [x1, z1] to [x2, z2]. */
function fencePosts(x1, z1, x2, z2) {
  const length = Math.hypot(x2 - x1, z2 - z1)
  const count = Math.max(2, Math.round(length / FENCE_POST_SPACING) + 1)
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    return { p: [x1 + (x2 - x1) * t, FENCE_HEIGHT / 2, z1 + (z2 - z1) * t] }
  })
}

/** Two rails for a straight, axis-aligned fence. */
function fenceRails(x1, z1, x2, z2) {
  const alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1)
  const length = Math.hypot(x2 - x1, z2 - z1)
  const cx = (x1 + x2) / 2
  const cz = (z1 + z2) / 2
  return [0.5, 1.0].map((y) => ({
    size: alongX ? [length, 0.2, 0.12] : [0.12, 0.2, length],
    at: [cx, y, cz],
  }))
}

const H = WORLD_HALF
const SAND = '#f3d98d'

/** Small deterministic hash so decoration varies but never between reloads. */
const vary = (i, k) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return v - Math.floor(v)
}

/**
 * All the box-built scenery (beach, distant islands, trees, rocks, the welcome
 * arch, and the boardwalk's lamp posts, bunting, planters and props) as instances of one
 * unit cube: one draw call.
 */
function sceneryBoxes() {
  const items = [
    // The island's beach, a ring of sand showing around the baseplate.
    { p: [0, -0.6, 0], s: [H * 2 + 10, 1, H * 2 + 10], c: SAND },
  ]
  for (const [x, z, w, d] of ISLANDS) {
    items.push({ p: [x, -0.6, z], s: [w + 6, 1.2, d + 6], c: SAND })
    items.push({ p: [x, 0, z], s: [w, 1.6, d], c: GROUND.base })
  }
  items.push(...treeBoxes(TREES))
  ROCKS.forEach(([x, z, size], i) => {
    items.push({ p: [x, -0.1 + size * 0.25, z], s: [size, size * 0.7, size * 0.9], ry: vary(i, 9) * 3, c: i % 2 ? '#8c9096' : '#a3a6ab' })
  })
  items.push(...archBoxes())
  items.push(...lobbyBoxes())
  return items
}
const FENCES = [
  [-H, -H, H, -H],
  [-H, H, H, H],
  [-H, -H, -H, H],
  [H, -H, H, H],
]

// Static: built once at module load.
const SCENERY = sceneryBoxes()

/**
 * The island: a grassy studded baseplate fenced in on all sides, ringed by ocean,
 * with the summer boardwalk and its word-board decks down the middle (see layout.js
 * and lobby.js), voxel palms around the edge and smaller islands on the horizon.
 *
 * Repeated props are instanced and multi-part props are merged, so the whole
 * landscape is a dozen or so draw calls.
 *
 * @param {{ extras?: 'off' | 'warming' | 'on' }} props `extras` controls the shops and
 *   leaderboards, which GameScene holds back until the game is playable.
 */
export function World({ extras = 'on' }) {
  const settings = useSettings()
  const shadows = settings.shadows

  const res = useDisposable(() => {
    const groundTexture = createStudTexture({ base: GROUND.base, alt: GROUND.alt })
    return {
      groundTexture,
      ground: new MeshLambertMaterial({ map: groundTexture }),
      baseGeometry: createWorldBoxGeometry(H * 2, 1, H * 2, GROUND_TILE),
      ocean: new MeshPhongMaterial({ color: OCEAN.color, shininess: 60, specular: '#cfefff' }),
      oceanGeometry: new PlaneGeometry(1600, 1600),
      box: new BoxGeometry(1, 1, 1),
      // Instance colour does the tinting; the base colour stays white.
      tinted: new MeshLambertMaterial({ color: '#ffffff' }),
      wood: new MeshLambertMaterial({ color: FENCE.rail }),
      post: new MeshLambertMaterial({ color: FENCE.post }),
      postGeometry: new BoxGeometry(0.3, FENCE_HEIGHT, 0.3),
      railGeometry: mergedBoxes(FENCES.flatMap((f) => fenceRails(...f))),
      // White tiles: the plaza's vertex colours paint them.
      plazaTexture: createStudTexture({ base: '#ffffff', alt: '#f2f2f2', size: 256 }),
      plazaGeometry: createPlazaGeometry(GROUND_TILE),
      bulb: new MeshBasicMaterial({ color: '#fff3b0' }),
    }
  }, [])
  const plazaMaterial = useDisposable(
    () =>
      new MeshLambertMaterial({
        map: res.plazaTexture,
        vertexColors: true,
        // Sits just above the baseplate; the offset stops distant flicker.
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    [res],
  )

  useLayoutEffect(() => {
    for (const t of [res.groundTexture, res.plazaTexture]) {
      t.anisotropy = settings.anisotropy
      t.needsUpdate = true
    }
  }, [res, settings.anisotropy])

  const posts = useMemo(() => FENCES.flatMap((f) => fencePosts(...f)), [])

  return (
    <>
      <mesh geometry={res.baseGeometry} material={res.ground} position={[0, -0.5, 0]} receiveShadow />
      <mesh geometry={res.oceanGeometry} material={res.ocean} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.7, 0]} />

      <mesh geometry={res.plazaGeometry} material={plazaMaterial} position={[0, FLOOR.plaza, 0]} receiveShadow />
      <Instanced geometry={res.box} material={res.tinted} items={SCENERY} castShadow={shadows} receiveShadow />
      <Instanced geometry={res.box} material={res.bulb} items={LAMP_BULBS} />
      <Instanced geometry={res.postGeometry} material={res.post} items={posts} castShadow={shadows} />
      <mesh geometry={res.railGeometry} material={res.wood} castShadow={shadows} />
      <ArchSign />
      <Fountain />
      <GuideBoard />
      {/* Realtime shadows are off on LOW: soft baked ones keep the depth. */}
      {!shadows && <ContactShadows />}

      <Tables />
      {extras !== 'off' && (
        // Mounted hidden while their shaders compile in the background (see
        // ShaderWarmup in GameScene), then shown.
        <group visible={extras === 'on'}>
          <Shops />
          <Leaderboards />
        </group>
      )}
    </>
  )
}

export default World
