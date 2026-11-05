const assert = require('node:assert/strict')
const { test } = require('node:test')

const Bot = require('../src/game/Bot')
const DATA = require('../src/game/data')
const GameRoom = require('../src/game/GameRoom')
const Table = require('../src/game/Table')
const { validateWord } = require('../src/game/words')

/**
 * Just enough of GameRoom for Tables to run duels. `runTimers` fires the room
 * clock; `sessions` and `tables` feed the real seat-sharing rules (botAllowed,
 * pairWaiting), borrowed from GameRoom.
 */
function fakeRoom() {
  const timers = []
  return {
    broadcasts: [],
    results: [],
    players: new Map(),
    wins: [],
    sessions: new Map(),
    tables: [],
    botAllowed: GameRoom.prototype.botAllowed,
    pairWaiting: GameRoom.prototype.pairWaiting,
    clock: { setTimeout: (fn, ms) => timers.push({ fn, ms }) },
    runTimers() {
      const due = timers.splice(0).sort((a, b) => a.ms - b.ms)
      for (const t of due) t.fn()
    },
    bubble() {},
    broadcast(type, msg) {
      this.broadcasts.push({ type, msg })
      if (type === 'result') this.results.push(msg)
    },
    questEvent() {},
    wordPlayed: () => ({ fresh: true, lucky: false }),
    bonusCash: (_s, amount) => amount,
    takeCash: () => 0,
    recordWin(session, opts) {
      this.wins.push({ id: session.id, ...opts })
      return DATA.winReward
    },
    recordLoss: () => DATA.lossReward,
    flushScores() {},
    addBot(table) {
      const bot = new Bot(table)
      this.players.set(bot.id, bot.player)
      return bot
    },
    removeBot(bot) {
      this.players.delete(bot.id)
    },
  }
}

function fakeSession(id, pet = '') {
  const inbox = []
  return {
    id,
    seat: null,
    player: { name: id },
    profile: { equippedChair: 'basic', equippedPet: pet },
    inbox,
    send: (type, msg) => inbox.push({ type, msg }),
    toast: (text) => inbox.push({ type: 'toast', msg: { text } }),
    respawn() {},
    last: (type) => [...inbox].reverse().find((m) => m.type === type)?.msg,
  }
}

/** A room with `count` empty tables, ids 1.. */
function roomWithTables(count) {
  const room = fakeRoom()
  for (let id = 1; id <= count; id += 1) room.tables.push(new Table({ id, x: 0, z: 0 }, room, {}))
  return room
}

/** A player in the room (counted as walking around until they sit). */
function join(room, id, pet) {
  const s = fakeSession(id, pet)
  room.sessions.set(id, s)
  return s
}

function startDuel({ petA = '', petB = '' } = {}) {
  const room = fakeRoom()
  const table = new Table({ id: 1, x: 0, z: 0 }, room, {})
  const a = fakeSession('a', petA)
  const b = fakeSession('b', petB)
  let now = 1000
  table.sit(a, now)
  table.sit(b, now)
  assert.equal(table.phase, 'countdown')
  now += DATA.timing.countdown * 1000
  table.tick(now)
  assert.equal(table.phase, 'playing')
  const onTurn = table.turn === 0 ? a : b
  const waiting = onTurn === a ? b : a
  return { room, table, onTurn, waiting, now }
}

/** A real word starting with `letter`, not yet used. */
const TEST_WORDS =
  'apple ant arm banana bear bee camel cat cow dog duck desk eagle egg elk fish fox fig goat gum gas horse hat hen igloo ink icon jelly jam jet kitten key kid lemon lion log mango moon map night nut net otter owl oak poodle pig pen queen quiz quit rabbit rat rug snake sun sea tiger tea toy umbrella urn use violin van vet whale wolf web xylophone xenon yellow yak yam zebra zoo zip'.split(' ')
function wordFor(letter, used) {
  const w = TEST_WORDS.find((x) => x[0] === letter && !used.has(x))
  assert.ok(w, `no test word for ${letter}`)
  return w
}

test('a refused word goes back to the sender only, with the reason', () => {
  const { table, onTurn, waiting, now } = startDuel()
  const wrong = table.letter === 'z' ? 'apple' : 'zebra'
  table.word(onTurn, wrong, now)
  assert.match(onTurn.last('wordError').reason, /must start with/)
  assert.equal(waiting.last('wordError'), undefined)
  assert.equal(table.chain.length, 0)
})

test('an accepted word passes the turn on its last letter', () => {
  const { table, onTurn, waiting, now } = startDuel()
  const w = wordFor(table.letter, table.used)
  table.word(onTurn, w.toUpperCase(), now)
  assert.equal(table.chain.length, 1)
  assert.equal(table.letter, w[w.length - 1])
  assert.equal(waiting.last('match').match.myTurn, true)
  assert.equal(onTurn.last('match').match.myTurn, false)
  // Not your turn: ignored, no error either.
  table.word(onTurn, wordFor(table.letter, table.used), now + 1000)
  assert.equal(table.chain.length, 1)
})

