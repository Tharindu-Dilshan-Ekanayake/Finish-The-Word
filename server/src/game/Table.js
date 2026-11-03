const DATA = require('./data')

const C = DATA.chips
const CELLS = C.cols * C.rows
const T = DATA.timing
/** After a quitter's last slap: time to fly out of the chair and lie there, in seconds. */
const PUNISH_TAIL_S = 3

/** Chip states, one character per chip in the synced plate strings. */
const FULL = '0'
const EATEN = '1'
const SLAPPED = '2'
const GOLDEN = '3'

const randomItem = (list) => list[Math.floor(Math.random() * list.length)]
const isCell = (n) => Number.isInteger(n) && n >= 0 && n < CELLS

/** `count` different random cells. */
function randomCells(count) {
  const pool = Array.from({ length: CELLS }, (_, i) => i)
  const out = []
  while (out.length < count) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
  return out.sort((a, b) => a - b)
}

/**
 * One two-seat table and the duel played at it.
 *
 * Each player has a plate of chips in front of them. They secretly hide slaps in
 * their own chips, then take turns biting a chip from the OTHER plate. A safe chip
 * is a crunch; a hidden slap means the plate's owner slaps you and you lose a heart.
 * There is one heart per slap, so you are out only once you have bitten every slap
 * hidden on their plate. One safe chip per plate is secretly golden and pays a
 * little bonus cash.
 *
 * Phases:
 *   waiting   - zero or one player seated
 *   countdown - both seats filled, "Starting in 3..."
 *   hiding    - both players hide their slaps at the same time
 *   eating    - turns: pick a chip, a short drumroll, then crunch or SLAP
 *   ended     - result on screen; both players are stood up when it runs out
 *
 * The server holds the slap positions. A client learns only where it hid its own,
 * the chips already eaten (public) and, once the duel is over, everything.
 */
class Table {
  /**
   * @param {{ id: number, x: number, z: number }} def
   * @param {import('./GameRoom')} room
   * @param {object} state this table's synced TableState, for every client to see
   */
  constructor(def, room, state) {
    this.id = def.id
    this.x = def.x
    this.z = def.z
    this.room = room
    this.state = state
    /** @type {Array<import('./Session')|null>} */
    this.seats = [null, null]
    this.token = 0
    this.reset()
  }

  reset() {
    this.phase = 'waiting'
    this.endsAt = 0
    /** slaps[i] = the cells of seat i's own plate where seat i hid a slap (null until hidden). */
    this.slaps = [null, null]
    /** golden[i] = the golden chip on seat i's plate (picked once both have hidden). */
    this.golden = [-1, -1]
    /** plates[i] = seat i's plate (the one seat 1-i eats from). */
    this.plates = [Array(CELLS).fill(FULL), Array(CELLS).fill(FULL)]
    this.hearts = [C.hearts, C.hearts]
    /** Slaps bitten, for the "flawless" quest. */
    this.hits = [0, 0]
    this.turn = 0
    /** Seat index of the winner once the duel has ended, else -1. */
    this.winner = -1
    this.timeouts = [0, 0]
    /** True between a bite and its outcome, so a second bite can't sneak in. */
    this.pending = false
    // Invalidates any setTimeout scheduled for the previous match.
    this.token += 1
  }

  seatOf(session) {
    return this.seats.indexOf(session)
  }

  sit(session, now) {
    if (this.phase !== 'waiting') return 'This table is already playing'
    const free = this.seats.indexOf(null)
    if (free < 0) return 'This table is full'

    this.seats[free] = session
    session.seat = { table: this, index: free }

    if (this.seats[0] && this.seats[1]) {
      this.phase = 'countdown'
      this.endsAt = now + T.countdown * 1000
    }
    this.sync(now)
    return null
  }

