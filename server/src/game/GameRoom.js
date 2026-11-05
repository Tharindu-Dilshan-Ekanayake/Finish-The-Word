const { Room, ServerError } = require('@colyseus/core')

const { resolveIdentity } = require('../bloxity/identity')
const { flushScores, submitScore } = require('../bloxity/leaderboards')
const Bot = require('./Bot')
const DATA = require('./data')
const { petAbility } = require('./pets')
const profiles = require('./profiles')
const { GameState, PlayerState, TableState } = require('./schema')
const { cleanName, Session } = require('./Session')
const Table = require('./Table')

const TICK_MS = 100
/** 10 Hz state patches: positions are interpolated client-side, so more buys nothing. */
const PATCH_MS = 100
/** How long a dropped player keeps their place (and table seat) while reconnecting. */
const RECONNECT_SECONDS = 20
const LEADERBOARD_PUSH_MS = 15000
/** How often time in the game is counted for everyone connected. */
const PLAYTIME_TICK_MS = 30000
/** Close code for a session replaced by the same account joining from elsewhere. */
const REPLACED = 4100
/** Close code for a player removed for being away (AFK), so their slot frees up. */
const AWAY = 4101
/** How often everyone is checked for being away. */
const AFK_CHECK_MS = 5000

/** profile id -> live session, across every room in this process. */
const liveByProfile = new Map()

/**
 * One game server: up to DATA.roomSize (30) players sharing the island and its tables.
 *
 * Colyseus matchmaking fills a room to `maxClients`, locks it, and `joinOrCreate`
 * then opens a new one, so "server size 20" is just the cap here.
 */
class GameRoom extends Room {
  maxClients = DATA.roomSize
  patchRate = PATCH_MS
  /** Clients over this are disconnected; normal play sends ~12/s. */
  maxMessagesPerSecond = 40

  onCreate() {
    this.state = new GameState()
    /** session id -> Session, including players mid-reconnect. */
    this.sessions = new Map()
    this.lastBoard = ''

    this.tables = DATA.tables.map((def) => {
      const state = new TableState()
      this.state.tables.set(String(def.id), state)
      const table = new Table(def, this, state)
      table.sync()
      return table
    })

    this.onMessage('*', (client, type, message) => {
      this.sessions.get(client.sessionId)?.handle(type, message, Date.now())
    })

    this.clock.setInterval(() => {
      const now = Date.now()
      for (const table of this.tables) table.tick(now)
    }, TICK_MS)
    this.clock.setInterval(() => this.pushLeaderboard(), LEADERBOARD_PUSH_MS)
    this.lastPlaytimeTick = Date.now()
    this.clock.setInterval(() => this.tickPlaytime(), PLAYTIME_TICK_MS)
    this.clock.setInterval(() => this.checkAfk(Date.now()), AFK_CHECK_MS)
  }

  /**
   * Runs before a seat is granted: verifies the Bloxity token, then loads the
   * profile. The result becomes `client.auth`.
   */
  async onAuth(_client, options) {
    const identity = await resolveIdentity(options, cleanName)
    if (!identity) throw new ServerError(400, 'Missing player identity')
    const profile = await profiles.loadProfile(identity.profileId, identity.name, {
      carriedFrom: identity.carriedFrom,
    })
    return { identity, profile }
  }

  onJoin(client, options) {
    const now = Date.now()
    const { identity, profile } = client.auth

    // One account, one place: a second tab replaces the first.
    const previous = liveByProfile.get(identity.profileId)
    if (previous) {
      previous.toast('You joined from another window')
      previous.room.kick(previous)
    }

    const player = new PlayerState()
    const session = new Session(client, this, player, identity, profile, options, now)
    this.sessions.set(client.sessionId, session)
    liveByProfile.set(identity.profileId, session)
    this.state.players.set(client.sessionId, player)
    // Puts players who levelled up before the Level board existed on it (it keeps each player's best).
    if (profile.level > 1) submitScore(session.userId, 'level', profile.level)
    this.sendWelcome(session, now)
  }

