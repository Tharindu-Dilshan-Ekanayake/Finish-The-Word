import { DANCE_FORWARD, SEATED_BACK, SEATED_DROP, TABLE } from './layout'

/** Seconds for the winner's jump from the chair up onto the table. */
const CLIMB_S = 0.55
const HOP_HEIGHT = 0.8
/** Side-to-side wiggle of the whole body while dancing, in radians. */
const WIGGLE = 0.35

/**
 * Laughing at the other player when they run out of time: lean back in the chair,
 * shoulders shaking, turned half towards them, pointing (see animateRig).
 */
export const LAUGH_MS = 1700
const LAUGH_LEAN = 0.3
const LAUGH_TURN = 0.55
/** Shakes per second while laughing ("ha-ha-ha"). */
const LAUGH_SHAKE_HZ = 7

/** Being laughed at: slump forward and hide the face in both hands. */
export const SHAME_MS = 1700
const SHAME_SLUMP = 0.32

/**
 * The last laugh: a beat of shame, then the player faints, tipping backwards off
 * the chair to lie flat on their back, bounce once and stay there until the
 * server sends them to the lobby.
 */
export const FAINT_DELAY_MS = 750
const FLY_MS = 700
const FLY_DIST = 1.3
const FLY_HEIGHT = 0.35
const BOUNCE_MS = 260
const BOUNCE = 0.12
/** Lying on the floor: the body's middle sits this far up. */
const LIE_Y = 0.2

const smooth = (x) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}
const easeOutCubic = (t) => 1 - (1 - t) ** 3

/** 0..1 progress of an action that started at `at` (epoch ms) and lasts `ms`, or -1. */
function progress(at, ms, now) {
  if (!at) return -1
  const t = (now - at) / ms
  return t >= 0 && t <= 1 ? t : -1
}

/** Into a pose quickly, hold it, ease back out over the last quarter. */
function holdEnvelope(p) {
  if (p < 0) return 0
  if (p < 0.12) return smooth(p / 0.12)
  if (p < 0.75) return 1
  return 1 - smooth((p - 0.75) / 0.25)
}

/** Shortest signed angle from a to b. */
function angleTo(a, b) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

/**
 * Fainting off the chair (`ms` since it began): position and tilt of the avatar's
 * group, from the seated pose to lying on the floor behind the chair. Writes `out`.
 */
function flight(ms, seat, out) {
  const t = Math.min(1, ms / FLY_MS)
  // Straight back, away from the table.
  const ax = -Math.sin(seat.ry)
  const az = -Math.cos(seat.ry)
  const d = FLY_DIST * easeOutCubic(t)
  out.x = ax * (SEATED_BACK + d)
  out.z = az * (SEATED_BACK + d)
  out.y = SEATED_DROP + (LIE_Y - SEATED_DROP) * t + FLY_HEIGHT * 4 * t * (1 - t)
  if (t >= 1) {
    const b = (ms - FLY_MS) / BOUNCE_MS
    if (b < 1) out.y += BOUNCE * Math.sin(b * Math.PI)
  }
  // Tipping over backwards onto their back, still facing the table.
  out.yaw = seat.ry
  out.pitch = -(Math.PI / 2) * smooth(t * 1.15)
  out.landed = t >= 1
}
const _flight = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, landed: false }

/**
 * Poses a player who is at a table: sitting, or, for a duel's winner
 * (`seat.dancing`), jumping up onto the table and dancing on it until the result
 * clears. Shared by the local player and remote players so both look identical.
 *
 * Seated players also act out the duel, from liveState.actionFx (epoch ms):
 *   `laughing` - laughing at the player beside them (`dx`, `dz`: towards them;
 *                `arm`: +1 points with the right hand, -1 the left)
 *   `shame`    - being laughed at: slumped, face in their hands
 *   `faint`    - the last laugh: they faint off the back of the chair
 *   `danceAt`  - the winner waits until then to climb up and dance
 *
 * @param {import('three').Object3D} visual the avatar's group (feet at its origin)
 * @param {import('three').Object3D|null} tag the name tag's group, lifted with them
 * @param {{ ry: number, dancing?: boolean }} seat
 * @param {object} motion the avatar's motion state (see animateRig)
 * @param {number} delta frame time in seconds
 * @param {object} [fx]
 */
