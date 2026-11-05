const assert = require('node:assert/strict')
const { test } = require('node:test')

const GameRoom = require('../src/game/GameRoom')

/** A room with the real drain logic and two players: one walking, one mid-duel. */
function setup() {
  const closed = new Map()
  const table = { phase: 'playing' }
  const player = (id, seat) => ({
    id,
    seat,
    kicked: false,
    reconnection: null,
    toast() {},
    client: { leave: (code) => closed.set(id, code) },
  })
  const room = {
    sessions: new Map([
      ['walker', player('walker', null)],
      ['duelist', player('duelist', { table })],
    ]),
    lock: async () => {},
    drain: GameRoom.prototype.drain,
    moveOffDuty: GameRoom.prototype.moveOffDuty,
    kick: GameRoom.prototype.kick,
  }
  return { room, table, closed }
}

test('a shutting-down server moves players on, but lets a duel finish first', () => {
  const { room, table, closed } = setup()
  room.drain()
  assert.equal(closed.get('walker'), 4102, 'the walker moves at once')
  assert.equal(closed.has('duelist'), false, 'mid-duel: stays')

  table.phase = 'ended'
  room.moveOffDuty()
  assert.equal(closed.has('duelist'), false, 'still watching the result')

  room.sessions.get('duelist').seat = null // stood up after the result
  room.moveOffDuty()
  assert.equal(closed.get('duelist'), 4102)
  room.moveOffDuty()
  assert.equal(closed.size, 2, 'each player is moved once')
})