  onDrop(client) {
    const session = this.sessions.get(client.sessionId)
    // A kicked session must not get a reconnection window (it would linger as a
    // ghost for RECONNECT_SECONDS); without one, Colyseus goes straight to onLeave.
    if (session && !session.kicked) {
      session.reconnection = this.allowReconnection(client, RECONNECT_SECONDS)
    }
  }

  onReconnect(client) {
    const session = this.sessions.get(client.sessionId)
    if (!session) return
    session.client = client
    session.reconnection = null
    // Private messages sent while they were away are lost; resend what matters.
    this.sendWelcome(session, Date.now())
  }

  onLeave(client) {
    const session = this.sessions.get(client.sessionId)
    if (!session) return
    const now = Date.now()
    session.seat?.table.leave(session, now, { gone: true })
    session.close(now)
    profiles.release(session.profile)
    this.sessions.delete(client.sessionId)
    this.state.players.delete(client.sessionId)
    if (liveByProfile.get(session.profile.id) === session) liveByProfile.delete(session.profile.id)
  }

  onUncaughtException(error, methodName) {
    console.error(`[game] room ${this.roomId} ${methodName} failed:`, error)
  }

  /**
   * Players who are away free their slot for someone who wants to play: warned
   * after DATA.afk.warnSec without doing anything ("Are you still there?"), removed
   * from the room after DATA.afk.kickSec. In a duel the duel's own rule applies
   * instead (two idle turns lose it), so nobody is removed mid-game.
   */
  checkAfk(now) {
    const { warnSec, kickSec } = DATA.afk
    for (const session of this.sessions.values()) {
      if (session.kicked || session.reconnection) continue
      const phase = session.seat?.table.phase
      if (phase === 'countdown' || phase === 'playing' || phase === 'ended') {
        session.lastActiveAt = now
        continue
      }
      const idle = now - session.lastActiveAt
      if (idle >= kickSec * 1000) {
        console.log(`[afk] room ${this.roomId}: removing ${session.player.name} after ${Math.round(idle / 1000)} s away`)
        this.kick(session, AWAY)
      } else if (idle >= warnSec * 1000 && !session.afkWarned) {
        session.afkWarned = true
        session.send('afkWarn', { inMs: kickSec * 1000 - idle })
      }
    }
  }

  /**
   * Disconnects a session, including one that is mid-reconnect. `code` tells the
   * client why: REPLACED (joined from elsewhere) or AWAY (removed for being AFK).
   */
  kick(session, code = REPLACED) {
    session.kicked = true
    if (session.reconnection) session.reconnection.reject(new Error('kicked'))
    else session.client.leave(code)
  }

  sendWelcome(session, now) {
    session.send('welcome', {
      capacity: DATA.roomSize,
      // Lets clients turn the state's server-clock deadlines into local ones.
      serverNow: now,
      profile: session.profileView(now),
      lb: profiles.leaderboards(),
    })
    if (session.seat) session.seat.table.sync(now)
  }

  pushLeaderboard() {
    const board = profiles.leaderboards()
    const json = JSON.stringify(board)
    if (json === this.lastBoard) return
    this.lastBoard = json
    this.broadcast('lb', board)
  }

  /** Counts time played for everyone here; whole minutes go to the Bloxity board. */
  tickPlaytime() {
    const now = Date.now()
    const seconds = Math.min(60, (now - this.lastPlaytimeTick) / 1000)
    this.lastPlaytimeTick = now
    for (const session of this.sessions.values()) {
      const minutes = profiles.addPlaytime(session.profile, seconds)
      if (minutes > 0) submitScore(session.userId, 'playtime', minutes)
    }
  }

  flushScores() {
    void flushScores()
  }