  /**
   * A seated player stands up (`gone` false: they pressed Quit / Leave) or
   * disconnected (`gone` true).
   */
  leave(session, now, { gone = false } = {}) {
    const i = this.seatOf(session)
    if (i < 0) return
    const other = this.seats[1 - i]

    if (this.phase === 'eating') {
      // Quitting mid-duel is a loss that costs money. Someone who quits (rather than
      // drops) stays in their chair to be slapped first; finish() sends them back
      // to the lobby afterwards.
      const punish = !gone && Boolean(other)
      this.finish(1 - i, i, 'forfeit', now, { punish })
      if (punish) return
    } else if (this.phase === 'countdown' || this.phase === 'hiding') {
      other?.toast('Your opponent left the table')
    }

    this.unseat(i)
    if (this.phase !== 'ended') {
      // The remaining player (if any) keeps their seat and waits for someone new.
      this.reset()
      if (other) this.room.bubble(other, '')
    }
    this.sync(now)
  }

  unseat(i) {
    const session = this.seats[i]
    if (!session) return
    this.seats[i] = null
    session.seat = null
    session.send('match', { match: null })
  }

  /** A player hides their slaps in their own plate: `cells` must be DATA.chips.slaps different chips. */
  hide(session, cells, now) {
    const i = this.seatOf(session)
    if (i < 0 || this.phase !== 'hiding' || this.slaps[i] !== null) return
    if (!Array.isArray(cells) || cells.length !== C.slaps || !cells.every(isCell)) return
    if (new Set(cells).size !== cells.length) return

    this.slaps[i] = [...cells].sort((a, b) => a - b)
    this.room.bubble(session, 'Ready ✅')
    if (this.slaps[1 - i] !== null) this.startEating(now)
    else this.sync(now)
  }

  /** The player whose turn it is bites a chip from the other plate. */
  eat(session, cell, now) {
    const i = this.seatOf(session)
    if (i < 0 || this.phase !== 'eating' || this.turn !== i || this.pending) return
    if (!isCell(cell) || this.plates[1 - i][cell] !== FULL) return
    this.timeouts[i] = 0
    this.bite(i, cell, now)
  }

  bite(i, cell, now) {
    this.pending = true
    const eater = this.seats[i]
    this.room.bubble(eater, 'Nom… 😬')
    // Both players get the drumroll; everyone in the room sees the avatar take a bite.
    this.tell({ t: 'bite', by: i, cell })
    if (eater) this.room.broadcast('fx', { kind: 'eat', id: eater.id })
    this.sync(now)

    const token = this.token
    // Room clock: cleared automatically if the room is disposed meanwhile.
    this.room.clock.setTimeout(() => {
      if (this.token !== token || this.phase !== 'eating') return
      this.resolveBite(i, cell, Date.now())
    }, T.bite * 1000)
  }

  resolveBite(i, cell, now) {
    const o = 1 - i
    const plate = this.plates[o]
    const eater = this.seats[i]
    const owner = this.seats[o]
    let kind

    if (this.slaps[o].includes(cell)) {
      plate[cell] = SLAPPED
      this.hearts[i] -= 1
      this.hits[i] += 1
      kind = 'slap'
      this.room.bubble(eater, this.hearts[i] > 0 ? 'OUCH! 😵' : 'KNOCKED OUT 💫')
      this.room.bubble(owner, 'SLAP! 🖐️')
    } else if (cell === this.golden[o]) {
      plate[cell] = GOLDEN
      kind = 'golden'
      if (eater) this.room.bonusCash(eater, C.goldenCash, now)
      this.room.bubble(eater, 'Golden chip! ✨')
    } else {
      plate[cell] = EATEN
      kind = 'safe'
      this.room.bubble(eater, 'Crunch! 😋')
    }

    if (eater && (kind === 'safe' || kind === 'golden')) {
      this.room.questEvent(eater, 'crunch', now)
      if (kind === 'golden') this.room.questEvent(eater, 'golden', now)
    }
    this.tell({ t: 'outcome', by: i, cell, kind, hearts: this.hearts[i] })
    // Everyone in the room sees it: the owner slaps the eater with their own hand
    // (and the last slap knocks them clean out of their chair).
    if (eater) {
      this.room.broadcast('fx', {
        kind: kind === 'safe' ? 'crunch' : kind,
        id: eater.id,
        by: owner?.id ?? '',
        final: kind === 'slap' && this.hearts[i] <= 0,
      })
    }

    // Out only on the last slap hidden on their plate (one heart per slap).
    if (this.hearts[i] <= 0) {
      this.finish(o, i, 'slapped', now)
      return
    }
    this.turn = o
    this.beginTurn(now)
  }

