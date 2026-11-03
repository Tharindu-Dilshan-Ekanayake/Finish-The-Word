import { useEffect } from 'react'

import { sfx } from '../audio/sfx'
import { chipAction, lockInSlaps, randomDraft, tapChip } from '../game/chipActions'
import { CELLS, CHIPS, DATA, emoteById, titleById } from '../game/layout'
import { useGame } from '../net/gameStore'
import { bubbles } from '../net/liveState'
import { send } from '../net/api'
import { money, useNow } from './format'

const secondsLeft = (endsAt, now) => Math.max(0, Math.ceil((endsAt - now) / 1000))
const CELL_LIST = Array.from({ length: CELLS }, (_, i) => i)

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
 * your opponent and they slap you before you go. Esc or a tap outside keeps playing.
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
          and gets to slap you {DATA.forfeit.slaps} times before you go! 🖐️
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

/** ❤️❤️❤️ / ❤️❤️💔: one heart per slap hidden on the other plate. */
function Hearts({ hearts = CHIPS.hearts, className = '' }) {
  return (
    <span className={`whitespace-nowrap leading-none ${className}`}>
      {Array.from({ length: CHIPS.hearts }, (_, i) => (i < hearts ? '❤️' : '💔')).join('')}
    </span>
  )
}

/** What a duelist last said (an emote, "Crunch! 😋", "OUCH! 😵"), while it lasts. */
function speechOf(id, now) {
  const b = id ? bubbles.get(id) : null
  return b && b.text && b.until > now ? b.text : null
}

/**
 * One side of the VS bar: title, name, hearts, and a speech bubble underneath.
 * `turn`: 'active' (their go: glowing, with a TURN tab) or 'idle' (the other
 * player's go: faded), or null outside the eating phase.
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
          className={`speech pop-in max-w-full rounded-xl border-2 border-black/70 bg-white px-2 py-0.5 text-sm font-bold leading-snug text-[#1d2433] ${
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
 * Top of the screen during a duel: opponent | timer + what's happening | you. The
 * sides match where each player sits on screen (seat 0 is on the right of the duel
 * camera), and what each one says shows under their card instead of over their heads.
 */
function DuelBar({ match, now }) {
  const selfId = useGame((s) => s.selfId)
  const profile = useGame((s) => s.profile)
  const them = useGame((s) => (match.opponent ? s.players[match.opponent] : null))
  const self = { name: profile?.name || 'You', title: profile?.equippedTitle }

  const left = secondsLeft(match.endsAt, now)
  let status
  if (match.phase === 'countdown') status = 'GET READY'
  else if (match.phase === 'hiding') status = match.hidden ? 'WAITING…' : 'HIDE YOUR SLAPS'
  else if (match.myTurn) status = 'YOUR TURN'
  else if (match.pending) status = 'NOM NOM…'
  else status = 'THEIR TURN'

  // Whose go it is, on the cards themselves: glowing with a TURN tab, or faded.
  const eating = match.phase === 'eating'
  const myGo = eating && (match.myTurn || (match.pending && !match.theirTurn))
  const theirGo = eating && match.theirTurn
  const turnOf = (mine) => (!eating ? null : (mine ? myGo : theirGo) ? 'active' : 'idle')

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
    <div className="hud-top pointer-events-none absolute left-1/2 z-40 flex w-[min(94vw,36rem)] -translate-x-1/2 items-start gap-2">
      {match.seat === 0 ? theirCard : myCard}
      <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
        <div
          className={`btn-3d flex size-12 items-center justify-center text-xl font-bold text-white ${
            left <= 5 && match.phase !== 'countdown' ? 'bg-[#e53935]' : 'bg-[#2d6b78]'
          }`}
        >
          <span className="stroke-thin">{match.phase === 'countdown' ? 'VS' : left}</span>
        </div>
        <span
          className={`stroke-thin whitespace-nowrap rounded-md px-1.5 text-[0.7rem] font-bold text-white ${
            match.myTurn || (match.phase === 'hiding' && !match.hidden) ? 'bg-[#22c55e]' : 'bg-black/45'
          }`}
        >
          {status}
        </span>
      </div>
      {match.seat === 0 ? myCard : theirCard}
    </div>
  )
}

/**
 * One chip square of a pad. `state` is the plate character ('0' uneaten, '1' eaten,
 * '2' slap found, '3' golden eaten); `slap` shows a hidden slap (yours, or all of
 * theirs once the duel is over).
 */
