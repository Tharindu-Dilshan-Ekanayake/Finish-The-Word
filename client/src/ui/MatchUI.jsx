import { useEffect, useRef, useState } from 'react'

import { sfx } from '../audio/sfx'
import { DATA, emoteById, titleById } from '../game/layout'
import { useGame } from '../net/gameStore'
import { bubbles } from '../net/liveState'
import { send } from '../net/api'
import { money, useNow } from './format'

const W = DATA.words
/** Longest word in the dictionary; the server refuses anything longer anyway. */
const MAX_WORD = 28
/** The opponent's "typing…" dots are updated at most this often. */
const TYPING_EVERY_MS = 120

const secondsLeft = (endsAt, now) => Math.max(0, Math.ceil((endsAt - now) / 1000))

/**
 * Big centre text (countdown, result), below the VS bar and above the players' heads.
 * `top` is its own prop: two `top-*` classes on one element would fight.
 */
function Banner({ children, top = 'top-[30%]' }) {
  return (
    <div className={`pointer-events-none absolute left-1/2 z-30 w-[92vw] -translate-x-1/2 text-center ${top}`}>
      {children}
    </div>
  )
}

/** Leaves the table; mid-duel (`forfeit`) it asks first, in the QuitDialog. */
function LeaveButton({ label = 'Leave', forfeit = false }) {
  return (
    <button
      type="button"
      onClick={() => {
        sfx.click()
        if (forfeit) useGame.setState({ quitAsk: true })
        else send({ t: 'leave' })
      }}
      className="btn-3d press pointer-events-auto bg-gradient-to-b from-[#ff5a5a] to-[#d81f1f] px-4 py-1.5 text-base font-bold text-white"
    >
      <span className="stroke-thin">{label}</span>
    </button>
  )
}

/**
 * "Quit the duel?" in the middle of the screen, in the game's own style (not the
 * browser's confirm box). Quitting is a loss: you pay up to DATA.forfeit.penalty to
 * your opponent and they laugh you out of your chair. Esc or a tap outside keeps playing.
 */
