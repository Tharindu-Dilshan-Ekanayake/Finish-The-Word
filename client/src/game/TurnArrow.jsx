import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Color, ConeGeometry, MeshBasicMaterial } from 'three'

import { useGame } from '../net/gameStore'
import { DATA, SEATED_BACK, seatPosition } from './layout'
import { useDisposable } from './useDisposable'

/**
 * At your own table, a big arrow bouncing over the head of whoever's turn it is:
 * green over you, gold over your opponent. Hidden while a bite is being revealed
 * and outside the eating phase. One draw call, and only while it shows.
 */

const SEATS = new Map(DATA.tables.map((t) => [t.id, [seatPosition(t.id, 0), seatPosition(t.id, 1)]]))
/** The arrow's tip, just over a seated player's head (its top is ~1.5 up). */
const ARROW_Y = 1.55
const BOUNCE = 0.1
const MINE = new Color('#5dff7a')
const THEIRS = new Color('#ffcf4a')

export function TurnArrow() {
  const ref = useRef(null)
  const res = useDisposable(
    () => ({
      // Four-sided, pointing down, tip at the origin.
      geometry: new ConeGeometry(0.2, 0.4, 4).rotateX(Math.PI).translate(0, 0.2, 0),
      material: new MeshBasicMaterial({ color: MINE }),
    }),
    [],
  )

  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const { match, reveal } = useGame.getState()
    const revealing = reveal && reveal.until > Date.now()
    let seat = -1
    if (match?.phase === 'eating' && !revealing) seat = match.myTurn ? match.seat : match.theirTurn ? 1 - match.seat : -1
    mesh.visible = seat >= 0
    if (seat < 0) return

    const s = SEATS.get(match.table)[seat]
    const t = clock.elapsedTime
    mesh.position.set(
      s.x - Math.sin(s.ry) * SEATED_BACK,
      ARROW_Y + Math.abs(Math.sin(t * 4)) * BOUNCE,
      s.z - Math.cos(s.ry) * SEATED_BACK,
    )
    mesh.rotation.y = t * 2.2
    res.material.color.copy(match.myTurn ? MINE : THEIRS)
  })

  return <mesh ref={ref} geometry={res.geometry} material={res.material} visible={false} frustumCulled={false} />
}

export default TurnArrow