function ChipCell({ state, slap, tappable, onTap, picked }) {
  let face
  if (state === '0') {
    face = (
      <span className={`chip-face ${tappable ? 'chip-bob' : ''} relative flex size-[82%] items-center justify-center`}>
        {(slap || picked) && <span className="text-[1.3rem] leading-none drop-shadow">🖐️</span>}
      </span>
    )
  } else if (state === '2') {
    face = <span className="flex size-[82%] items-center justify-center rounded-full bg-[#e8343c] text-[1.4rem]">🖐️</span>
  } else if (state === '3') {
    face = <span className="text-[1.4rem] leading-none">✨</span>
  } else {
    face = <span className="text-sm font-bold text-black/30">· ·</span>
  }
  return (
    <button
      type="button"
      disabled={!tappable}
      onClick={onTap}
      className={`chip-cell press flex items-center justify-center rounded-xl border-[3px] ${
        picked ? 'border-[#ffe23d] bg-[#ff6b6b]' : 'border-black/50 bg-[#fff3dc]'
      } ${tappable ? 'cursor-pointer hover:brightness-110' : 'cursor-default'}`}
    >
      {face}
    </button>
  )
}

/** A plate as a 3 x 3 pad, laid out the way the duel camera sees it on the table. */
function ChipPad({ match, plate, interactive }) {
  const draft = useGame((s) => s.draft)
  const mine = plate === match.seat
  const chips = mine ? match.myPlate : match.theirPlate
  const slaps = mine ? match.mySlaps : match.theirSlaps
  const hiding = mine && match.phase === 'hiding' && !match.hidden
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {CELL_LIST.map((c) => {
        const tappable = interactive && Boolean(chipAction(match.table, plate, c))
        return (
          <ChipCell
            key={c}
            state={chips[c] || '0'}
            slap={!hiding && slaps.includes(c)}
            picked={hiding && draft.includes(c)}
            tappable={tappable}
            onTap={() => tapChip(match.table, plate, c)}
          />
        )
      })}
    </div>
  )
}

function PadTimer({ match, now }) {
  const left = secondsLeft(match.endsAt, now)
  return (
    <span
      className={`btn-3d flex size-9 shrink-0 items-center justify-center text-base font-bold text-white ${
        left <= 5 ? 'bg-[#e53935]' : 'bg-[#2d6b78]'
      }`}
    >
      <span className="stroke-thin">{left}</span>
    </span>
  )
}

/** Hiding: pick DATA.chips.slaps chips on your own plate, then lock them in. */
function HidePanel({ match, now }) {
  const picked = useGame((s) => s.draft.length)
  const ready = picked === CHIPS.slaps
  return (
    <div className="chip-pad-pos ui-panel pop-in pointer-events-auto absolute z-30 flex w-max flex-col items-center gap-2 p-2.5">
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="stroke-text text-lg font-bold leading-tight text-white">Hide your slaps 🤫</span>
          <span className="text-xs font-bold text-white/75">
            Tap {CHIPS.slaps} of your chips · {picked}/{CHIPS.slaps}
          </span>
        </div>
        <PadTimer match={match} now={now} />
      </div>
      <ChipPad match={match} plate={match.seat} interactive />
      <div className="flex w-full gap-2">
        <button
          type="button"
          onClick={randomDraft}
          className="btn-3d press flex-1 bg-gradient-to-b from-[#c49bff] to-[#7b4dff] px-2 py-1.5 text-sm font-bold text-white"
        >
          <span className="stroke-thin">🎲 Random</span>
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={lockInSlaps}
          className="btn-3d press flex-1 bg-gradient-to-b from-[#5dff5d] to-[#22c522] px-2 py-1.5 text-sm font-bold text-white disabled:opacity-50"
        >
          <span className="stroke-thin">LOCK IN ✅</span>
        </button>
      </div>
    </div>
  )
}

/** Your turn: pick a chip from their plate. */
function EatPanel({ match, now }) {
  return (
    <div className="chip-pad-pos ui-panel my-turn-glow pop-in pointer-events-auto absolute z-30 flex w-max flex-col items-center gap-2 p-2.5">
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="stroke-text text-xl font-bold leading-tight text-[#7dff7a]">YOUR TURN! 😋</span>
          <span className="text-xs font-bold text-white/80">Pick a chip from their plate</span>
        </div>
        <PadTimer match={match} now={now} />
      </div>
      <ChipPad match={match} plate={1 - match.seat} interactive />
    </div>
  )
}

/** Their turn: your own plate, read-only, so you can watch them close in on your slaps. */
function WatchPanel({ match, name }) {
  return (
    <div className="chip-pad-pos ui-panel pointer-events-none absolute z-30 flex w-max scale-90 flex-col items-center gap-1.5 p-2 opacity-90">
      <span className="stroke-thin text-sm font-bold text-[#ffcf4a]">⏳ {name} is picking…</span>
      <span className="text-xs font-bold text-white/75">Your plate</span>
      <ChipPad match={match} plate={match.seat} interactive={false} />
    </div>
  )
}

/**
 * Whose turn it is, big and in the middle (in the reveal card's spot under the VS
 * bar, which only takes it while a bite is being revealed): a glowing green "YOUR
 * TURN" or a calm "⏳ Name's turn".
 */