  /**
   * A duel event for both seated players, from each one's point of view: `mine`
   * is true for the player who took the bite.
   */
  tell({ t, by, ...rest }) {
    this.seats.forEach((s, i) => s?.send('duel', { t, mine: i === by, ...rest }))
  }

  startHiding(now) {
    this.phase = 'hiding'
    this.endsAt = now + T.hide * 1000
    for (const s of this.seats) this.room.bubble(s, 'Hiding slaps 🤫')
    this.sync(now)
  }

  startEating(now) {
    this.phase = 'eating'
    // One safe chip on each plate is secretly golden.
    this.golden = this.slaps.map((slaps) => {
      const safe = Array.from({ length: CELLS }, (_, c) => c).filter((c) => !slaps.includes(c))
      return randomItem(safe)
    })
    this.turn = Math.random() < 0.5 ? 0 : 1
    this.beginTurn(now)
  }

  beginTurn(now) {
    this.pending = false
    this.endsAt = now + T.turn * 1000
    this.sync(now)
  }

  /**
   * Ends the duel. A quitter (`reason` 'forfeit') pays DATA.forfeit.penalty, which
   * goes to the winner on top of the prize; with `punish` they stay in their chair
   * while the winner slaps them DATA.forfeit.slaps times, the last one knocking them
   * out of it.
   */
  finish(w, l, reason, now, { punish = false } = {}) {
    const F = DATA.forfeit
    // The slaps for quitting, at these times (seconds after now).
    const slapAt = punish ? Array.from({ length: F.slaps }, (_, k) => F.slapFirst + k * F.slapGap) : []
    const punishEnd = slapAt.length ? slapAt[slapAt.length - 1] : 0

    this.phase = 'ended'
    this.endsAt = now + Math.max(T.results, punishEnd + PUNISH_TAIL_S + 1) * 1000
    this.pending = false
    this.winner = w

    const winner = this.seats[w]
    const loser = this.seats[l]
    let reward = 0

    const played = reason === 'slapped'
    const penalty = reason === 'forfeit' && loser ? this.room.takeCash(loser, F.penalty, now) : 0
    if (winner) {
      reward = this.room.recordWin(winner, { flawless: played && this.hits[w] === 0 }, now)
      if (penalty) reward += this.room.bonusCash(winner, penalty, now)
    }
    let consolation = 0
    if (loser) consolation = this.room.recordLoss(loser, now, reason)
    if (loser && !played) this.room.bubble(loser, punish ? 'Nooo, let me go! 😱' : 'NOOO! 😭')
    if (winner) {
      this.room.bubble(winner, punish ? 'Not so fast! 😤' : reason === 'forfeit' ? 'GG 👍' : 'Too easy! 😎')
    }

    this.room.broadcast('result', {
      table: this.id,
      winner: winner?.id ?? null,
      loser: loser?.id ?? null,
      slaps: this.slaps.map((s) => s ?? []),
      reward,
      consolation,
      penalty,
      reason,
      // When the quitter's slaps land, so clients can hold the winner's dance.
      punish: slapAt.length ? { count: slapAt.length, first: F.slapFirst, gap: F.slapGap } : null,
    })
    this.sync(now)
    // Round end: report leaderboard scores now rather than at the next batch.
    this.room.flushScores()

    const token = this.token
    const stillHere = () => this.token === token && this.seats[l] === loser && loser && this.seats[w] === winner
    slapAt.forEach((at, k) => {
      this.room.clock.setTimeout(() => {
        if (!stillHere()) return
        const final = k === slapAt.length - 1
        this.room.broadcast('fx', { kind: 'slap', id: loser.id, by: winner.id, final })
        this.room.bubble(loser, final ? 'KNOCKED OUT 💫' : 'OUCH! 😵')
      }, at * 1000)
    })

    // The loser is knocked out of their chair, then respawns back in the lobby while
    // the winner keeps dancing on the table.
    this.room.clock.setTimeout(
      () => {
        if (this.token !== token || this.seats[l] !== loser || !loser) return
        this.unseat(l)
        loser.respawn()
        this.sync(Date.now())
      },
      (punish ? punishEnd + PUNISH_TAIL_S : T.loserRespawn) * 1000,
    )
  }