  /**
   * May WordBot take the free seat at `table`? Real players come first: only while
   * the empty tables left can still seat everyone walking around in pairs, so a
   * room full of practice duels never leaves a real player without a table.
   */
  botAllowed(table) {
    let standing = 0
    for (const s of this.sessions.values()) if (!s.seat && !s.reconnection) standing += 1
    let empty = 0
    for (const t of this.tables) if (t !== table && t.phase === 'waiting' && !t.seats[0] && !t.seats[1]) empty += 1
    return standing <= empty * 2
  }

  /**
   * Two real players each waiting alone should play each other, not WordBot: the
   * one waiting at another table moves over to `table` (whose player has waited
   * longer). Returns true if someone moved.
   */
  pairWaiting(table, now) {
    const host = table.seats.find(Boolean)
    if (!host || host.isBot) return false
    for (const other of this.tables) {
      if (other === table || other.phase !== 'waiting') continue
      const seated = other.seats.filter(Boolean)
      if (seated.length !== 1 || seated[0].isBot) continue
      const guest = seated[0]
      other.leave(guest, now)
      if (table.sit(guest, now)) return false
      guest.toast(`Found you an opponent: ${host.player.name}! 🎉`)
      host.toast(`${guest.player.name} is joining your table! 🎉`)
      return true
    }
    return false
  }

  /** WordBot takes a seat at `table`: everyone in the room sees it as a player. */
  addBot(table) {
    const bot = new Bot(table)
    this.state.players.set(bot.id, bot.player)
    return bot
  }

  removeBot(bot) {
    this.state.players.delete(bot.id)
  }

  /**
   * A word a player got accepted: into their Word Book (milestones pay), the lucky
   * letter bonus, and quest progress. Returns { fresh, lucky } for the duel's callout.
   */
  wordPlayed(session, word, now) {
    if (!session || session.isBot) return { fresh: false, lucky: false }
    const p = session.profile
    const { fresh, milestone } = profiles.addToWordBook(p, word)
    const lucky = word.endsWith(profiles.luckyLetter(now))
    if (lucky) {
      p.cash += DATA.lucky.cash
      profiles.addQuestEvent(p, 'lucky', 1, now)
    }
    if (fresh) profiles.addQuestEvent(p, 'newword', 1, now)
    profiles.addQuestEvent(p, 'word', 1, now)
    if (milestone) {
      session.toast(`📚 Word Book: ${milestone.at} words! +$${milestone.cash}`)
      this.broadcast('toast', { text: `📚 ${session.player.name} collected ${milestone.at} words!` }, { except: session.client })
    }
    profiles.markDirty(p)
    session.pushProfile(now)
    return { fresh, lucky }
  }

  /** Extra cash outside the win/loss rewards (a long-word bonus, a quitter's penalty). Returns it. */
  bonusCash(session, amount, now) {
    if (!session || session.isBot) return 0
    session.profile.cash += amount
    profiles.markDirty(session.profile)
    session.pushProfile(now)
    return amount
  }

  /** Takes up to `amount` from a player (never below $0). Returns what was taken. */
  takeCash(session, amount, now) {
    if (!session || session.isBot) return 0
    const taken = Math.min(amount, session.profile.cash)
    if (taken <= 0) return 0
    session.profile.cash -= taken
    profiles.markDirty(session.profile)
    session.pushProfile(now)
    return taken
  }

  questEvent(session, event, now) {
    if (!session || session.isBot) return
    profiles.addQuestEvent(session.profile, event, 1, now)
    session.pushProfile(now)
  }

  bubble(session, text) {
    if (session) this.broadcast('bubble', { id: session.id, text })
  }

  table(id) {
    return this.tables.find((t) => t.id === id) || null
  }

  /** Duel cash after the weekend boost, a 2X CASH pass and the equipped pet's bonus. */
  duelCash(p, base, now, { practice = false } = {}) {
    const passes = p.passes.includes('cash2x') ? 2 : 1
    const pet = 1 + petAbility(p).cash / 100
    const rate = practice ? DATA.bot.rewardRate : 1
    return Math.round(base * (profiles.isWeekend(now) ? 2 : 1) * passes * pet * rate)
  }