function TurnPill({ mine, name }) {
  return (
    <div className="reveal-pos pointer-events-none absolute left-1/2 z-40 -translate-x-1/2">
      {mine ? (
        <div className="turn-pill-mine btn-3d flex items-center gap-2 bg-gradient-to-b from-[#5dff7a] to-[#18b84a] px-4 py-1.5">
          <span className="text-2xl leading-none">👉</span>
          <span className="stroke-text whitespace-nowrap text-[1.6rem] font-bold leading-none text-white">YOUR TURN</span>
          <span className="stroke-thin hidden whitespace-nowrap text-sm font-bold text-white/95 sm:inline">· pick a chip!</span>
        </div>
      ) : (
        <div className="ui-panel flex items-center gap-2 px-4 py-1.5">
          <span className="text-xl leading-none">⏳</span>
          <span className="stroke-thin max-w-[60vw] truncate whitespace-nowrap text-lg font-bold text-white">
            {name}’s turn
          </span>
          <span className="whitespace-nowrap text-xs font-bold text-white/70">· wait…</span>
        </div>
      )}
    </div>
  )
}

/** "YOUR TURN!" slammed across the middle of the screen as your turn begins. */
function TurnSplash() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-[40%] z-[44] -translate-x-1/2 -translate-y-1/2 text-center">
      <div className="turn-splash flex flex-col items-center">
        <span className="stroke-text whitespace-nowrap text-[4.2rem] font-bold leading-none text-[#7dff7a]">YOUR TURN!</span>
        <span className="stroke-text mt-1 whitespace-nowrap text-2xl font-bold text-white">Pick a chip 😋</span>
      </div>
    </div>
  )
}

const OUTCOME = {
  safe: { label: 'CRUNCH!', icon: '😋', bg: 'from-[#5dff7a] to-[#18b84a]' },
  slap: { label: 'SLAP!', icon: '🖐️', bg: 'from-[#ff6b6b] to-[#d4182c]' },
  golden: { label: 'GOLDEN!', icon: '✨', bg: 'from-[#fff15c] to-[#ffb800]' },
}

/** "2 slaps left" etc.: how many more slaps knock this player out. */
const slapsLeft = (hearts) => (hearts === 1 ? 'one more slap and you’re OUT!' : `${hearts} slaps left`)

function outcomeDetail(reveal) {
  const { mine, kind, hearts } = reveal
  if (!kind) return mine ? 'Crunch… or SLAP?' : 'They’re taking a bite…'
  if (kind === 'safe') return mine ? 'A safe chip. Phew!' : 'They found a safe chip'
  if (kind === 'slap') {
    if (hearts <= 0) return mine ? 'That was your last heart!' : 'That was their last heart!'
    return mine ? `You got slapped! −1 ❤️ · ${slapsLeft(hearts)}` : `You slapped them! 😈 · ${hearts} ❤️ left`
  }
  return mine ? `A golden chip! +$${CHIPS.goldenCash}` : 'They found a golden chip'
}

/**
 * The bite being decided, in the sky under the VS bar: a pulsing chip with a
 * drumroll, then the outcome slamming in. Both players see it, each from their side.
 */
function RevealCard({ reveal }) {
  const style = reveal.kind ? OUTCOME[reveal.kind] : null
  return (
    <div className="reveal-pos pointer-events-none absolute left-1/2 z-40 -translate-x-1/2">
      <div className="ui-panel pop-in flex items-center gap-3 px-3 py-2">
        <div className="flex flex-col items-center gap-1">
          <div className="stroke-thin whitespace-nowrap text-xs font-bold text-white/90">
            {reveal.mine ? 'You bite' : 'They bite'}
          </div>
          <div className={`chip-face size-14 ${reveal.kind ? '' : 'reveal-pulse'}`} />
        </div>
        <div className="flex min-w-[11rem] flex-col items-center gap-1.5">
          {style ? (
            <div key={reveal.kind} className={`slam btn-3d flex items-center gap-2 bg-gradient-to-b px-4 py-1 ${style.bg}`}>
              <span className="text-[1.8rem] leading-none">{style.icon}</span>
              <span className="stroke-text text-[1.9rem] font-bold leading-none text-white">{style.label}</span>
            </div>
          ) : (
            <div className="stroke-text text-[1.9rem] font-bold leading-none text-white">🥁 …</div>
          )}
          <div className="stroke-thin text-center text-sm font-bold text-white">{outcomeDetail(reveal)}</div>
        </div>
      </div>
    </div>
  )
}