test('the turn timer shrinks as the chain grows', () => {
  const { table, onTurn, waiting, now } = startDuel()
  const first = table.turnMs
  table.word(onTurn, wordFor(table.letter, table.used), now)
  assert.ok(table.turnMs < first)
  for (let k = 0; k < 200; k += 1) table.chain.push({ word: `x${k}`, by: 0 })
  table.beginTurn(now)
  assert.equal(table.turnMs, DATA.timing.turnMin * 1000)
  void waiting
})

test('running out of time costs a heart and a laugh, then the other player starts afresh', () => {
  const { room, table, onTurn, waiting } = startDuel()
  const seat = table.turn
  table.word(onTurn, 'qqq', table.endsAt - 100) // tried, so not idle
  table.tick(table.endsAt)
  assert.equal(table.hearts[seat], DATA.words.hearts - 1)
  assert.equal(table.pending, true)
  const fx = room.broadcasts.find((b) => b.type === 'fx' && b.msg.kind === 'laugh')
  assert.deepEqual(fx.msg, { kind: 'laugh', id: onTurn.id, by: waiting.id, final: false })
  assert.ok(!room.broadcasts.some((b) => b.msg?.kind === 'slap'), 'no slapping any more')
  table.tick(table.endsAt)
  assert.equal(table.pending, false)
  assert.equal(table.turn, 1 - seat)
  assert.equal(waiting.last('match').match.myTurn, true)
})

test('losing every heart is a knockout', () => {
  const { room, table } = startDuel()
  const loser = table.turn
  for (let k = 0; k < DATA.words.hearts; k += 1) {
    table.turn = loser
    table.pending = false
    table.tried = true
    table.tick(table.endsAt)
  }
  assert.equal(table.phase, 'ended')
  assert.equal(room.results[0].reason, 'knockout')
  assert.equal(table.winner, 1 - loser)
})

test('two idle turns in a row lose by afk', () => {
  const { room, table } = startDuel()
  const sleeper = table.turn
  table.tick(table.endsAt) // idle 1, slap
  table.tick(table.endsAt) // other player's turn begins
  table.turn = sleeper // pretend the other player answered
  table.beginTurn(table.endsAt)
  table.tick(table.endsAt) // idle 2
  assert.equal(table.phase, 'ended')
  assert.equal(room.results[0].reason, 'afk')
})

test('quitting mid-duel is a forfeit, and the winner laughs the quitter out', () => {
  const { room, table, onTurn, now } = startDuel()
  table.leave(onTurn, now)
  assert.equal(table.phase, 'ended')
  assert.equal(room.results[0].reason, 'forfeit')
  room.runTimers()
  const laughs = room.broadcasts.filter((b) => b.type === 'fx' && b.msg.kind === 'laugh' && b.msg.id === onTurn.id)
  assert.equal(laughs.length, DATA.forfeit.laughs)
  assert.equal(laughs.at(-1).msg.final, true)
})

/** One player sits alone (plenty of empty tables) and calls WordBot over. */
function soloWithBot({ pet = '' } = {}) {
  const room = roomWithTables(4)
  const table = room.tables[1]
  const me = join(room, 'me', pet)
  const now = 1000
  table.sit(me, now)
  assert.equal(table.phase, 'waiting')
  table.callBot(me, now + 500)
  assert.equal(table.phase, 'countdown')
  const bot = table.seats.find((s) => s?.isBot)
  return { room, table, me, bot, now: now + 500 }
}

test('WordBot never comes uninvited, however long someone waits', () => {
  const room = roomWithTables(4)
  const table = room.tables[0]
  const me = join(room, 'me')
  table.sit(me, 1000)
  assert.equal(me.last('match').match.botAllowed, true, 'they may call it')
  for (let t = 1000; t <= 1000 + 120000; t += 1000) table.tick(t)
  assert.equal(table.phase, 'waiting')
  assert.equal(room.players.size, 0, 'no WordBot')
})

test('calling WordBot brings it at once, and it shows up as a player', () => {
  const { room, me, bot } = soloWithBot()
  assert.ok(bot)
  assert.equal(room.players.get(bot.id).name, DATA.bot.name)
  assert.equal(me.last('match').match.opponent, bot.id)
  assert.equal(me.last('match').match.practice, true)
})

test('two players waiting alone are put together', () => {
  const room = roomWithTables(10)
  const first = join(room, 'first')
  const second = join(room, 'second')
  room.tables[0].sit(first, 1000)
  room.tables[6].sit(second, 3000)
  // The first one's pairing check comes first: the second comes over to them.
  room.tables[0].tick(1000 + DATA.timing.pairSec * 1000)
  assert.equal(room.tables[0].phase, 'countdown')
  assert.deepEqual(room.tables[0].seats.map((s) => s.id).sort(), ['first', 'second'])
  assert.deepEqual(room.tables[6].seats, [null, null])
  assert.equal(room.players.size, 0, 'no WordBot')
  assert.match(second.inbox.find((m) => m.type === 'toast' && /opponent/.test(m.msg.text)).msg.text, /first/)
})

