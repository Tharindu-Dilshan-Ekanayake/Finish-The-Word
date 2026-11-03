import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import {
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

import { createChipGeometry } from './chipGeometry'
import { FOUNTAIN } from './layout'
import { useSettings } from './quality'
import { useDisposable } from './useDisposable'

/**
 * The plaza's centrepiece: a round fountain whose bowl is heaped with giant chips,
 * a huge golden chip turning above it and (on presets with particles) water
 * spilling over the bowl's rim into the basin.
 *
 * Draw calls: stonework (1, vertex-coloured), water (1), giant chips (1, instanced,
 * the golden one included), droplets (1, MEDIUM/HIGH only).
 */

const WATER_Y = 0.55
const BOWL_RIM_Y = 3.75
const BOWL_RIM_R = 2.55
const GOLDEN_Y = 5.3
const DROPS = 56
const DROP_GRAVITY = 7
const DROP_SPEED = 1.1

const _obj = new Object3D()
/** The golden chip stands up first, then spins about the vertical: yaw last. */
const _spin = new Object3D()
_spin.rotation.order = 'YXZ'
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

/** Giant chips heaped in the bowl: [angle, distance from centre, tilt, scale]. */
const HEAP = [
  [0, 0.2, 0.15, 7.5],
  [0.9, 1.2, 0.55, 6.5],
  [2.1, 1.3, 0.6, 6.8],
  [3.2, 1.25, 0.5, 6.2],
  [4.3, 1.3, 0.62, 6.6],
  [5.4, 1.2, 0.5, 6.4],
  [1.5, 0.7, 0.35, 5.6],
  [3.8, 0.75, 0.3, 5.8],
]
/** Instance 0 is the golden chip; the heap follows. */
const CHIP_COUNT = HEAP.length + 1

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
  const chipsRef = useRef(null)

  const res = useDisposable(() => {
    const water = createWaterTexture()
    return {
      water,
      stone: createStoneGeometry(),
      stoneMaterial: new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
      waterGeometry: new CircleGeometry(FOUNTAIN.radius - 0.4, 40).rotateX(-Math.PI / 2),
      waterMaterial: new MeshPhongMaterial({ map: water, shininess: 90, specular: '#e8fbff' }),
      chip: createChipGeometry(),
      chipMaterial: new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
    }
  }, [])

  useLayoutEffect(() => {
    const mesh = chipsRef.current
    HEAP.forEach(([a, d, tilt, scale], k) => {
      _obj.position.set(Math.sin(a) * d, BOWL_RIM_Y - 0.15 + (1.3 - d) * 0.25, Math.cos(a) * d)
      // Leaning out from the middle of the heap.
      _obj.rotation.set(Math.cos(a) * tilt, a, -Math.sin(a) * tilt)
      _obj.scale.setScalar(scale)
      _obj.updateMatrix()
      mesh.setMatrixAt(k + 1, _obj.matrix)
      mesh.setColorAt(k + 1, _color.set(k % 2 ? '#f9cc4f' : '#f3bb34'))
    })
    mesh.setColorAt(0, _color.set('#ffd84a'))
    mesh.instanceColor.needsUpdate = true
  }, [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    res.water.offset.set(t * 0.03, t * 0.05)
    const mesh = chipsRef.current
    if (!mesh) return
    // The golden chip stands on its edge like a coin, turning and bobbing over the bowl.
    _spin.position.set(0, GOLDEN_Y + Math.sin(t * 1.3) * 0.25, 0)
    _spin.rotation.set(1.3, t * 0.9, 0)
    _spin.scale.setScalar(5)
    _spin.updateMatrix()
    mesh.setMatrixAt(0, _spin.matrix)
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <mesh geometry={res.stone} material={res.stoneMaterial} castShadow={shadows} receiveShadow />
      <mesh geometry={res.waterGeometry} material={res.waterMaterial} position={[0, WATER_Y, 0]} />
      <instancedMesh
        ref={chipsRef}
        args={[res.chip, res.chipMaterial, CHIP_COUNT]}
        castShadow={shadows}
        frustumCulled={false}
      />
      {particles && <Droplets />}
    </>
  )
}

export default Fountain
