const DATA = require('./data')
const { petAbility } = require('./pets')
const { MAX_LENGTH, normalise, pickWord, validateWord } = require('./words')

const W = DATA.words
const T = DATA.timing
const B = DATA.bot
/** After the last laugh at a quitter: time to faint off the chair and lie there, in seconds. */
const PUNISH_TAIL_S = 3
/** One word per this long per player: plenty for fast typists, useless for spamming guesses. */
const SUBMIT_GAP_MS = 250
/** "They're typing…" updates are relayed at most this often. */
const TYPING_GAP_MS = 100
/** WordBot "types" one letter per this long. */
const BOT_KEY_MS = 130
/** Hints are everyday words of at most this many letters: easy to read and type. */
const HINT_MAX_LENGTH = 7

const randomLetter = () => W.startLetters[Math.floor(Math.random() * W.startLetters.length)]
const NO_PERKS = petAbility(null)

/**
 * One two-seat table and the word duel played at it.
 *
 * Players take turns saying a word that starts with the last letter of the word
 * before it: POODLE -> ELEPHANT -> TURTLE. No word may be used twice in a duel.
 * Every word is checked here against the dictionary (see words.js); the client
 * only types. Run out of time and your opponent laughs at you: you lose a heart
 * and they start a fresh chain on a new letter. Lose every heart and you faint:
 * knocked out. The turn timer shrinks as the chain grows, so the longer it goes
 * the harder it gets.
 *
 * Nobody to play? Someone waiting alone is brought together with another player
 * waiting alone, every DATA.timing.pairSec; and if they choose to, they can call
 * WordBot over for a practice duel (see Bot.js). It never comes uninvited. Each player's pet
 * brings its perks: extra seconds per turn, hints and shields (see pets.js).
 *
 * Phases:
 *   waiting   - zero or one player seated (with one, `endsAt` is the next pairing check)
 *   countdown - both seats filled, "Starting in 3..."
 *   playing   - turns; `pending` is the short pause after a laugh
 *   ended     - result on screen; both players are stood up when it runs out
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
    /** @type {Array<import('./Session')|import('./Bot')|null>} */
    this.seats = [null, null]
    this.token = 0
    this.reset()
  }

  reset() {
    this.phase = 'waiting'
    this.endsAt = 0
    /** Length of the current turn, so clients can draw the timer bar. */
    this.turnMs = 0
    /** The letter the next word must start with. */
    this.letter = ''
    /** Every word said this duel, in order: { word, by } (by = seat index). */
    this.chain = []
    /** The same words, for O(1) "already used" checks. */
    this.used = new Set()
    this.hearts = [W.hearts, W.hearts]
    /** Hearts lost, for the "flawless" quest. */
    this.fails = [0, 0]
    this.turn = 0
    /** Seat index of the winner once the duel has ended, else -1. */
    this.winner = -1
    /** Turns in a row each player let run out without even trying a word. */
    this.idle = [0, 0]
    /** Whether the player on turn has sent any word yet this turn. */
    this.tried = false
    /** True during the pause after a laugh: nobody's turn. */
    this.pending = false
    this.lastSubmit = [0, 0]
    this.lastTyping = [0, 0]
    /** Each seat's pet perks for this duel, and what is left of them. */
    this.perks = [NO_PERKS, NO_PERKS]
    this.hintsLeft = [0, 0]
    this.shieldsLeft = [0, 0]
    // Invalidates any setTimeout scheduled for the previous match.
    this.token += 1
  }

  seatOf(session) {
    return this.seats.indexOf(session)
  }

  /** A duel against WordBot: practice, at reduced rewards. */
  get practice() {
    return this.seats.some((s) => s?.isBot)
  }

  sit(session, now) {
    // A real player takes WordBot's place, as long as the practice duel hasn't begun.
    const botSeat = this.seats.findIndex((s) => s?.isBot)
    if (!session.isBot && botSeat >= 0 && this.phase === 'countdown') {
      this.unseat(botSeat)
      this.phase = 'waiting'
      this.seats[1 - botSeat]?.toast('A real player joined you! 🎉')
    }
    if (this.phase !== 'waiting') return 'This table is already playing'
    const free = this.seats.indexOf(null)
    if (free < 0) return 'This table is full'

    this.seats[free] = session
    session.seat = { table: this, index: free }

    if (this.seats[0] && this.seats[1]) {
      this.phase = 'countdown'
      this.endsAt = now + T.countdown * 1000
    } else {
      // Alone at the table: in a moment, look for someone else waiting alone.
      this.endsAt = now + T.pairSec * 1000
    }
    this.sync(now)
    return null
  }

  /**
   * "Play WordBot" from a player waiting alone: the only way WordBot ever sits down.
   * Real players still come first (see GameRoom).
   */
  callBot(session, now) {
    if (this.phase !== 'waiting' || this.seatOf(session) < 0 || !this.seats.includes(null)) return
    if (this.room.pairWaiting(this, now)) return
    if (!this.room.botAllowed(this)) {
      session.toast('The tables are busy: a real player will join you soon!')
      return
    }
    this.addBot(now)
  }

  addBot(now) {
    const bot = this.room.addBot(this)
    this.sit(bot, now)
  }

  /**
   * A seated player stands up (`gone` false: they pressed Quit / Leave) or
   * disconnected (`gone` true).
   */
  leave(session, now, { gone = false } = {}) {
    const i = this.seatOf(session)
    if (i < 0) return
    const other = this.seats[1 - i]

    if (this.phase === 'playing') {
      // Quitting mid-duel is a loss that costs money. Someone who quits (rather than
      // drops) stays in their chair to be laughed at first; finish() sends them back
      // to the lobby afterwards.
      const punish = !gone && Boolean(other)
      this.finish(1 - i, i, 'forfeit', now, { punish })
      if (punish) return
    } else if (this.phase === 'countdown' && !other?.isBot) {
      other?.toast('Your opponent left the table')
    }

    this.unseat(i)
    if (this.phase !== 'ended') {
      // WordBot only ever plays with someone: it leaves too.
      if (other?.isBot) this.unseat(1 - i)
      // A remaining player keeps their seat and waits for someone new.
      const stays = other && !other.isBot ? other : null
      this.reset()
      if (stays) {
        this.room.bubble(stays, '')
        this.endsAt = now + T.pairSec * 1000
      }
    }
    this.sync(now)
  }

  unseat(i) {
    const session = this.seats[i]
    if (!session) return
    this.seats[i] = null
    session.seat = null
    if (session.isBot) this.room.removeBot(session)
    else session.send('match', { match: null })
  }

  /**
   * The player whose turn it is sends a word. `input` is untrusted: validateWord
   * decides, and a refusal goes back to the sender alone so their UI can say why.
   */
  word(session, input, now) {
    const i = this.seatOf(session)
    if (i < 0 || this.phase !== 'playing' || this.turn !== i || this.pending) return
    if (now - this.lastSubmit[i] < SUBMIT_GAP_MS) return
    this.lastSubmit[i] = now
    this.tried = true

    const text = typeof input === 'string' ? input.slice(0, MAX_LENGTH + 8) : ''
    const reason = validateWord(text, this.letter, this.used)
    if (reason) {
      session.send('wordError', { reason })
      return
    }
    this.accept(i, normalise(text), now)
  }

  accept(i, word, now) {
    const player = this.seats[i]
    const bonus = word.length >= W.bonusLength
    this.used.add(word)
    this.chain.push({ word, by: i })
    this.letter = word[word.length - 1]
    this.idle[i] = 0

    // Word Book, lucky letter, quests (nothing for WordBot).
    const { fresh, lucky } = this.room.wordPlayed(player, word, now)
    if (player && bonus) {
      this.room.bonusCash(player, W.bonusCash, now)
      this.room.questEvent(player, 'longword', now)
      this.room.broadcast('fx', { kind: 'golden', id: player.id })
    }
    if (player) this.room.bubble(player, bonus ? `${word.toUpperCase()}! ✨` : word.toUpperCase())
    this.tell({ t: 'word', by: i, word, bonus, letter: this.letter, fresh, lucky })
    this.turn = 1 - i
    this.beginTurn(now)
  }

  /**
   * How many letters the player on turn has typed, for the "typing…" dots their
   * opponent sees. Only the count is relayed: half-typed words are not filtered.
   */
  typing(session, count, now) {
    const i = this.seatOf(session)
    if (i < 0 || this.phase !== 'playing' || this.turn !== i || this.pending) return
    if (now - this.lastTyping[i] < TYPING_GAP_MS) return
    this.lastTyping[i] = now
    const n = Number.isInteger(count) ? Math.min(MAX_LENGTH, Math.max(0, count)) : 0
    this.seats[1 - i]?.send('duel', { t: 'typing', n })
  }

  /** A pet's hint: an everyday word that fits, sent to the asker alone. */
  hint(session, now) {
    const i = this.seatOf(session)
    if (i < 0 || this.phase !== 'playing' || this.turn !== i || this.pending) return
    if (this.hintsLeft[i] <= 0) return
    const word = pickWord(this.letter, this.used, { maxLength: HINT_MAX_LENGTH })
    if (!word) {
      session.send('wordError', { reason: 'Even your pet is stumped by this letter! 🤔' })
      return
    }
    this.hintsLeft[i] -= 1
    session.send('hint', { word })
    this.sync(now)
  }

  /**
   * The player on turn ran out of time: their opponent laughs at them and they
   * lose a heart (unless their pet's shield saves it). The last heart: they faint.
   */
  timeUp(now) {
    const i = this.turn
    const o = 1 - i
    const slow = this.seats[i]
    const other = this.seats[o]
    this.idle[i] = this.tried ? 0 : this.idle[i] + 1

    if (this.shieldsLeft[i] > 0) {
      this.shieldsLeft[i] -= 1
      this.room.bubble(slow, '🛡️ SAVED!')
      this.tell({ t: 'shield', by: i, hearts: this.hearts[i] })
      if (slow) this.room.broadcast('fx', { kind: 'golden', id: slow.id })
    } else {
      this.hearts[i] -= 1
      this.fails[i] += 1
      const out = this.hearts[i] <= 0
      this.room.bubble(slow, out ? 'KNOCKED OUT 💫' : 'Oops… 😳')
      this.room.bubble(other, out ? 'HAHAHA! 🤣🤣' : 'HAHA! 🤣')
      this.tell({ t: 'timeout', by: i, hearts: this.hearts[i], letter: this.letter })
      if (slow) this.room.broadcast('fx', { kind: 'laugh', id: slow.id, by: other?.id ?? '', final: out })
      if (out) {
        this.finish(o, i, 'knockout', now)
        return
      }
    }
    // Two turns in a row without a single try: they've wandered off.
    if (this.idle[i] >= 2) {
      this.finish(o, i, 'afk', now)
      return
    }
    // A moment for the laugh, then the other player starts a fresh chain.
    this.pending = true
    this.endsAt = now + T.failPause * 1000
    this.sync(now)
  }

  /**
   * A duel event for both seated players, from each one's point of view: `mine`
   * is true for the player who did it.
   */
  tell({ t, by, ...rest }) {
    this.seats.forEach((s, i) => s?.send('duel', { t, mine: i === by, ...rest }))
  }

  startPlaying(now) {
    this.phase = 'playing'
    this.letter = randomLetter()
    this.turn = Math.random() < 0.5 ? 0 : 1
    this.perks = this.seats.map((s) => petAbility(s?.profile))
    this.hintsLeft = this.perks.map((p) => p.hints)
    this.shieldsLeft = this.perks.map((p) => p.shields)
    for (const s of this.seats) this.room.bubble(s, '')
    this.beginTurn(now)
  }

  beginTurn(now) {
    this.pending = false
    this.tried = false
    // Harder as the chain grows: every word said takes a little off the clock.
    // A pet's extra seconds come on top.
    const base = Math.max(T.turnMin, T.turn - this.chain.length * T.turnStep)
    this.turnMs = (base + this.perks[this.turn].time) * 1000
    this.endsAt = now + this.turnMs
    this.sync(now)
    if (this.seats[this.turn]?.isBot) this.playBot()
  }

  /**
   * WordBot's turn: it "thinks", its typing dots tick up, then it plays an everyday
   * word. Now and then it blanks (more often deep into a chain, or on a hard
   * letter) and lets the clock run out, so it can be beaten.
   */
  playBot() {
    const i = this.turn
    const token = this.token
    const count = this.chain.length
    const missChance = Math.min(
      B.missMax,
      B.missBase + B.missPerWord * count + (B.hardLetters.includes(this.letter) ? B.missHard : 0),
    )
    const word =
      Math.random() < missChance ? null : pickWord(this.letter, this.used, { maxLength: 4 + Math.min(6, Math.floor(count / 3)) })
    const think = (B.thinkMin + Math.random() * (B.thinkMax - B.thinkMin)) * 1000
    const answerAt = Math.min(think, this.turnMs - 900)
    // Still this exact turn? (Nothing happened in between: quit, slap, new duel.)
    const still = () => this.token === token && this.phase === 'playing' && this.turn === i && !this.pending && this.chain.length === count
    const dots = (n) => {
      if (still()) this.seats[1 - i]?.send('duel', { t: 'typing', n })
    }

    if (!word) {
      // Starts typing, gives up.
      this.room.clock.setTimeout(() => dots(1), think * 0.4)
      this.room.clock.setTimeout(() => dots(2), think * 0.4 + BOT_KEY_MS)
      this.room.clock.setTimeout(() => dots(0), think * 1.2)
      return
    }
    for (let k = 1; k <= word.length; k += 1) {
      this.room.clock.setTimeout(() => dots(k), Math.max(0, answerAt - (word.length - k + 1) * BOT_KEY_MS))
    }
    this.room.clock.setTimeout(() => {
      if (still()) this.accept(i, word, Date.now())
    }, answerAt)
  }

  /**
   * Ends the duel. A quitter (`reason` 'forfeit') pays DATA.forfeit.penalty, which
   * goes to the winner on top of the prize; with `punish` they stay in their chair
   * while the winner laughs at them DATA.forfeit.laughs times, and faint at the
   * last. Against WordBot it is practice: smaller rewards, no penalty.
   */
  finish(w, l, reason, now, { punish = false } = {}) {
    const F = DATA.forfeit
    const practice = this.practice
    // The laughs at a quitter, at these times (seconds after now).
    const laughAt = punish ? Array.from({ length: F.laughs }, (_, k) => F.laughFirst + k * F.laughGap) : []
    const punishEnd = laughAt.length ? laughAt[laughAt.length - 1] : 0

    this.phase = 'ended'
    this.endsAt = now + Math.max(T.results, punishEnd + PUNISH_TAIL_S + 1) * 1000
    this.pending = false
    this.winner = w

    const winner = this.seats[w]
    const loser = this.seats[l]
    let reward = 0

    const played = reason === 'knockout'
    const penalty = reason === 'forfeit' && loser && !practice ? this.room.takeCash(loser, F.penalty, now) : 0
    if (winner) {
      reward = this.room.recordWin(winner, { flawless: played && this.fails[w] === 0, practice }, now)
      if (penalty) reward += this.room.bonusCash(winner, penalty, now)
    }
    let consolation = 0
    if (loser) consolation = this.room.recordLoss(loser, now, reason, { practice })
    if (loser && !played) this.room.bubble(loser, punish ? 'Nooo, let me go! 😱' : 'NOOO! 😭')
    if (winner) {
      this.room.bubble(winner, punish ? 'Not so fast! 😤' : reason === 'forfeit' ? 'GG 👍' : 'Too easy! 😎')
    }

    const longest = this.chain.reduce((best, c) => (c.word.length > best.length ? c.word : best), '')
    this.room.broadcast('result', {
      table: this.id,
      winner: winner?.id ?? null,
      loser: loser?.id ?? null,
      words: this.chain.length,
      longest,
      reward,
      consolation,
      penalty,
      reason,
      practice,
      // When the laughs at a quitter come, so clients can hold the winner's dance.
      punish: laughAt.length ? { count: laughAt.length, first: F.laughFirst, gap: F.laughGap } : null,
    })
    this.sync(now)
    // Round end: report leaderboard scores now rather than at the next batch.
    this.room.flushScores()

    const token = this.token
    const stillHere = () => this.token === token && this.seats[l] === loser && loser && this.seats[w] === winner
    laughAt.forEach((at, k) => {
      this.room.clock.setTimeout(() => {
        if (!stillHere()) return
        const final = k === laughAt.length - 1
        this.room.broadcast('fx', { kind: 'laugh', id: loser.id, by: winner.id, final })
        this.room.bubble(winner, final ? 'HAHAHA! BYE! 👋🤣' : 'HAHA, QUITTER! 🤣')
        this.room.bubble(loser, final ? 'KNOCKED OUT 💫' : 'So embarrassing… 😳')
      }, at * 1000)
    })

    // The loser faints off their chair, then respawns back in the lobby while the
    // winner keeps dancing on the table.
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
    if (now < this.endsAt) return
    if (this.phase === 'waiting') {
      if (!this.endsAt || this.seats.filter(Boolean).length !== 1) return
      // Someone has waited alone a while: bring over another player waiting alone,
      // or look again a little later. (WordBot only comes when asked: callBot.)
      if (this.room.pairWaiting(this, now)) return
      this.endsAt = now + T.pairSec * 1000
      return
    }

    if (this.phase === 'countdown') {
      this.startPlaying(now)
    } else if (this.phase === 'playing') {
      if (this.pending) {
        // After a laugh the other player goes, on a brand new letter.
        this.turn = 1 - this.turn
        this.letter = randomLetter()
        this.beginTurn(now)
      } else {
        this.timeUp(now)
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
    const playing = this.phase === 'playing' && !this.pending
    return {
      table: this.id,
      seat: i,
      phase: this.phase,
      endsInMs: Math.max(0, this.endsAt - now),
      turnMs: playing ? this.turnMs : 0,
      letter: this.letter,
      /** The latest words, oldest first; `mine` marks this player's. */
      chain: this.chain.slice(-W.chainShown).map((c) => ({ word: c.word, mine: c.by === i })),
      words: this.chain.length,
      myHearts: this.hearts[i],
      theirHearts: this.hearts[o],
      myTurn: playing && this.turn === i,
      theirTurn: playing && this.turn === o,
      pending: this.pending,
      won: ended && this.winner === i,
      opponent: this.seats[o]?.id ?? null,
      /** Against WordBot (practice rewards). */
      practice: this.practice,
      /** Waiting alone: whether WordBot can be called (not while tables are short). */
      botAllowed: this.phase === 'waiting' && this.room.botAllowed(this),
      /** Your pet's perks this duel: extra seconds per turn, hints and shields left. */
      extraSec: this.perks[i].time,
      hintsLeft: this.hintsLeft[i],
      shieldsLeft: this.shieldsLeft[i],
    }
  }

  /**
   * Publishes the table: the public part through the synced state (Colyseus sends
   * only fields that changed), the private part to each seated player.
   */
  sync(now = Date.now()) {
    const st = this.state
    const ended = this.phase === 'ended'
    const playing = this.phase === 'playing' && !this.pending
    st.phase = this.phase
    st.seat0 = this.seats[0]?.id ?? ''
    st.seat1 = this.seats[1]?.id ?? ''
    st.chair0 = this.seats[0]?.profile.equippedChair ?? ''
    st.chair1 = this.seats[1]?.profile.equippedChair ?? ''
    st.turn = playing ? (this.seats[this.turn]?.id ?? '') : ''
    st.winner = ended ? (this.seats[this.winner]?.id ?? '') : ''
    // No clock while waiting: the pairing check is the server's business.
    st.endsAt = this.phase === 'waiting' ? 0 : this.endsAt
    st.letter = this.phase === 'playing' ? this.letter : ''
    st.last = this.chain.length ? this.chain[this.chain.length - 1].word : ''
    st.count = this.chain.length
    st.hearts0 = this.hearts[0]
    st.hearts1 = this.hearts[1]
    this.seats.forEach((s, i) => s?.send('match', { match: this.privateState(i, now) }))
  }
}

module.exports = Table