  /**
   * Awards a win. `flawless`: won a finished duel without losing a heart.
   * `practice`: beat WordBot, which pays less and leaves wins, streaks and the
   * leaderboards alone (quests and XP still count). Returns the cash granted.
   */
  recordWin(session, { flawless = false, practice = false } = {}, now) {
    if (!session || session.isBot) return 0
    const p = session.profile
    const has = (pass) => p.passes.includes(pass)
    const cash = this.duelCash(p, DATA.winReward, now, { practice })

    if (practice) {
      p.cash += cash
      profiles.addQuestEvent(p, 'play', 1, now)
      profiles.addQuestEvent(p, 'win', 1, now)
      profiles.markDirty(p)
      this.giveXp(session, Math.round(DATA.xp.win * DATA.bot.rewardRate))
      session.pushProfile(now)
      return cash
    }

    const streakBefore = p.streak
    p.cash += cash
    p.wins += has('wins2x') ? 2 : 1
    p.streak += has('streak2x') ? 2 : 1
    p.bestStreak = Math.max(p.bestStreak, p.streak)
    profiles.addQuestEvent(p, 'play', 1, now)
    profiles.addQuestEvent(p, 'win', 1, now)
    if (flawless) profiles.addQuestEvent(p, 'flawless', 1, now)
    if (p.streak >= 3) profiles.addQuestEvent(p, 'streak3', 1, now)

    // Win-streak milestones pay a bonus, announced to the whole server.
    for (const [milestone, bonus] of Object.entries(DATA.streakBonuses)) {
      const m = Number(milestone)
      if (streakBefore < m && p.streak >= m) {
        p.cash += bonus
        session.toast(`🔥 ${m} win streak! +$${bonus}`)
        this.broadcast('toast', { text: `🔥 ${session.player.name} is on a ${m} win streak!` }, { except: session.client })
      }
    }
    profiles.markDirty(p)

    // Bloxity leaderboards, from server-owned state only.
    submitScore(session.userId, 'wins', has('wins2x') ? 2 : 1)
    submitScore(session.userId, 'best_streak', p.bestStreak)

    session.player.streak = p.streak
    this.giveXp(session, DATA.xp.win)
    session.pushProfile(now)
    return cash
  }

  /** XP for a duel; a level-up is celebrated for the player and shown to the room. */
  giveXp(session, amount) {
    const reached = profiles.addXp(session.profile, amount)
    session.player.level = session.profile.level
    if (reached.length) submitScore(session.userId, 'level', session.profile.level)
    for (const level of reached) {
      const reward = Math.min(DATA.xp.rewardCap, DATA.xp.rewardPerLevel * level)
      const title = DATA.titles.find((t) => t.level === level)
      session.send('levelUp', { level, reward, title: title?.name ?? null })
    }
  }

  /**
   * A lost duel still pays a little (and XP), so every game moves you forward.
   * Quitting or timing out pays nothing. Returns the cash given.
   */
  recordLoss(session, now, reason = 'knockout', { practice = false } = {}) {
    if (!session || session.isBot) return 0
    const p = session.profile
    // Losing to WordBot is practice: the win streak survives it.
    if (!practice) {
      p.streak = 0
      session.player.streak = 0
    }
    profiles.addQuestEvent(p, 'play', 1, now)
    const finished = reason === 'knockout'
    const cash = finished ? Math.round(this.duelCash(p, DATA.lossReward, now, { practice })) : 0
    p.cash += cash
    profiles.markDirty(p)
    if (finished) this.giveXp(session, Math.round(DATA.xp.loss * (practice ? DATA.bot.rewardRate : 1)))
    session.pushProfile(now)
    return cash
  }
}

module.exports = GameRoom