  tick(now) {
    if (this.phase === 'waiting' || now < this.endsAt) return

    if (this.phase === 'countdown') {
      this.startHiding(now)
    } else if (this.phase === 'hiding') {
      // Too slow to hide: the server hides them for you.
      this.slaps.forEach((s, i) => {
        if (s === null) {
          this.slaps[i] = randomCells(C.slaps)
          this.seats[i]?.toast('Out of time! Your slaps were hidden at random')
        }
      })
      this.startEating(now)
    } else if (this.phase === 'eating' && !this.pending) {
      const slow = this.turn
      this.timeouts[slow] += 1
      if (this.timeouts[slow] >= 2) {
        this.finish(1 - slow, slow, 'afk', now)
      } else {
        this.seats[slow]?.toast('Too slow! You grabbed a random chip')
        const open = Array.from({ length: CELLS }, (_, c) => c).filter((c) => this.plates[1 - slow][c] === FULL)
        this.bite(slow, randomItem(open), now)
      }
    } else if (this.phase === 'ended') {
      this.unseat(0)
      this.unseat(1)
      this.reset()
      this.sync(now)
    }
  }

  privateState(i, now) {
    const o = 1 - i
    const ended = this.phase === 'ended'
    return {
      table: this.id,
      seat: i,
      phase: this.phase,
      endsInMs: Math.max(0, this.endsAt - now),
      myPlate: this.plates[i].join(''),
      theirPlate: this.plates[o].join(''),
      mySlaps: this.slaps[i] ?? [],
      theirSlaps: ended ? (this.slaps[o] ?? []) : [],
      hidden: this.slaps[i] !== null,
      opponentReady: this.slaps[o] !== null,
      myHearts: this.hearts[i],
      theirHearts: this.hearts[o],
      myTurn: this.phase === 'eating' && this.turn === i && !this.pending,
      theirTurn: this.phase === 'eating' && this.turn === o,
      pending: this.pending,
      won: ended && this.winner === i,
      opponent: this.seats[o]?.id ?? null,
    }
  }

  /**
   * Publishes the table: the public part through the synced state (Colyseus sends
   * only fields that changed), the private part to each seated player.
   */
  sync(now = Date.now()) {
    const st = this.state
    const ended = this.phase === 'ended'
    st.phase = this.phase
    st.seat0 = this.seats[0]?.id ?? ''
    st.seat1 = this.seats[1]?.id ?? ''
    st.chair0 = this.seats[0]?.profile.equippedChair ?? ''
    st.chair1 = this.seats[1]?.profile.equippedChair ?? ''
    st.turn = this.phase === 'eating' ? (this.seats[this.turn]?.id ?? '') : ''
    st.winner = ended ? (this.seats[this.winner]?.id ?? '') : ''
    st.endsAt = this.phase === 'waiting' ? 0 : this.endsAt
    st.plate0 = this.plates[0].join('')
    st.plate1 = this.plates[1].join('')
    st.hearts0 = this.hearts[0]
    st.hearts1 = this.hearts[1]
    st.shown0 = ended ? (this.slaps[0] ?? []).map((c) => c.toString(36)).join('') : ''
    st.shown1 = ended ? (this.slaps[1] ?? []).map((c) => c.toString(36)).join('') : ''
    this.seats.forEach((s, i) => s?.send('match', { match: this.privateState(i, now) }))
  }
}

module.exports = Table
