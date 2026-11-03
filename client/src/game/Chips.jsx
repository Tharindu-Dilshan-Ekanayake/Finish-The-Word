import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { BoxGeometry, Color, DoubleSide, MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry } from 'three'

import { useGame } from '../net/gameStore'
import { chipAction, tapChip } from './chipActions'
import { createChipGeometry, createLinerTexture, createSlapTexture } from './chipGeometry'
import { CELLS, chipLocal, DATA, PLATE_SIZE, plateCenterLocal, TABLE, tableLocal } from './layout'
import { useDisposable } from './useDisposable'

/**
 * The chips on every table, in five draw calls whatever happens:
 *   - two plate liners per table (seat 0's red, seat 1's blue: one mesh each),
 *   - every chip of every plate (one instanced mesh, 180 chips),
 *   - the slap markers (one instanced mesh from a fixed pool).
 *
 * Chip state is public (Colyseus table state), so spectators see chips vanish and
 * slaps turn up at every table. At the player's own table the chips also bob when
 * they can be tapped, lift on hover and float up while a bite is being decided, and
 * the player's own hidden slaps show as little hand stickers on their chips.
 *
 * Painted from store subscriptions (no React re-render); the frame loop only moves
 * the player's own 18 chips, and only while they're seated.
 */

const PER_TABLE = CELLS * 2
const COUNT = DATA.tables.length * PER_TABLE
const MARKERS = 72
const LINER_H = 0.025
const LINER_Y = TABLE.height + LINER_H / 2
/** Chip centre: the saddle's lowest points just touch the liner. */
const CHIP_Y = TABLE.height + LINER_H + 0.065
const FLAT_MARKER_Y = TABLE.height + LINER_H + 0.004
const STICKER_Y = CHIP_Y + 0.15

const CHIP_TINTS = ['#f7c43f', '#f9cc4f', '#f3bb34', '#fad35c'].map((c) => new Color(c))
const DRAFT_TINT = new Color('#ffe9a8')

const TABLE_INDEX = new Map(DATA.tables.map((t, i) => [t.id, i]))

/** Deterministic 0..1 per chip, so the chips look the same on every load. */
const vary = (i, k) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return v - Math.floor(v)
}

/** Static placement of every chip: world x, z and yaw. */
const BASE = new Float32Array(COUNT * 3)
DATA.tables.forEach((t, ti) => {
  for (let p = 0; p < 2; p += 1) {
    for (let c = 0; c < CELLS; c += 1) {
      const i = ti * PER_TABLE + p * CELLS + c
      const [lx, lz] = chipLocal(p, c)
      const [x, z] = tableLocal(t, lx, lz)
      BASE[i * 3] = x
      BASE[i * 3 + 1] = z
      BASE[i * 3 + 2] = t.ry + (vary(i, 1) - 0.5) * 0.9
    }
  }
})

const LINERS = [0, 1].map((p) =>
  DATA.tables.map((t) => {
    const [lx, lz] = plateCenterLocal(p)
    const [x, z] = tableLocal(t, lx, lz)
    return { x, z, ry: t.ry }
  }),
)

const decode = (i) => {
  const ti = Math.floor(i / PER_TABLE)
  const rest = i % PER_TABLE
  return { tableId: DATA.tables[ti].id, plate: Math.floor(rest / CELLS), cell: rest % CELLS }
}

const _obj = new Object3D()
/** Markers tilt about their own X axis before turning with the table: yaw last. */
const _marker = new Object3D()
_marker.rotation.order = 'YXZ'
/** Stickers over chips lean back towards the duel camera so they read face-on. */
const STICKER_TILT = 0.95
const _color = new Color()

/** Chip visibility per instance, from the last paint. */
const shown = new Uint8Array(COUNT)

function placeChip(mesh, i, lift = 0, scale = 1) {
  _obj.position.set(BASE[i * 3], CHIP_Y + lift, BASE[i * 3 + 1])
  _obj.rotation.set(0, BASE[i * 3 + 2], 0)
  _obj.scale.setScalar(shown[i] ? scale : 0)
  _obj.updateMatrix()
  mesh.setMatrixAt(i, _obj.matrix)
}

/** Writes one marker: a flat slap disc on the liner, or a sticker over a chip. */
function placeMarker(mesh, n, i, table, size, y, tilt = 0) {
  _marker.position.set(BASE[i * 3], y, BASE[i * 3 + 1])
  // Upright for the duel camera, which looks along the table's +Z.
  _marker.rotation.set(tilt, table.ry + Math.PI, 0)
  _marker.scale.set(size, 1, size)
  _marker.updateMatrix()
  mesh.setMatrixAt(n, _marker.matrix)
}

