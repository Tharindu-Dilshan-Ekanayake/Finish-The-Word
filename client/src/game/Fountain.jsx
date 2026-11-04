import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  CircleGeometry,
  Color,
  DoubleSide,
  IcosahedronGeometry,
  LatheGeometry,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { fontReady, GAME_FONT } from './labels'
import { FOUNTAIN } from './layout'
import { useSettings } from './quality'
import { useDisposable } from './useDisposable'

/**
 * The plaza's centrepiece: a round fountain whose bowl is heaped with giant toy
 * letter blocks, a big "W" block turning above it and (on presets with particles)
 * water spilling over the bowl's rim into the basin.
 *
 * Draw calls: stonework (1, vertex-coloured), water (1), the heap of blocks (1, one
 * merged mesh), the turning block (1), droplets (1, MEDIUM/HIGH only).
 */

const WATER_Y = 0.55
const BOWL_RIM_Y = 3.75
const BOWL_RIM_R = 2.55
const TOP_BLOCK_Y = 5.4
const DROPS = 56
const DROP_GRAVITY = 7
const DROP_SPEED = 1.1

/** The letter atlas: 4 x 4 tiles of 64 px, 256 px in all (well inside the texture budget). */
const ATLAS = 256
const TILES = 4
const TILE = ATLAS / TILES
const LETTERS = 'FINSHTEWORDABCLY'
const TILE_COLORS = ['#ff4f5e', '#ffb02e', '#ffd23d', '#4fd05a', '#3fb6ff', '#8a5cff', '#ff6bd0', '#2fd1c4']

const _obj = new Object3D()
const _color = new Color()