export function poseAtSeat(visual, tag, seat, motion, delta, fx) {
  motion.speed = 0
  // Pitch and roll in the avatar's own frame, then the yaw: leaning back and
  // tilting sideways work the same at every table round the ring.
  if (visual.rotation.order !== 'YXZ') visual.rotation.order = 'YXZ'
  // The way the seated player faces (towards the table).
  const fx0 = Math.sin(seat.ry)
  const fz0 = Math.cos(seat.ry)
  const now = Date.now()
  // Every laugh at a loser plays out in the chair before the winner climbs up.
  const dancing = seat.dancing && now >= (fx?.danceAt || 0)

  if (!dancing) {
    const laughing = holdEnvelope(progress(fx?.laughing, LAUGH_MS, now))
    const shamed = holdEnvelope(progress(fx?.shame, SHAME_MS, now))
    const fainting = fx?.faint && now >= fx.faint ? now - fx.faint : -1
    motion.danceT = null
    motion.dancing = false
    motion.seated = true
    motion.grounded = true
    motion.down = false

    let x = -fx0 * SEATED_BACK
    let y = SEATED_DROP
    let z = -fz0 * SEATED_BACK
    let yaw = seat.ry
    let pitch = 0

    // Laughing: lean back, turned half towards them, shoulders bouncing.
    const shake = Math.sin((now / 1000) * Math.PI * 2 * LAUGH_SHAKE_HZ)
    motion.laugh = laughing
    motion.laughShake = shake
    motion.laughArm = fx?.arm ?? 1
    if (laughing > 0) {
      pitch -= (LAUGH_LEAN + shake * 0.05) * laughing
      y += Math.abs(shake) * 0.035 * laughing
      yaw += angleTo(seat.ry, Math.atan2(fx.dx, fx.dz)) * LAUGH_TURN * laughing
    }

    // Laughed at: slumped forward over the table, hiding their face.
    motion.shame = shamed
    if (shamed > 0) {
      pitch += SHAME_SLUMP * shamed
      y -= 0.04 * shamed
    }

    // The last laugh: they faint off the back of the chair, flat on the floor.
    if (fainting >= 0) {
      flight(fainting, seat, _flight)
      x = _flight.x
      y = _flight.y
      z = _flight.z
      yaw = _flight.yaw
      pitch = _flight.pitch
      motion.seated = false
      motion.grounded = _flight.landed
      motion.down = _flight.landed
      motion.shame = 0
    }

    visual.position.set(x, y, z)
    visual.rotation.set(pitch, yaw, 0)
    if (tag) {
      if (fainting >= 0) tag.position.set(x, Math.max(0, y - LIE_Y) - (_flight.landed ? 1.1 : 0), z)
      else tag.position.set(0, 0, 0)
    }
    return
  }

  motion.laugh = 0
  motion.shame = 0
  motion.down = false
  motion.danceT = (motion.danceT ?? 0) + delta
  const t = Math.min(1, motion.danceT / CLIMB_S)
  const landed = t >= 1
  const y = TABLE.height * t + Math.sin(t * Math.PI) * HOP_HEIGHT
  // Forward onto the table, in the direction the seat faces.
  const forward = DANCE_FORWARD * t

  motion.seated = false
  // Mid-hop the rig uses its airborne tuck, then breaks into the dance.
  motion.grounded = landed
  motion.dancing = landed
  visual.position.set(fx0 * forward, y, fz0 * forward)
  visual.rotation.set(0, seat.ry + (landed ? Math.sin(motion.time * 4) * WIGGLE : 0), 0)
  if (tag) tag.position.set(fx0 * forward, y, fz0 * forward)
}

/** Back to a normal standing pose after leaving the seat. */
export function clearSeatPose(visual, tag, motion) {
  motion.seated = false
  motion.dancing = false
  motion.danceT = null
  motion.laugh = 0
  motion.shame = 0
  motion.down = false
  visual.position.set(0, 0, 0)
  visual.rotation.x = 0
  visual.rotation.z = 0
  if (tag) tag.position.set(0, 0, 0)
}
