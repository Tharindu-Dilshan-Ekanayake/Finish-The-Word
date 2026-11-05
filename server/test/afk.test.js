const assert = require('node:assert/strict')
const { test } = require('node:test')

const DATA = require('../src/game/data')
const GameRoom = require('../src/game/GameRoom')
const { Session } = require('../src/game/Session')

const WARN = DATA.afk.warnSec * 1000
const KICK = DATA.afk.kickSec * 1000

/** A room with the real AFK check, and a player who joined at `now`. */
function setup(now = 1000) {
  const room = { roomId: 'r1', sessions: new Map(), checkAfk: GameRoom.prototype.checkAfk, kick: GameRoom.prototype.kick }
  const closed = []
  const inbox = []
  const client = { sessionId: 'p1', send: (type, msg) => inbox.push({ type, msg }), leave: (code) => closed.push(code) }
  const profile = { giftProgress: 0, streak: 0, equippedHalo: '', equippedPet: '', level: 1, equippedTitle: '' }
  const identity = { userId: '', username: '', name: 'Sam' }
  const session = new Session(client, room, {}, identity, profile, {}, now)
  room.sessions.set('p1', session)
  const warnings = () => inbox.filter((m) => m.type === 'afkWarn').map((m) => m.msg.inMs)
  return { room, session, closed, warnings }
}

test('someone doing nothing is warned, then removed so their slot frees up', () => {
  const { room, closed, warnings } = setup(1000)
  room.checkAfk(1000 + WARN - 1)
  assert.deepEqual(warnings(), [], 'not warned early')
  room.checkAfk(1000 + WARN)
  assert.equal(warnings().length, 1)
  assert.equal(warnings()[0], KICK - WARN, 'told how long they have')
  room.checkAfk(1000 + WARN + 5000)
  assert.equal(warnings().length, 1, 'warned once')
  room.checkAfk(1000 + KICK)
  assert.deepEqual(closed, [4101], 'removed with the "away" close code')
})

test('any tap or key calls the warning off and starts the clock again', () => {
  const { room, session, closed, warnings } = setup(1000)
  room.checkAfk(1000 + WARN)
  session.handle('active', {}, 1000 + WARN + 2000)
  assert.deepEqual(warnings(), [KICK - WARN, 0], 'warning cleared')
  room.checkAfk(1000 + KICK)
  assert.deepEqual(closed, [], 'still here')
})

test('walking around counts; the once-a-second position heartbeat does not', () => {
  const { room, session, closed } = setup(1000)
  const at = { x: 0, y: 0, z: 25.5, ry: 0, s: 0, g: true }
  // Heartbeats at the same spot for the whole time: they're away.
  for (let t = 2000; t < 1000 + KICK; t += 1000) session.handle('pos', at, t)
  room.checkAfk(1000 + KICK)
  assert.deepEqual(closed, [4101])

  const second = setup(1000)
  second.session.handle('pos', { ...at, z: 20 }, 1000 + KICK - 1000)
  second.room.checkAfk(1000 + KICK)
  assert.deepEqual(second.closed, [], 'moved recently')
})

test('nobody is removed mid-duel (the duel has its own idle rule)', () => {
  const { room, session, closed, warnings } = setup(1000)
  session.seat = { table: { phase: 'playing' } }
  room.checkAfk(1000 + KICK * 3)
  assert.deepEqual(closed, [])
  assert.deepEqual(warnings(), [])
  // Back in the lobby, the clock starts from when the duel ended.
  session.seat = null
  room.checkAfk(1000 + KICK * 3 + WARN - 1)
  assert.deepEqual(warnings(), [])
})

test('waiting alone at a table is not playing: the AFK clock runs', () => {
  const { room, session, closed } = setup(1000)
  session.seat = { table: { phase: 'waiting' } }
  room.checkAfk(1000 + KICK)
  assert.deepEqual(closed, [4101])
})