test('WordBot stays away while tables are short, so real players always find a seat', () => {
  // 3 tables. One player waits; five more walk around: the other two tables seat only four.
  const room = roomWithTables(3)
  const waiter = join(room, 'waiter')
  for (const id of ['a', 'b', 'c', 'd', 'e']) join(room, id)
  room.tables[0].sit(waiter, 1000)
  assert.equal(room.botAllowed(room.tables[0]), false)
  assert.equal(waiter.last('match').match.botAllowed, false, 'no WordBot button')
  // Asking for it anyway doesn't bring it.
  room.tables[0].callBot(waiter, 9000)
  assert.equal(room.tables[0].phase, 'waiting', 'still waiting for a real player')
  assert.equal(room.players.size, 0, 'no WordBot')
  // Once one leaves, the four left walking around fit at the two tables: WordBot may come.
  room.sessions.delete('e')
  assert.equal(room.botAllowed(room.tables[0]), true)
})

test('a real player takes WordBot’s seat during the countdown', () => {
  const { room, table, me, bot, now } = soloWithBot()
  const friend = join(room, 'friend')
  assert.equal(table.sit(friend, now + 500), null)
  assert.equal(table.phase, 'countdown')
  assert.ok(!table.seats.includes(bot))
  assert.ok(table.seats.includes(friend) && table.seats.includes(me))
  assert.equal(room.players.has(bot.id), false)
  assert.equal(me.last('match').match.practice, false)
})

test('WordBot plays real, unused words that fit the chain', () => {
  const { room, table, bot, now } = soloWithBot()
  table.tick(now + DATA.timing.countdown * 1000)
  const botSeat = table.seats.indexOf(bot)
  let played = 0
  for (let k = 0; k < 40 && played < 3; k += 1) {
    if (table.phase !== 'playing') break
    if (table.turn === botSeat && !table.pending) {
      const before = table.chain.length
      const letter = table.letter
      const used = new Set(table.used)
      room.runTimers()
      if (table.chain.length > before) {
        const w = table.chain.at(-1).word
        assert.equal(validateWord(w, letter, used), null, `${w} on ${letter}`)
        played += 1
      } else table.tick(table.endsAt) // it blanked: time runs out
    } else {
      // The human passes the turn back: let it time out (with a try, so not idle).
      table.tried = true
      table.tick(table.endsAt)
      if (table.pending) table.tick(table.endsAt)
    }
  }
  assert.ok(played > 0, 'WordBot played at least one word')
})

test('leaving before the duel starts sends WordBot away too', () => {
  const { room, table, me, bot, now } = soloWithBot()
  table.leave(me, now + 100)
  assert.equal(table.phase, 'waiting')
  assert.deepEqual(table.seats, [null, null])
  assert.equal(room.players.has(bot.id), false)
})

test('beating WordBot is a practice win', () => {
  const { room, table, me, bot, now } = soloWithBot()
  table.tick(now + DATA.timing.countdown * 1000)
  const botSeat = table.seats.indexOf(bot)
  table.finish(1 - botSeat, botSeat, 'knockout', now + 5000)
  assert.equal(room.results[0].practice, true)
  assert.deepEqual(room.wins[0], { id: me.id, flawless: true, practice: true })
})

test("a pet's extra seconds go on its owner's turns only", () => {
  // The turtle gives +1 s.
  const { table, onTurn } = startDuel({ petA: 'turtle' })
  const base = DATA.timing.turn * 1000
  assert.equal(table.turnMs, onTurn.id === 'a' ? base + 1000 : base)
})

test('a hint is a valid word, and hints run out', () => {
  // The owl gives 2 hints per duel.
  const { table, onTurn, waiting, now } = startDuel({ petA: 'owl', petB: 'owl' })
  for (let k = 0; k < 2; k += 1) {
    table.hint(onTurn, now)
    const { word } = onTurn.last('hint')
    assert.equal(validateWord(word, table.letter, table.used), null, word)
  }
  const sent = onTurn.inbox.filter((m) => m.type === 'hint').length
  table.hint(onTurn, now)
  assert.equal(onTurn.inbox.filter((m) => m.type === 'hint').length, sent, 'no third hint')
  assert.equal(onTurn.last('match').match.hintsLeft, 0)
  // Not your turn: no hint.
  table.hint(waiting, now)
  assert.equal(waiting.last('hint'), undefined)
})

test("a pet's shield saves the heart", () => {
  // The puppy has 1 shield.
  const { table, onTurn } = startDuel({ petA: 'puppy', petB: 'puppy' })
  const seat = table.turn
  table.tried = true
  table.tick(table.endsAt)
  assert.equal(table.hearts[seat], DATA.words.hearts)
  assert.equal(onTurn.last('duel').t, 'shield')
  // The next timeout on that player hurts.
  table.tick(table.endsAt) // other player's turn begins
  table.turn = seat
  table.beginTurn(table.endsAt)
  table.tried = true
  table.tick(table.endsAt)
  assert.equal(table.hearts[seat], DATA.words.hearts - 1)
})