function paintAll(chips, markers, state) {
  const { tables, match, draft } = state
  let n = 0
  const mine = match ? TABLE_INDEX.get(match.table) : -1

  DATA.tables.forEach((t, ti) => {
    const pub = tables[t.id]
    for (let p = 0; p < 2; p += 1) {
      const plate = pub?.plates[p] || ''
      const revealed = pub?.shown[p] || ''
      for (let c = 0; c < CELLS; c += 1) {
        const i = ti * PER_TABLE + p * CELLS + c
        const ch = plate[c] || '0'
        shown[i] = ch === '0' ? 1 : 0
        let tint = CHIP_TINTS[i % CHIP_TINTS.length]

        let sticker = false
        if (ti === mine && p === match.seat) {
          const hiding = match.phase === 'hiding' && !match.hidden
          sticker = hiding ? draft.includes(c) : match.mySlaps.includes(c)
          if (hiding && sticker) tint = DRAFT_TINT
        }
        chips.setColorAt(i, _color.copy(tint))

        if (n >= MARKERS) continue
        if (ch === '2') {
          placeMarker(markers, n++, i, t, 0.36, FLAT_MARKER_Y)
        } else if (ch === '0' && (sticker || revealed.includes(c.toString(36)))) {
          placeMarker(markers, n++, i, t, 0.27, STICKER_Y, STICKER_TILT)
        }
      }
    }
  })

  for (let i = 0; i < COUNT; i += 1) placeChip(chips, i)
  chips.instanceMatrix.needsUpdate = true
  chips.instanceColor.needsUpdate = true
  markers.count = n
  markers.visible = n > 0
  markers.instanceMatrix.needsUpdate = true
}

export function Chips() {
  const chipsRef = useRef(null)
  const markersRef = useRef(null)
  const hover = useRef(-1)
  const gl = useThree((s) => s.gl)

  const res = useDisposable(() => {
    const slap = createSlapTexture()
    const red = createLinerTexture('#ff6b6b', '#c63a3a')
    const blue = createLinerTexture('#5aaaff', '#2f6fc0')
    return {
      slap,
      red,
      blue,
      chip: createChipGeometry(),
      chipMaterial: new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
      liner: new BoxGeometry(PLATE_SIZE[0], LINER_H, PLATE_SIZE[1]),
      redMaterial: new MeshLambertMaterial({ map: red }),
      blueMaterial: new MeshLambertMaterial({ map: blue }),
      marker: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      markerMaterial: new MeshBasicMaterial({
        map: slap,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    }
  }, [])

  const redRef = useRef(null)
  const blueRef = useRef(null)

  useEffect(() => {
    LINERS.forEach((items, p) => {
      const mesh = (p === 0 ? redRef : blueRef).current
      items.forEach((l, k) => {
        _obj.position.set(l.x, LINER_Y, l.z)
        // Seen from the duel camera (along the table's +Z), the checker's top row is
        // the far one, like the chips' cell order.
        _obj.rotation.set(0, l.ry + Math.PI, 0)
        _obj.scale.setScalar(1)
        _obj.updateMatrix()
        mesh.setMatrixAt(k, _obj.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    })

    const chips = chipsRef.current
    const markers = markersRef.current
    // Bounds for raycasting and culling: every chip at full size.
    shown.fill(1)
    for (let i = 0; i < COUNT; i += 1) placeChip(chips, i)
    chips.computeBoundingSphere()

    const paint = () => paintAll(chips, markers, useGame.getState())
    paint()
    return useGame.subscribe((s, prev) => {
      if (s.tables !== prev.tables || s.match !== prev.match || s.draft !== prev.draft) paint()
    })
  }, [])

  // Your own table's chips come alive: bob when tappable, lift under the pointer,
  // float and shake while a bite is being decided.
  useFrame(({ clock }) => {
    const state = useGame.getState()
    const match = state.match
    const chips = chipsRef.current
    if (!match || !chips) return
    const ti = TABLE_INDEX.get(match.table)
    const t = clock.elapsedTime
    const now = Date.now()
    const reveal = state.reveal
    const bitePlate = reveal && !reveal.kind && reveal.until > now ? (reveal.mine ? 1 - match.seat : match.seat) : -1

    for (let p = 0; p < 2; p += 1) {
      for (let c = 0; c < CELLS; c += 1) {
        const i = ti * PER_TABLE + p * CELLS + c
        if (p === bitePlate && reveal.cell === c) {
          // Lifted for the bite, floating gently: no shaking.
          placeChip(chips, i, 0.18 + Math.sin(t * 3) * 0.02, 1.2)
        } else if (chipAction(match.table, p, c, state)) {
          const hovered = hover.current === i
          placeChip(chips, i, hovered ? 0.09 : 0.025 + Math.sin(t * 4 + c) * 0.02, hovered ? 1.22 : 1)
        } else {
          placeChip(chips, i)
        }
      }
    }
    chips.instanceMatrix.needsUpdate = true
  })

  const setHover = (i) => {
    if (hover.current === i) return
    hover.current = i
    gl.domElement.style.cursor = i >= 0 ? 'pointer' : 'grab'
  }

  const targetOf = (e) => {
    const i = e.instanceId
    if (i === undefined) return -1
    const { tableId, plate, cell } = decode(i)
    return chipAction(tableId, plate, cell) ? i : -1
  }

  return (
    <>
      <instancedMesh ref={redRef} args={[res.liner, res.redMaterial, DATA.tables.length]} receiveShadow />
      <instancedMesh ref={blueRef} args={[res.liner, res.blueMaterial, DATA.tables.length]} receiveShadow />
      <instancedMesh
        ref={chipsRef}
        args={[res.chip, res.chipMaterial, COUNT]}
        onPointerMove={(e) => setHover(targetOf(e))}
        onPointerOut={() => setHover(-1)}
        onClick={(e) => {
          // A camera drag that happens to end on a chip is not a tap.
          if (e.delta > 8 || e.instanceId === undefined) return
          const { tableId, plate, cell } = decode(e.instanceId)
          if (tapChip(tableId, plate, cell)) e.stopPropagation()
        }}
      />
      <instancedMesh ref={markersRef} args={[res.marker, res.markerMaterial, MARKERS]} frustumCulled={false} />
    </>
  )
}

export default Chips
