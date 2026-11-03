import { DANCE_FORWARD, SEATED_BACK, SEATED_DROP, TABLE } from './layout'

/** Seconds for the winner's jump from the chair up onto the table. */
const CLIMB_S = 0.55
const HOP_HEIGHT = 0.8
/** Side-to-side wiggle of the whole body while dancing, in radians. */
const WIGGLE = 0.35
/** A bite: hand to mouth, a few chews, hand back down. */
const EAT_MS = 1000

/**
 * Slapping the player beside you with your own hand: rise and lean over, wind the
 * arm up and out, whip it across into their cheek, then settle back into the chair.
 */
export const SLAPPING_MS = 820
/** When, as a fraction of SLAPPING_MS, the hand lands. */
export const SLAP_IMPACT = 0.48
export const SLAP_IMPACT_MS = Math.round(SLAPPING_MS * SLAP_IMPACT)
const SLAP_HOLD = 0.62
const LEAN = 0.6
const RISE = 0.1
const TURN = 1.05

/**
 * Getting slapped: the head spins right round (twice, fast at first, slowing to a
 * stop facing front again) while the body is knocked away and eases back upright.
 */
const HIT_MS = 800
const HIT_PEAK = 0.12
const HIT_TILT = 0.3
const HIT_TURN = 0.35
const HEAD_SPINS = 2

/**
 * The last slap knocks the player clean out of their chair: they fly off sideways
 * and back, spinning, land flat on their back, bounce once and lie there until the
 * server sends them to the lobby.
 */
const FLY_MS = 820
const FLY_DIST = 2.3
const FLY_HEIGHT = 1.1
const BOUNCE_MS = 260
const BOUNCE = 0.14
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

/** Body envelope of a slap: up to full lean by the impact, a short hold, then back. */
function slapEnvelope(p) {
  if (p < SLAP_IMPACT) return smooth(p / SLAP_IMPACT)
  if (p < SLAP_HOLD) return 1
  return 1 - smooth((p - SLAP_HOLD) / (1 - SLAP_HOLD))
}

/** Knock envelope: snaps to 1 at the hit, then eases back with no wobble. */
function hitEnvelope(t) {
  if (t < HIT_PEAK) return Math.sin((t / HIT_PEAK) * (Math.PI / 2))
  return 1 - smooth((t - HIT_PEAK) / (1 - HIT_PEAK))
}

/** Shortest signed angle from a to b. */
function angleTo(a, b) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

/**
 * Knocked out of the chair (`ms` since the hit): position, spin and tilt of the
 * avatar's group, flying from the seated pose to lying on the floor. Writes `out`.
 */
function flight(ms, fx, seat, out) {
  const t = Math.min(1, ms / FLY_MS)
  // Away from the slapper and a little back from the table.
  const ax = fx.ax
  const az = fx.az
  const d = FLY_DIST * easeOutCubic(t)
  out.x = -Math.sin(seat.ry) * SEATED_BACK + ax * d
  out.z = -Math.cos(seat.ry) * SEATED_BACK + az * d
  out.y = SEATED_DROP + (LIE_Y - SEATED_DROP) * t + FLY_HEIGHT * 4 * t * (1 - t)
  if (t >= 1) {
    const b = (ms - FLY_MS) / BOUNCE_MS
    if (b < 1) out.y += BOUNCE * Math.sin(b * Math.PI)
  }
  // One full twist in the air, ending square to the table again, and tipping over
  // onto their back.
  out.yaw = seat.ry + (fx.side || 1) * Math.PI * 2 * easeOutCubic(t)
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
 *   `eat`      - a bite: hand to mouth
 *   `slapping` - slapping the player beside them (`dx`, `dz`: towards them;
 *                `arm`: +1 right hand, -1 left)
 *   `slap`     - being slapped: the head spins (`side`: which way the hit knocks them)
 *   `fly`      - the last slap: knocked out of the chair (`ax`, `az`: which way)
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
  // Every slap of a knockout plays out in the chair before the winner climbs up.
  const dancing = seat.dancing && now >= (fx?.danceAt || 0)

  if (!dancing) {
    const eat = progress(fx?.eat, EAT_MS, now)
    const slapping = progress(fx?.slapping, SLAPPING_MS, now)
    const hit = progress(fx?.slap, HIT_MS, now)
    const flying = fx?.fly && now >= fx.fly ? now - fx.fly : -1
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
    let roll = 0

    // Hand up to the mouth and back, with a couple of chews at the top.
    motion.eat = eat < 0 ? 0 : Math.sin(Math.min(1, eat * 1.25) * Math.PI)
    motion.chew = eat < 0 ? 0 : Math.sin(eat * Math.PI * 8)

    // Slapping: lean over towards the other player and turn to face them.
    motion.slapPhase = slapping
    motion.slapArm = fx?.arm ?? 1
    if (slapping >= 0) {
      const e = slapEnvelope(slapping)
      x += fx.dx * LEAN * e
      z += fx.dz * LEAN * e
      y += RISE * e
      yaw += angleTo(seat.ry, Math.atan2(fx.dx, fx.dz)) * (TURN / (Math.PI / 2)) * e
    }

    // Slapped: the head spins round, the body is knocked away then back upright.
    const k = hit < 0 ? 0 : hitEnvelope(hit)
    motion.slap = k
    motion.headSpin = hit < 0 ? 0 : (fx.side || 1) * Math.PI * 2 * HEAD_SPINS * easeOutCubic(hit)
    if (k > 0) {
      roll += fx.side * HIT_TILT * k
      yaw -= fx.side * HIT_TURN * k
    }

    // The last slap: out of the chair, through the air and flat on the floor.
    if (flying >= 0) {
      flight(flying, fx, seat, _flight)
      x = _flight.x
      y = _flight.y
      z = _flight.z
      yaw = _flight.yaw
      pitch = _flight.pitch
      roll = 0
      motion.seated = false
      motion.grounded = _flight.landed
      motion.down = _flight.landed
      motion.slapPhase = -1
      motion.eat = 0
    }

    visual.position.set(x, y, z)
    visual.rotation.set(pitch, yaw, roll)
    if (tag) {
      if (flying >= 0) tag.position.set(x, Math.max(0, y - LIE_Y) - (_flight.landed ? 1.1 : 0), z)
      else tag.position.set(0, 0, 0)
    }
    return
  }

  motion.eat = 0
  motion.slap = 0
  motion.headSpin = 0
  motion.slapPhase = -1
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
  motion.eat = 0
  motion.slap = 0
  motion.headSpin = 0
  motion.slapPhase = -1
  motion.down = false
  visual.position.set(0, 0, 0)
  visual.rotation.x = 0
  visual.rotation.z = 0
  if (tag) tag.position.set(0, 0, 0)
}
