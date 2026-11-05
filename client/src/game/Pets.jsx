import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { MeshLambertMaterial, Object3D, Quaternion, Vector3 } from 'three'

import { useGame } from '../net/gameStore'
import { avatarAnchors, localPlayer, SELF_ANCHOR } from '../net/liveState'
import { DATA, petById } from './layout'
import { createPetGeometry, FLIES } from './petGeometry'
import { getSettings } from './quality'
import { useDisposable } from './useDisposable'

/**
 * Every equipped pet, trotting (or flapping) after its owner: behind them and to
 * the right, catching up smoothly, hopping while it moves, turning to face where
 * it goes. Seated owners get their pet beside the chair.
 *
 * One instanced mesh per species, drawn only when someone has that species out
 * (≤ 10 draw calls, usually 1–3). The preset's maxPets caps how many are drawn:
 * your own first, then the nearest. No allocation in the frame loop.
 */

const MAX = DATA.roomSize
/** Where the pet waits, in its owner's frame: to the right and a little behind. */
const SIDE = 0.8
const BACK = -0.55
const FLY_Y = 1.25
const FOLLOW = 6
const BIG = new Set(['legendary', 'mythic'])

const _obj = new Object3D()
const _pos = new Vector3()
const _fwd = new Vector3()
const _quat = new Quaternion()
const byDistance = (a, b) => a.dist - b.dist

/** Per-owner follow state, kept across frames (positions smoothed towards the target). */
function followerFor(key, pet) {
  return { key, pet, x: 0, z: 0, ry: 0, speed: 0, placed: false, dist: 0 }
}

export function Pets() {
  // "ownerKey:petId" pairs; a string selector only re-renders when a pet changes.
  const key = useGame((s) => {
    const parts = []
    for (const p of Object.values(s.players)) {
      if (p.pet) parts.push(`${p.id === s.selfId ? SELF_ANCHOR : p.id}:${p.pet}`)
    }
    return parts.join(',')
  })
  const followers = useMemo(
    () =>
      key
        ? key
            .split(',')
            .map((pair) => {
              const [owner, petId] = pair.split(':')
              const pet = petById(petId)
              return pet ? followerFor(owner, pet) : null
            })
            .filter(Boolean)
        : [],
    [key],
  )
  // Drawing order, sorted in place each frame (no new array).
  const order = useMemo(() => [...followers], [followers])

  // Flat (one geometry per species id, plus the material) so useDisposable frees them all.
  const res = useDisposable(
    () => ({
      material: new MeshLambertMaterial({ vertexColors: true }),
      ...Object.fromEntries(DATA.pets.map((p) => [p.id, createPetGeometry(p)])),
    }),
    [],
  )
  const meshes = useRef({})
  const counts = useRef(Object.fromEntries(DATA.pets.map((p) => [p.id, 0])))

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime
    const maxPets = getSettings().maxPets
    const ease = 1 - Math.exp(-FOLLOW * Math.min(delta, 0.1))
    const n = counts.current
    for (const id in n) n[id] = 0

    for (const f of order) {
      f.dist = f.key === SELF_ANCHOR ? -1 : Infinity
      const anchor = avatarAnchors.get(f.key)
      if (!anchor) continue
      anchor.getWorldPosition(_pos)
      if (f.key !== SELF_ANCHOR) f.dist = Math.hypot(_pos.x - localPlayer.position.x, _pos.z - localPlayer.position.z)
    }
    order.sort(byDistance)

    let drawn = 0
    for (const f of order) {
      if (drawn >= maxPets || f.dist === Infinity) break
      const anchor = avatarAnchors.get(f.key)
      const mesh = meshes.current[f.pet.id]
      if (!anchor || !mesh) continue

      anchor.getWorldPosition(_pos)
      anchor.getWorldQuaternion(_quat)
      _fwd.set(0, 0, 1).applyQuaternion(_quat)
      const heading = Math.atan2(_fwd.x, _fwd.z)
      // The owner's right is (cos h, -sin h) when they face (sin h, cos h).
      const tx = _pos.x + Math.cos(heading) * -SIDE + Math.sin(heading) * BACK
      const tz = _pos.z - Math.sin(heading) * -SIDE + Math.cos(heading) * BACK

      if (!f.placed) {
        f.x = tx
        f.z = tz
        f.ry = heading
        f.placed = true
      }
      const dx = (tx - f.x) * ease
      const dz = (tz - f.z) * ease
      f.x += dx
      f.z += dz
      const step = Math.hypot(dx, dz)
      f.speed = step / Math.max(delta, 1e-3)
      // Face where it is going; when settled, face the way its owner does.
      const want = f.speed > 0.4 ? Math.atan2(dx, dz) : heading
      let turn = want - f.ry
      while (turn > Math.PI) turn -= Math.PI * 2
      while (turn < -Math.PI) turn += Math.PI * 2
      f.ry += turn * ease

      const flies = FLIES.has(f.pet.kind)
      const phase = f.key.length * 1.3
      const y = flies
        ? FLY_Y + Math.sin(t * 2.6 + phase) * 0.12
        : f.speed > 0.4
          ? Math.abs(Math.sin(t * 11 + phase)) * 0.14
          : Math.max(0, Math.sin(t * 1.5 + phase)) * 0.03

      _obj.position.set(f.x, _pos.y + y, f.z)
      _obj.rotation.set(flies ? 0 : Math.min(0.25, f.speed * 0.04), f.ry, 0)
      _obj.scale.setScalar(BIG.has(f.pet.rarity) ? 1.25 : 1)
      _obj.updateMatrix()
      mesh.setMatrixAt(n[f.pet.id], _obj.matrix)
      n[f.pet.id] += 1
      drawn += 1
    }

    for (const id in n) {
      const mesh = meshes.current[id]
      if (!mesh) continue
      mesh.count = n[id]
      // An instanced mesh with nothing to draw still costs a draw call.
      mesh.visible = n[id] > 0
      if (n[id]) mesh.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <>
      {DATA.pets.map((p) => (
        <instancedMesh
          key={p.id}
          ref={(m) => {
            meshes.current[p.id] = m
            if (m) {
              m.count = 0
              m.visible = false
            }
          }}
          args={[res[p.id], res.material, MAX]}
          frustumCulled={false}
        />
      ))}
    </>
  )
}

export default Pets
