import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'

import { useGame } from '../net/gameStore'
import { bubbles, localPlayer } from '../net/liveState'
import { Label } from './labels'
import { titleById } from './layout'
import { getSettings } from './quality'
import { useDisposable } from './useDisposable'

/** The lowest a name sits: just over a regular avatar's head. */
const NAME_Y = 2.05
/** Gap between the top of the head (or hat) and the name. */
const HEAD_GAP = 0.14
const _world = new Vector3()

/**
 * Name (with win streak) above a player's head, plus their speech bubble: emotes,
 * their words, "HAHA! 🤣"... Bubbles arrive through liveState, so a new one
 * redraws a canvas but never re-renders React.
 *
 * `top` ({ y }) is the measured top of their head, hat included (see PlayerAvatar
 * headTop): the name rises above tall avatars, big heads and hats instead of
 * showing through them.
 *
 * Place inside the player's group; distance is measured from the tag's world position.
 */
export function Nametag({ id, name, streak, title = '', isSelf = false, gate = null, top = null }) {
  const ref = useRef(null)
  const seenVersion = useRef(0)
  const labels = useDisposable(
    () => ({ name: new Label({ height: 0.28 }), bubble: new Label({ height: 0.34, urgent: true }) }),
    [],
  )

  useEffect(() => {
    labels.name.sprite.center.set(0.5, 0)
    labels.bubble.sprite.center.set(0.5, 0)
  }, [labels])

  useEffect(() => {
    const t = titleById(title)
    const lines = []
    if (t) lines.push({ text: t.name, size: 26, color: t.color, rainbow: Boolean(t.rainbow) })
    lines.push({ text: name, size: 34 })
    if (streak > 0) lines.push({ text: `🔥 ${streak}`, size: 24, color: '#ffd23d' })
    labels.name.set(lines)
  }, [labels, name, streak, title])

  useFrame(() => {
    const self = ref.current
    if (!self) return

    const b = bubbles.get(id)
    if (b && b.version !== seenVersion.current) {
      seenVersion.current = b.version
      labels.bubble.set(b.text ? [{ text: b.text, size: 40 }] : [])
    }

    // In your own duel the VS bar shows both names and what they say; over-the-head
    // tags would pile up in the close two-shot. Spectators still see them.
    const match = useGame.getState().match
    if (match && (isSelf || id === match.opponent)) {
      labels.name.sprite.visible = false
      labels.bubble.sprite.visible = false
      return
    }

    const limit = getSettings().nameDistance
    let d = 0
    if (!isSelf) {
      self.getWorldPosition(_world)
      d = Math.hypot(_world.x - localPlayer.position.x, _world.z - localPlayer.position.z)
    }
    // `gate` limits tags to the nearest few players (each tag is a draw call); a
    // speech bubble close by (your duel opponent) always shows.
    const allowed = !gate || gate.show
    labels.name.sprite.visible = allowed && d < limit && !labels.name.empty
    labels.bubble.sprite.visible = Boolean(
      b && b.until > Date.now() && (allowed || d < 6) && d < limit * 1.5 && !labels.bubble.empty,
    )
    const nameY = Math.max(NAME_Y, (top?.y || 0) + HEAD_GAP)
    labels.name.sprite.position.y = nameY
    labels.bubble.sprite.position.y = nameY + labels.name.sprite.scale.y + 0.06
  })

  return (
    <group ref={ref}>
      <primitive object={labels.name.sprite} position={[0, NAME_Y, 0]} />
      <primitive object={labels.bubble.sprite} position={[0, NAME_Y + 0.5, 0]} />
    </group>
  )
}

export default Nametag