/** A lathe from [radius, height] pairs, coloured by `colorAt(y)` (sRGB hex). */
function lathe(profile, segments, colorAt) {
  const geometry = new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
  )
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i += 1) {
    _color.set(colorAt(position.getY(i)))
    colors[i * 3] = _color.r
    colors[i * 3 + 1] = _color.g
    colors[i * 3 + 2] = _color.b
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

/** Basin wall, pedestal and bowl in one geometry. */
function createStoneGeometry() {
  const r = FOUNTAIN.radius
  const basin = lathe(
    [
      [r - 0.45, 0.2],
      [r - 0.45, 0.72],
      [r - 0.35, 0.82],
      [r + 0.05, 0.82],
      [r + 0.15, 0.72],
      [r + 0.15, 0.0],
    ],
    40,
    (y) => (y > 0.76 ? '#ffcf4a' : '#ec7a5c'),
  )
  const pedestal = lathe(
    [
      [0.01, 0.4],
      [1.25, 0.4],
      [1.25, 0.75],
      [0.75, 0.95],
      [0.55, 1.6],
      [0.5, 2.2],
      [0.85, 2.45],
      [0.01, 2.6],
    ],
    20,
    (y) => (y < 0.8 || y > 2.35 ? '#ffcf4a' : '#fff1d6'),
  )
  const bowl = lathe(
    [
      [0.01, 2.45],
      [1.1, 2.5],
      [2.05, 3.0],
      [BOWL_RIM_R, BOWL_RIM_Y - 0.2],
      [BOWL_RIM_R + 0.1, BOWL_RIM_Y],
      [BOWL_RIM_R - 0.12, BOWL_RIM_Y],
      [1.9, 3.2],
      [0.01, 3.1],
    ],
    28,
    (y) => (y > BOWL_RIM_Y - 0.28 ? '#ffffff' : '#e8343c'),
  )
  const merged = mergeGeometries([basin, pedestal, bowl])
  basin.dispose()
  pedestal.dispose()
  bowl.dispose()
  return merged
}

/** Soft light ripples on blue, scrolled slowly. 128 px. */
function createWaterTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#2fb6e8'
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.lineWidth = 3
  for (let row = 0; row < 6; row += 1) {
    ctx.beginPath()
    for (let x = 0; x <= size; x += 4) {
      const y = row * (size / 6) + 8 + Math.sin((x / size) * Math.PI * 4 + row * 1.7) * 5
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.repeat.set(3, 3)
  return texture
}

/** Draws the letter tiles: a bright square each, a white letter with a dark outline. */
function drawAtlas(canvas) {
  const ctx = canvas.getContext('2d')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.font = `700 ${Math.round(TILE * 0.66)}px ${GAME_FONT}`
  for (let i = 0; i < TILES * TILES; i += 1) {
    const x = (i % TILES) * TILE
    const y = Math.floor(i / TILES) * TILE
    ctx.fillStyle = TILE_COLORS[i % TILE_COLORS.length]
    ctx.fillRect(x, y, TILE, TILE)
    // A lighter bevel round the edge, like a wooden toy block.
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'
    ctx.lineWidth = 6
    ctx.strokeRect(x + 4, y + 4, TILE - 8, TILE - 8)
    ctx.lineWidth = 7
    ctx.strokeStyle = '#1d2433'
    ctx.strokeText(LETTERS[i], x + TILE / 2, y + TILE / 2 + 2)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(LETTERS[i], x + TILE / 2, y + TILE / 2 + 2)
  }
}

/** A unit cube whose six faces show the atlas tiles `tiles` (indices into LETTERS). */
function letterBlock(tiles) {
  const geometry = new BoxGeometry(1, 1, 1)
  const uv = geometry.getAttribute('uv')
  // BoxGeometry: 6 faces x 4 vertices, faces in +x, -x, +y, -y, +z, -z order.
  for (let face = 0; face < 6; face += 1) {
    const t = tiles[face % tiles.length]
    const col = t % TILES
    const row = Math.floor(t / TILES)
    for (let v = face * 4; v < face * 4 + 4; v += 1) {
      uv.setXY(v, (col + uv.getX(v)) / TILES, 1 - (row + 1 - uv.getY(v)) / TILES)
    }
  }
  return geometry
}

const tileOf = (letter) => LETTERS.indexOf(letter)

/** Blocks heaped in the bowl: [angle, distance from centre, yaw, tilt, size, letters]. */
const HEAP = [
  [0, 0.15, 0.3, 0.05, 1.35, 'WORD'],
  [0.9, 1.25, 0.8, 0.35, 1.05, 'FINS'],
  [2.1, 1.3, 2.1, 0.4, 1.1, 'HTEA'],
  [3.2, 1.25, 0.4, 0.3, 1.0, 'BCLY'],
  [4.3, 1.3, 1.4, 0.38, 1.08, 'OWRS'],
  [5.4, 1.2, 2.6, 0.32, 1.02, 'DAEN'],
  [1.5, 0.75, 1.1, 0.2, 0.9, 'TICH'],
  [3.8, 0.8, 0.2, 0.22, 0.95, 'LYFO'],
]

function createHeapGeometry() {
  const parts = HEAP.map(([a, d, yaw, tilt, size, letters]) => {
    const block = letterBlock([...letters].map(tileOf))
    _obj.position.set(Math.sin(a) * d, BOWL_RIM_Y - 0.3 + size * 0.35 + (1.3 - d) * 0.3, Math.cos(a) * d)
    // Leaning out from the middle of the heap.
    _obj.rotation.set(Math.cos(a) * tilt, yaw, -Math.sin(a) * tilt)
    _obj.scale.setScalar(size)
    _obj.updateMatrix()
    return block.applyMatrix4(_obj.matrix)
  })
  const merged = mergeGeometries(parts)
  for (const g of parts) g.dispose()
  return merged
}

function Droplets() {
  const ref = useRef(null)
  const res = useDisposable(
    () => ({ geometry: new IcosahedronGeometry(0.07, 0), material: new MeshBasicMaterial({ color: '#c9f3ff' }) }),
    [],
  )
  // Water spills over the rim and falls into the basin, in a loop: each drop's
  // path is worked out from the clock, so nothing is stored per drop.
  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const t = clock.elapsedTime
    // Time to fall from the rim to the water surface.
    const fall = Math.sqrt((2 * (BOWL_RIM_Y - WATER_Y)) / DROP_GRAVITY)
    for (let i = 0; i < DROPS; i += 1) {
      const a = (i / DROPS) * Math.PI * 2
      const local = (t + (i * 0.618) % 1 * fall) % fall
      const r = BOWL_RIM_R + 0.08 + local * DROP_SPEED
      _obj.position.set(Math.sin(a) * r, BOWL_RIM_Y - 0.5 * DROP_GRAVITY * local * local, Math.cos(a) * r)
      _obj.scale.set(1, 1.6, 1)
      _obj.updateMatrix()
      mesh.setMatrixAt(i, _obj.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })
  return <instancedMesh ref={ref} args={[res.geometry, res.material, DROPS]} frustumCulled={false} />
}

export function Fountain() {
  const { particles, shadows } = useSettings()
  const topRef = useRef(null)

  const res = useDisposable(() => {
    const water = createWaterTexture()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = ATLAS
    drawAtlas(canvas)
    const letters = new CanvasTexture(canvas)
    letters.colorSpace = SRGBColorSpace
    letters.anisotropy = 4
    return {
      water,
      letters,
      stone: createStoneGeometry(),
      stoneMaterial: new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
      waterGeometry: new CircleGeometry(FOUNTAIN.radius - 0.4, 40).rotateX(-Math.PI / 2),
      waterMaterial: new MeshPhongMaterial({ map: water, shininess: 90, specular: '#e8fbff' }),
      heap: createHeapGeometry(),
      top: letterBlock([...'WORDWO'].map(tileOf)),
      blockMaterial: new MeshLambertMaterial({ map: letters }),
    }
  }, [])

  // Redrawn once the game font is in (the first draw used the fallback font).
  useEffect(() => {
    let cancelled = false
    fontReady.then(() => {
      if (cancelled) return
      drawAtlas(res.letters.image)
      res.letters.needsUpdate = true
    })
    return () => {
      cancelled = true
    }
  }, [res])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    res.water.offset.set(t * 0.03, t * 0.05)
    const top = topRef.current
    if (!top) return
    // The big block turns and bobs over the bowl, tipped onto a corner a little.
    top.position.y = TOP_BLOCK_Y + Math.sin(t * 1.3) * 0.25
    top.rotation.set(0.25, t * 0.7, 0.2)
  })

  return (
    // Built round its own origin; stands in the plaza at the boardwalk's north end.
    <group position={[FOUNTAIN.x, 0, FOUNTAIN.z]}>
      <mesh geometry={res.stone} material={res.stoneMaterial} castShadow={shadows} receiveShadow />
      <mesh geometry={res.waterGeometry} material={res.waterMaterial} position={[0, WATER_Y, 0]} />
      <mesh geometry={res.heap} material={res.blockMaterial} castShadow={shadows} />
      <mesh ref={topRef} geometry={res.top} material={res.blockMaterial} scale={1.8} castShadow={shadows} />
      {particles && <Droplets />}
    </group>
  )
}

export default Fountain