function QuitDialog() {
  const cash = useGame((s) => s.profile?.cash ?? 0)
  const pay = Math.min(DATA.forfeit.penalty, cash)
  const stay = () => {
    sfx.click()
    useGame.setState({ quitAsk: false })
  }
  const quit = () => {
    sfx.click()
    useGame.setState({ quitAsk: false })
    send({ t: 'leave' })
  }

  useEffect(() => {
    // Captured first, so Esc only closes this (and doesn't also open Bloxity's menu).
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      useGame.setState({ quitAsk: false })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div className="pointer-events-auto absolute inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={stay}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quit-title"
        onClick={(e) => e.stopPropagation()}
        className="ui-panel pop-in flex w-[min(90vw,24rem)] flex-col items-center gap-3 px-5 py-4 text-center"
      >
        <div className="text-[2.8rem] leading-none">🏃💨</div>
        <h2 id="quit-title" className="stroke-text text-[1.7rem] font-bold leading-tight text-white">
          Quit the duel?
        </h2>
        <p className="text-sm font-semibold leading-snug text-white/85">
          Quitting counts as a loss. Your opponent wins the prize{' '}
          {pay > 0 && (
            <>
              <span className="font-bold text-[#ff8a8a]">plus {money(pay)} of your cash</span>,{' '}
            </>
          )}
          and gets to laugh at you before you go! 🤣
        </p>
        <div className="mt-1 flex w-full gap-2">
          <button
            type="button"
            autoFocus
            onClick={stay}
            className="btn-3d press flex-1 bg-gradient-to-b from-[#5dff5d] to-[#22c522] px-2 py-2 text-base font-bold text-white"
          >
            <span className="stroke-thin">KEEP PLAYING</span>
          </button>
          <button
            type="button"
            onClick={quit}
            className="btn-3d press flex-1 bg-gradient-to-b from-[#ff5a5a] to-[#d81f1f] px-2 py-2 text-base font-bold text-white"
          >
            <span className="stroke-thin">QUIT{pay > 0 ? ` −${money(pay)}` : ''}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/** ❤️❤️❤️ / ❤️❤️💔: a heart is lost every time you run out of time. */
function Hearts({ hearts = W.hearts, className = '' }) {
  return (
    <span className={`whitespace-nowrap leading-none ${className}`}>
      {Array.from({ length: W.hearts }, (_, i) => (i < hearts ? '❤️' : '💔')).join('')}
    </span>
  )
}

/** What a duelist last said (an emote, their word, "OUCH! 😵"), while it lasts. */
function speechOf(id, now) {
  const b = id ? bubbles.get(id) : null
  return b && b.text && b.until > now ? b.text : null
}

/**
 * One side of the VS bar: title, name, hearts, and a speech bubble underneath.
 * `turn`: 'active' (their go: glowing, with a TURN tab) or 'idle' (the other
 * player's go: faded), or null outside a turn.
 */
function DuelistCard({ player, isSelf, turn, hearts, speech, align }) {
  const title = titleById(player?.title)
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col gap-1.5 transition-opacity duration-300 ${
        align === 'left' ? 'items-start' : 'items-end'
      } ${turn === 'idle' ? 'opacity-55' : ''}`}
    >
      <div
        className={`ui-panel flex w-full min-w-0 flex-col px-2.5 py-1 ${
          align === 'left' ? 'items-start text-left' : 'items-end text-right'
        } ${turn === 'active' ? 'turn-ring' : ''}`}
      >
        {title && (
          <span
            className={`max-w-full truncate text-[0.65rem] font-bold leading-tight ${title.rainbow ? 'rainbow-text' : ''}`}
            style={title.rainbow ? undefined : { color: title.color }}
          >
            {title.name}
          </span>
        )}
        <span className="stroke-thin flex max-w-full items-center gap-1 text-base font-bold leading-tight text-white">
          <span className="truncate">{player?.name || '…'}</span>
          {isSelf && <span className="shrink-0 rounded bg-[#2a6bff] px-1 text-[0.6rem]">YOU</span>}
        </span>
        {/* Hearts, and the TURN tab beside them (on the side away from the edge). */}
        <span className={`mt-0.5 flex items-center gap-1.5 ${align === 'left' ? '' : 'flex-row-reverse'}`}>
          <Hearts hearts={hearts} className="text-base" />
          {turn === 'active' && (
            <span className="turn-tab stroke-thin whitespace-nowrap rounded-full border-2 border-black/70 bg-gradient-to-b from-[#ffe45c] to-[#f2b200] px-1.5 text-[0.65rem] font-bold leading-snug text-white">
              🎯 TURN
            </span>
          )}
        </span>
      </div>
      {speech && (
        <div
          key={speech}
          className={`speech pop-in max-w-full truncate rounded-xl border-2 border-black/70 bg-white px-2 py-0.5 text-sm font-bold leading-snug text-[#1d2433] ${
            align === 'left' ? 'speech-left' : 'speech-right'
          }`}
        >
          {speech}
        </div>
      )}
    </div>
  )
}

/**
 * A word in the chain: its last letter (the next word's first) lit up, and a NEW
 * tag on yours that just went into your Word Book.
 */
function ChainWord({ word, mine, latest, fresh }) {
  const up = word.toUpperCase()
  return (
    <span
      className={`chain-word relative ${latest ? 'pop-in' : 'opacity-80'} shrink-0 rounded-lg border-2 border-black/60 px-1.5 py-0.5 text-sm font-bold leading-none text-white ${
        mine ? 'bg-[#2a6bff]' : 'bg-[#e0502e]'
      }`}
    >
      <span className="stroke-thin">{up.slice(0, -1)}</span>
      <span className="stroke-thin text-[#ffe23d]">{up.slice(-1)}</span>
      {fresh && (
        <span className="absolute -right-1.5 -top-2 rounded bg-[#5dff7a] px-0.5 text-[0.5rem] leading-tight text-[#0d3a1c]">
          NEW
        </span>
      )}
    </span>
  )
}

/**
 * The chain so far, newest on the right; older words slide off the left edge.
 * POODLE → ELEPHANT → TURTLE
 */
function ChainStrip({ match }) {
  const freshWords = useGame((s) => s.freshWords)
  if (!match.chain.length) {
    return (
      <div className="ui-panel px-3 py-1 text-xs font-bold text-white/80">
        Say a word that starts with the letter. Then they go from YOUR last letter!
      </div>
    )
  }
  // Centred while it fits; once it doesn't, the inner row is capped at full width
  // and, pinned to its end, clips the oldest words off the left.
  return (
    <div className="flex w-full justify-center">
      <div className={`flex min-w-0 max-w-full items-center justify-end gap-1 overflow-hidden ${match.words > 4 ? 'chain-strip' : ''}`}>
        {match.chain.map((c, k) => (
          <span key={`${match.words - match.chain.length + k}`} className="flex shrink-0 items-center gap-1">
            {k > 0 && <span className="stroke-thin text-sm font-bold text-white/80">→</span>}
            <ChainWord
              word={c.word}
              mine={c.mine}
              latest={k === match.chain.length - 1}
              fresh={c.mine && freshWords.includes(c.word)}
            />
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * Top of the screen during a duel: opponent | timer + what's happening | you, and
 * the chain of words under it. The sides match where each player sits on screen
 * (seat 0 is on the right of the duel camera).
 */
function DuelBar({ match, now }) {
  const selfId = useGame((s) => s.selfId)
  const profile = useGame((s) => s.profile)
  const them = useGame((s) => (match.opponent ? s.players[match.opponent] : null))
  const self = { name: profile?.name || 'You', title: profile?.equippedTitle }

  const playing = match.phase === 'playing'
  const left = secondsLeft(match.endsAt, now)
  let status
  if (match.phase === 'countdown') status = 'GET READY'
  else if (match.myTurn) status = 'YOUR TURN'
  else if (match.pending) status = 'HAHA! 🤣'
  else status = 'THEIR TURN'

  const turnOf = (mine) => (!playing || match.pending ? null : (mine ? match.myTurn : match.theirTurn) ? 'active' : 'idle')

  const myCard = (
    <DuelistCard
      key="me"
      player={self}
      isSelf
      turn={turnOf(true)}
      hearts={match.myHearts}
      speech={speechOf(selfId, now)}
      align={match.seat === 0 ? 'right' : 'left'}
    />
  )
  const theirCard = (
    <DuelistCard
      key="them"
      player={them}
      turn={turnOf(false)}
      hearts={match.theirHearts}
      speech={speechOf(match.opponent, now)}
      align={match.seat === 0 ? 'left' : 'right'}
    />
  )
  return (
    <div className="hud-top pointer-events-none absolute left-1/2 z-40 flex w-[min(94vw,38rem)] -translate-x-1/2 flex-col items-center gap-1.5">
      <div className="flex w-full items-start gap-2">
        {match.seat === 0 ? theirCard : myCard}
        <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
          <div
            className={`btn-3d flex size-12 items-center justify-center text-xl font-bold text-white ${
              left <= 3 && playing && !match.pending ? 'bg-[#e53935]' : 'bg-[#2d6b78]'
            }`}
          >
            <span className="stroke-thin">{match.phase === 'countdown' ? 'VS' : match.pending ? '🤣' : left}</span>
          </div>
          <span
            className={`stroke-thin whitespace-nowrap rounded-md px-1.5 text-[0.7rem] font-bold text-white ${
              match.myTurn ? 'bg-[#22c55e]' : 'bg-black/45'
            }`}
          >
            {status}
          </span>
          {match.practice && (
            <span className="stroke-thin whitespace-nowrap rounded-md bg-[#8a5cff] px-1.5 text-[0.6rem] font-bold text-white">
              🤖 PRACTICE
            </span>
          )}
        </div>
        {match.seat === 0 ? myCard : theirCard}
      </div>
      {playing && <ChainStrip match={match} />}
    </div>
  )
}

/** The letter the word must start with, as a big game tile. */
function LetterTile({ letter, size = 'size-14 text-[2.4rem]' }) {
  return (
    <span className={`letter-tile flex shrink-0 items-center justify-center rounded-xl font-bold text-[#1d2433] ${size}`}>
      {(letter || '?').toUpperCase()}
    </span>
  )
}

/** How much of the turn is left, as a bar that goes from green to red. */
function TimerBar({ match, now }) {
  const total = match.turnMs || 1
  const frac = Math.max(0, Math.min(1, (match.endsAt - now) / total))
  const color = frac > 0.5 ? '#5dff7a' : frac > 0.25 ? '#ffcf4a' : '#ff4a4a'
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full border-2 border-black/60 bg-black/40">
      <div className="timer-fill h-full rounded-full" style={{ width: `${frac * 100}%`, background: color }} />
    </div>
  )
}

/**
 * Your turn: type a word starting with the letter and send it. The server checks
 * it (letters only, 3+ letters, the right first letter, not used yet, in the
 * dictionary) and says why if not; nothing is decided here. Keystrokes are only
 * tidied (letters, lowercase) so the box shows what will be sent.
 */
function WordPanel({ match, now }) {
  const error = useGame((s) => s.wordError)
  const hint = useGame((s) => s.hint)
  const lucky = useGame((s) => s.profile?.lucky)
  const [text, setText] = useState(match.letter)
  const typing = useRef({ at: 0, timer: 0, sent: -1 })

  // The opponent sees how many letters you've typed (never the letters).
  const relayTyping = (n) => {
    const r = typing.current
    clearTimeout(r.timer)
    const wait = Math.max(0, TYPING_EVERY_MS - (Date.now() - r.at))
    r.timer = setTimeout(() => {
      if (n === r.sent) return
      r.sent = n
      r.at = Date.now()
      send({ t: 'typing', n })
    }, wait)
  }

  useEffect(() => {
    relayTyping(match.letter.length)
    const r = typing.current
    return () => clearTimeout(r.timer)
    // Once per turn: the panel is mounted fresh for each of your turns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onChange = (e) => {
    const next = e.target.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, MAX_WORD)
    setText(next)
    if (useGame.getState().wordError) useGame.setState({ wordError: null })
    relayTyping(next.length)
  }

  const submit = (e) => {
    e.preventDefault()
    if (!text) return
    sfx.click()
    send({ t: 'word', text })
  }

  const applyHint = () => {
    sfx.click()
    setText(hint.word)
    relayTyping(hint.word.length)
  }

  return (
    <form
      onSubmit={submit}
      className="word-panel-pos ui-panel my-turn-glow pop-in pointer-events-auto absolute z-30 flex w-[min(94vw,27rem)] flex-col gap-2 p-2.5"
    >
      <div className="flex items-center gap-2.5">
        <LetterTile letter={match.letter} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="stroke-text text-xl font-bold leading-tight text-[#7dff7a]">YOUR TURN! ✍️</span>
          <span className="text-xs font-bold leading-snug text-white/80">
            A word starting with <span className="text-[#ffe23d]">{match.letter.toUpperCase()}</span> · {W.minLength}+
            letters · no repeats
          </span>
        </div>
        <span className="stroke-text shrink-0 text-2xl font-bold text-white">{secondsLeft(match.endsAt, now)}</span>
      </div>
      <TimerBar match={match} now={now} />
      <div className="flex gap-2">
        {/* Remounted (re-focused, shaking) on each refusal; the word stays to be fixed. */}
        <input
          key={error?.at ?? 0}
          value={text}
          onChange={onChange}
          autoFocus
          aria-label={`A word starting with ${match.letter.toUpperCase()}`}
          aria-invalid={Boolean(error)}
          aria-describedby="word-error"
          placeholder={`${match.letter.toUpperCase()}…`}
          maxLength={MAX_WORD}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="send"
          className={`word-input min-w-0 flex-1 select-text rounded-xl border-[3px] bg-white px-3 py-2 text-2xl font-bold uppercase tracking-wider text-[#1d2433] outline-none placeholder:text-black/25 ${
            error ? 'shake border-[#ff4a4a]' : 'border-black/60 focus:border-[#2a6bff]'
          }`}
        />
        <button
          type="submit"
          disabled={!text}
          className="btn-3d press shrink-0 bg-gradient-to-b from-[#5dff5d] to-[#22c522] px-4 text-lg font-bold text-white disabled:opacity-50"
        >
          <span className="stroke-thin">SEND ⏎</span>
        </button>
      </div>
      <div id="word-error" role="alert" className="min-h-[1.25rem] text-center text-sm font-bold leading-tight">
        {error && <span className="stroke-thin text-[#ff8a8a]">❌ {error.reason}</span>}
      </div>
      <Perks match={match} lucky={lucky} hint={hint} onUseHint={applyHint} />
    </form>
  )
}

/**
 * Under the word box: today's lucky letter, your pet's hint button (or its hint,
 * tap to use), shields left and extra seconds.
 */
function Perks({ match, lucky, hint, onUseHint }) {
  const chip = 'stroke-thin whitespace-nowrap rounded-lg border-2 border-black/50 px-1.5 py-0.5 text-xs font-bold text-white'
  return (
    <div className="-mt-1 flex flex-wrap items-center justify-center gap-1.5">
      {lucky && (
        <span className={`${chip} bg-[#c58a00]`} title="End a word with today's lucky letter for bonus cash">
          ⭐ End with {lucky.toUpperCase()} = +${DATA.lucky.cash}
        </span>
      )}
      {hint ? (
        <button type="button" onClick={onUseHint} className={`btn-3d press ${chip} bg-gradient-to-b from-[#fff15c] to-[#ffb800]`}>
          💡 Try {hint.word.toUpperCase()}
        </button>
      ) : (
        match.hintsLeft > 0 && (
          <button
            type="button"
            onClick={() => {
              sfx.click()
              send({ t: 'hint' })
            }}
            className={`btn-3d press ${chip} bg-gradient-to-b from-[#c49bff] to-[#7b4dff]`}
          >
            💡 Pet hint ({match.hintsLeft})
          </button>
        )
      )}
      {match.shieldsLeft > 0 && <span className={`${chip} bg-[#2d6b78]`}>🛡️ {match.shieldsLeft}</span>}
      {match.extraSec > 0 && <span className={`${chip} bg-[#2d6b78]`}>🐾 +{match.extraSec}s</span>}
    </div>
  )
}

/** Their turn: their letter, the clock, and dots for each letter they've typed. */
function WatchPanel({ match, name, now }) {
  const typed = useGame((s) => s.oppTyping)
  const n = typed && now - typed.at < 4000 ? typed.n : 0
  return (
    <div className="word-panel-pos ui-panel pointer-events-none absolute z-30 flex w-[min(90vw,22rem)] flex-col gap-1.5 p-2 opacity-95">
      <div className="flex items-center gap-2">
        <LetterTile letter={match.letter} size="size-10 text-[1.7rem]" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="stroke-thin truncate text-sm font-bold text-[#ffcf4a]">⏳ {name} is thinking…</span>
          <span className="flex h-4 items-center gap-1" aria-label={`${n} letters typed`}>
            {n > 0 ? (
              Array.from({ length: Math.min(n, 16) }, (_, k) => <span key={k} className="typing-dot" />)
            ) : (
              <span className="text-xs font-bold text-white/60">get your next word ready!</span>
            )}
          </span>
        </div>
        <span className="stroke-text shrink-0 text-xl font-bold text-white">{secondsLeft(match.endsAt, now)}</span>
      </div>
      <TimerBar match={match} now={now} />
    </div>
  )
}

/** "YOUR TURN!" slammed across the middle of the screen as a chain starts. */
function TurnSplash({ letter }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-[40%] z-[44] -translate-x-1/2 -translate-y-1/2 text-center">
      <div className="turn-splash flex flex-col items-center">
        <span className="stroke-text whitespace-nowrap text-[4.2rem] font-bold leading-none text-[#7dff7a]">YOUR TURN!</span>
        <span className="stroke-text mt-1 whitespace-nowrap text-2xl font-bold text-white">
          Start with <span className="text-[#ffe23d]">{letter.toUpperCase()}</span> ✍️
        </span>
      </div>
    </div>
  )
}

/**
 * The moment's big news in the middle of the screen: someone ran out of time (and
 * got laughed at), or a long word earned its bonus. Ordinary words just pop into the chain.
 */
function Callout({ callout }) {
  let icon
  let label
  let detail
  let bg
  if (callout.kind === 'timeout') {
    icon = '⏰'
    label = 'TOO SLOW!'
    bg = 'from-[#ff6b6b] to-[#d4182c]'
    if (callout.hearts <= 0) detail = callout.mine ? 'That was your last heart!' : 'That was their last heart!'
    else if (callout.mine) detail = `They're laughing at you! 😳 −1 ❤️ · ${callout.hearts} left`
    else detail = `HAHA, too slow! 🤣 · ${callout.hearts} ❤️ left · new letter for you`
  } else if (callout.kind === 'shield') {
    icon = '🛡️'
    label = 'SAVED!'
    bg = 'from-[#5ad8ff] to-[#2a6bff]'
    detail = callout.mine ? 'Too slow, but your pet saved your heart!' : 'Their pet saved their heart · new letter for you'
  } else if (callout.bonus) {
    icon = '✨'
    label = 'BIG WORD!'
    bg = 'from-[#fff15c] to-[#ffb800]'
    detail = callout.mine
      ? `${callout.word.toUpperCase()} · +$${W.bonusCash}${callout.lucky ? ` · ⭐ +$${DATA.lucky.cash}` : ''}`
      : `They played ${callout.word.toUpperCase()}`
  } else if (callout.lucky) {
    icon = '⭐'
    label = 'LUCKY!'
    bg = 'from-[#fff15c] to-[#ffb800]'
    detail = `${callout.word.toUpperCase()} ends with the lucky letter · +$${DATA.lucky.cash}`
  } else {
    return null
  }
  return (
    <div className="callout-pos pointer-events-none absolute left-1/2 z-40 -translate-x-1/2">
      <div className="flex flex-col items-center gap-1">
        <div key={callout.until} className={`slam btn-3d flex items-center gap-2 bg-gradient-to-b px-4 py-1 ${bg}`}>
          <span className="text-[1.8rem] leading-none">{icon}</span>
          <span className="stroke-text text-[1.9rem] font-bold leading-none text-white">{label}</span>
        </div>
        <div className="stroke-thin text-center text-sm font-bold text-white">{detail}</div>
      </div>
    </div>
  )
}

/**
 * A soft glow around the screen's edges when you're too slow (red) or play a long
 * word (gold): a fade in and out, never a hard full-screen flash.
 */
function ScreenFlash() {
  const flash = useGame((s) => s.flash)
  useEffect(() => {
    if (!flash) return undefined
    const id = setTimeout(() => useGame.setState({ flash: null }), Math.max(0, flash.until - Date.now()))
    return () => clearTimeout(id)
  }, [flash])
  if (!flash) return null
  return (
    <div
      key={flash.at}
      className={`pointer-events-none absolute inset-0 z-[45] ${flash.kind === 'fail' ? 'flash-fail' : 'flash-golden'}`}
      style={{ animationDelay: `${flash.delay || 0}ms` }}
    />
  )
}

/** Quick phrases bought in the Emote Shop, said in a bubble over your head. */
function EmotePanel({ hiddenInPortrait }) {
  const owned = useGame((s) => s.profile?.ownedEmotes) || []
  const isOpen = useGame((s) => s.emotesOpen)
  const toggle = useGame((s) => s.toggleEmotes)

  return (
    <div
      className={`pointer-events-none absolute bottom-3 left-3 z-40 flex flex-col items-start gap-2 ${
        hiddenInPortrait ? 'portrait:hidden' : ''
      }`}
    >
      {isOpen && (
        <div className="ui-panel pop-in pointer-events-auto w-[15rem] p-2">
          <div className="game-scroll flex max-h-[min(30vh,14rem)] flex-col gap-1.5 overflow-y-auto pr-1">
            {owned.map((id) => {
              const e = emoteById(id)
              if (!e) return null
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    sfx.pop()
                    send({ t: 'emote', id })
                  }}
                  className="btn-3d press flex items-center justify-between bg-gradient-to-b from-[#fff35c] to-[#f2c200] px-2 py-1"
                >
                  <span className="stroke-thin truncate text-base font-bold text-white">
                    {e.label} {e.icon}
                  </span>
                  <span className="text-xs font-bold text-black/50">USE</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        className="btn-3d press pointer-events-auto bg-gradient-to-b from-[#3ee7ff] to-[#2a6bff] px-3 py-1.5 text-lg font-bold text-white"
      >
        <span className="stroke-text">Emotes 👀</span>
      </button>
    </div>
  )
}

/**
 * Alone at a table: waiting for a real player (anyone else waiting alone is
 * brought over by the server). WordBot only comes if the player taps for it, and
 * the button is gone while the tables are short (real players need the seats).
 */
function WaitingPanel({ match }) {
  return (
    <div className="pointer-events-none absolute bottom-[14%] left-1/2 z-30 flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col items-center gap-2">
      <span className="stroke-text whitespace-nowrap text-2xl font-bold text-white">Waiting for an opponent… (1/2)</span>
      <span className="stroke-thin text-center text-base font-bold text-white/90">
        {match.botAllowed ? `👀 Looking for a player · or practise with ${DATA.bot.name}` : '👀 Looking for a real player…'}
      </span>
      <div className="flex gap-2">
        {match.botAllowed && (
          <button
            type="button"
            onClick={() => {
              sfx.click()
              send({ t: 'bot' })
            }}
            className="btn-3d press pointer-events-auto bg-gradient-to-b from-[#c49bff] to-[#7b4dff] px-4 py-1.5 text-base font-bold text-white"
          >
            <span className="stroke-thin">🤖 Play {DATA.bot.name}</span>
          </button>
        )}
        <LeaveButton />
      </div>
    </div>
  )
}

const RESULT_TEXT = {
  win: {
    knockout: 'They ran out of hearts!',
    forfeit: 'They quit the duel!',
    afk: 'They fell asleep 😴',
  },
  lose: {
    knockout: 'Out of hearts. Think faster next time!',
    forfeit: 'You quit the duel',
    afk: 'Too slow, you were out of time',
  },
}

function ResultBanner() {
  const result = useGame((s) => s.result)
  const now = useNow(250)

  useEffect(() => {
    if (!result) return undefined
    const id = setTimeout(() => useGame.setState({ result: null }), Math.max(0, result.until - Date.now()))
    return () => clearTimeout(id)
  }, [result])

  if (!result || result.until < now) return null
  const reason = RESULT_TEXT[result.win ? 'win' : 'lose'][result.reason] || ''
  let reward = result.reward ? `+${money(result.reward)} ${result.win ? '💵' : 'for playing'}` : ''
  // A quitter's money changes hands: it is already in the winner's reward.
  if (result.penalty && result.win) reward = `+${money(result.reward)} 💵 (incl. their ${money(result.penalty)})`
  const lost = result.penalty && !result.win ? `−${money(result.penalty)}` : ''
  const title = result.win ? 'YOU WIN! 🏆' : result.reason === 'knockout' ? 'KNOCKED OUT! 💀' : 'YOU LOSE 😭'

  return (
    // While a quitter is being laughed at, the banner keeps clear of the players' heads.
    <Banner top={result.punished ? 'top-[7%]' : 'top-[26%]'}>
      <div className="pop-in flex flex-col items-center">
        <div
          className={`stroke-text text-[3.4rem] font-bold leading-none ${result.win ? 'text-[#ffe23d]' : 'text-[#ff4040]'}`}
        >
          {title}
        </div>
        <div className="stroke-text mt-2 text-2xl font-bold text-white">
          {reason}
          {reward && <span className="text-[#5cff5c]">{`  ·  ${reward}`}</span>}
          {lost && <span className="text-[#ff6b6b]">{`  ·  ${lost}`}</span>}
        </div>
        {result.practice && (
          <div className="stroke-thin mt-2 text-base font-bold text-[#d9c2ff]">
            🤖 Practice duel: half cash, no 🏆 win. Beat real players for wins!
          </div>
        )}
        {result.words > 0 && (
          <div className="ui-panel mt-3 flex items-center gap-3 px-3 py-1.5">
            <span className="stroke-thin text-sm font-bold text-white">🔗 {result.words} words</span>
            {result.longest && (
              <span className="stroke-thin text-sm font-bold text-white">
                📏 Longest: <span className="text-[#ffe23d]">{result.longest.toUpperCase()}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </Banner>
  )
}

/** Everything on screen while seated at a table: waiting, countdown, the duel. */
export function MatchUI() {
  const match = useGame((s) => s.match)
  const callout = useGame((s) => s.callout)
  const quitAsk = useGame((s) => s.quitAsk)
  const now = useNow(150)

  // A wood-block tick on each second of the "Starting in 3, 2, 1" countdown.
  const countdown = match?.phase === 'countdown' ? Math.max(1, secondsLeft(match.endsAt, now)) : 0
  useEffect(() => {
    if (countdown) sfx.tick()
  }, [countdown])

  const playing = match?.phase === 'playing'
  const showingResult = useGame((s) => Boolean(s.result))
  const calling = Boolean(match && callout && callout.until > now && !showingResult)
  const theirName = useGame((s) => (match?.opponent && s.players[match.opponent]?.name) || 'Opponent')
  const splash = useGame((s) => s.turnSplash)
  const splashing = playing && match.myTurn && splash && now >= splash.at && now < splash.until

  return (
    <>
      <ScreenFlash />
      {match && <EmotePanel hiddenInPortrait={playing} />}
      {match && (match.phase === 'countdown' || playing) && <DuelBar match={match} now={now} />}

      {match?.phase === 'waiting' && <WaitingPanel match={match} />}

      {match?.phase === 'countdown' && (
        <>
          <Banner>
            <span className="stroke-text text-[3.6rem] font-bold text-white">
              Starting in {Math.max(1, secondsLeft(match.endsAt, now))}
            </span>
          </Banner>
          <div className="pointer-events-none absolute bottom-[16%] left-1/2 z-30 -translate-x-1/2">
            <LeaveButton />
          </div>
        </>
      )}

      {/* The duel's last callout (the knockout's "TOO SLOW!") stays on screen into the result. */}
      {calling && (playing || match.phase === 'ended') && <Callout callout={callout} />}
      {playing && (
        <>
          {splashing && !calling && <TurnSplash key={splash.at} letter={match.letter} />}
          {match.myTurn && <WordPanel match={match} now={now} />}
          {match.theirTurn && <WatchPanel match={match} name={theirName} now={now} />}
          {/* Portrait: halfway down the right edge, clear of the chain and the word box. */}
          <div className="pointer-events-none absolute bottom-3 right-3 z-40 portrait:bottom-auto portrait:top-[42%]">
            <LeaveButton label="Quit duel" forfeit />
          </div>
        </>
      )}

      <ResultBanner />
      {quitAsk && playing && <QuitDialog />}
    </>
  )
}

export default MatchUI
