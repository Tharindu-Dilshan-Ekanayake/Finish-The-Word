const DATA = require('./data')
const { PlayerState } = require('./schema')

let count = 0

/**
 * WordBot: the opponent who sits down when nobody else does, so a player is never
 * stuck waiting at an empty table. It takes a seat like a Session (same `id`,
 * `seat`, `profile.equippedChair`, `send` …) and shows up for everyone as a
 * player in the synced state, so the room sees it sit, get slapped and dance.
 *
 * It has no client and no saved profile: messages to it are dropped, and the
 * room's rewards skip it (see GameRoom). Table decides its words (see playBot).
 */
class Bot {
  constructor(table) {
    count += 1
    this.isBot = true
    /** Never collides with a Colyseus session id (those are 9 random characters). */
    this.id = `bot-${count}`
    this.seat = null
    this.profile = { equippedChair: 'basic', equippedPet: '' }
    this.player = new PlayerState()
    const p = this.player
    p.name = DATA.bot.name
    p.uid = ''
    p.uname = ''
    p.streak = 0
    p.level = 1 + Math.floor(Math.random() * 12)
    p.title = ''
    p.halo = ''
    p.pet = ''
    p.emote = ''
    p.emoteSeq = 0
    p.avatar = '{}'
    p.x = table.x
    p.y = 0
    p.z = table.z
    p.ry = 0
    p.s = 0
    p.g = true
  }

  send() {}

  toast() {}

  respawn() {}
}

module.exports = Bot