/**
 * A soft glow around the screen's edges when you get slapped (red) or find the
 * golden chip (gold): a fade in and out, never a hard full-screen flash.
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
      className={`pointer-events-none absolute inset-0 z-[45] ${flash.kind === 'slap' ? 'flash-slap' : 'flash-golden'}`}
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

const RESULT_TEXT = {
  win: {
    slapped: `They bit all ${CHIPS.slaps} of your slaps!`,
    forfeit: 'They quit the duel!',
    afk: 'They fell asleep 😴',
  },
  lose: {
    slapped: `You bit all ${CHIPS.slaps} of their slaps!`,
    forfeit: 'You quit the duel',
    afk: 'Too slow — you were out of time',
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
  const played = result.reason === 'slapped'
  let reward = result.reward ? `+${money(result.reward)} ${result.win ? '💵' : 'for playing'}` : ''
  // A quitter's money changes hands: it is already in the winner's reward.
  if (result.penalty && result.win) reward = `+${money(result.reward)} 💵 (incl. their ${money(result.penalty)})`
  const lost = result.penalty && !result.win ? `−${money(result.penalty)}` : ''
  const title = result.win ? 'YOU WIN! 🏆' : result.reason === 'slapped' ? 'KNOCKED OUT! 💀' : 'YOU LOSE 😭'

  return (
    // While a quitter is being slapped, the banner keeps clear of the players' heads.
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
        {played && result.theirSlaps.length > 0 && (
          <div className="ui-panel mt-3 flex items-center gap-3 px-3 py-2">
            <span className="stroke-thin text-sm font-bold text-white">Their slaps were here:</span>
            <div className="grid grid-cols-3 gap-1">
              {CELL_LIST.map((c) => (
                <span
                  key={c}
                  className={`flex size-6 items-center justify-center rounded-md text-sm ${
                    result.theirSlaps.includes(c) ? 'bg-[#e8343c]' : 'bg-[#fff3dc]'
                  }`}
                >
                  {result.theirSlaps.includes(c) ? '🖐️' : ''}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Banner>
  )
}

/** Everything on screen while seated at a table: waiting, countdown, the duel. */
export function MatchUI() {
  const match = useGame((s) => s.match)
  const reveal = useGame((s) => s.reveal)
  const quitAsk = useGame((s) => s.quitAsk)
  const now = useNow(150)

  // A wood-block tick on each second of the "Starting in 3, 2, 1" countdown.
  const countdown = match?.phase === 'countdown' ? Math.max(1, secondsLeft(match.endsAt, now)) : 0
  useEffect(() => {
    if (countdown) sfx.tick()
  }, [countdown])

  // The result banner takes over from the last bite's card (never both at once).
  const showingResult = useGame((s) => Boolean(s.result))
  const revealing = Boolean(match && reveal && reveal.until > now && !showingResult)
  const hiding = match?.phase === 'hiding' && !match.hidden
  const biting = match?.phase === 'eating' && match.myTurn && !revealing
  const watching = match?.phase === 'eating' && !match.myTurn && !revealing
  const padOpen = hiding || biting
  const theirName = useGame((s) => (match?.opponent && s.players[match.opponent]?.name) || 'Opponent')
  const splash = useGame((s) => s.turnSplash)
  const splashing = biting && splash && now >= splash.at && now < splash.until

  return (
    <>
      <ScreenFlash />
      {match && <EmotePanel hiddenInPortrait={padOpen || watching} />}
      {match && ['countdown', 'hiding', 'eating'].includes(match.phase) && <DuelBar match={match} now={now} />}

      {match?.phase === 'waiting' && (
        <div className="pointer-events-none absolute bottom-[16%] left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
          <span className="stroke-text whitespace-nowrap text-2xl font-bold text-white">Waiting for an opponent… (1/2)</span>
          <LeaveButton />
        </div>
      )}

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

      {hiding && <HidePanel match={match} now={now} />}
      {match?.phase === 'hiding' && match.hidden && (
        <Banner top="top-[62%]">
          <span className="stroke-text text-2xl font-bold text-white">
            Slaps hidden! ✅ {match.opponentReady ? '' : 'Waiting for your opponent…'}
          </span>
        </Banner>
      )}

      {/* The duel's last bite stays on screen into the result. */}
      {revealing && (match.phase === 'eating' || match.phase === 'ended') && <RevealCard reveal={reveal} />}
      {match?.phase === 'eating' && (
        <>
          {(biting || (watching && match.theirTurn)) && <TurnPill mine={biting} name={theirName} />}
          {splashing && <TurnSplash key={splash.at} />}
          {biting && <EatPanel match={match} now={now} />}
          {watching && <WatchPanel match={match} name={theirName} />}
          <div className="pointer-events-none absolute bottom-3 right-3 z-40 portrait:bottom-auto portrait:top-[7.5rem]">
            <LeaveButton label="Quit duel" forfeit />
          </div>
        </>
      )}

      <ResultBanner />
      {quitAsk && match?.phase === 'eating' && <QuitDialog />}
    </>
  )
}

export default MatchUI
