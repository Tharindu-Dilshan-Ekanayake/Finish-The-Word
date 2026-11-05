import { useEffect, useState } from 'react'

import { sfx } from '../audio/sfx'
import { DATA } from '../game/layout'
import { findBusierRoom, moveToRoom, retryConnection, send } from '../net/api'
import { useGame } from '../net/gameStore'
import { useNow } from './format'

/** How often a player in a quiet room looks for a busier one. */
const LOOK_EVERY_MS = 20000

/**
 * Away a while: "Are you still there?" with the seconds left before the server
 * gives their slot to someone else. Any tap or key anywhere answers it (see
 * socket.noteActivity); the button is the obvious way.
 */
function AfkWarning({ until }) {
  const now = useNow(250)
  const left = Math.max(0, Math.ceil((until - now) / 1000))
  return (
    <div className="pointer-events-auto absolute inset-0 z-[66] flex items-center justify-center bg-black/45">
      <div role="alertdialog" aria-labelledby="afk-title" className="ui-panel pop-in flex w-[min(90vw,22rem)] flex-col items-center gap-2 px-5 py-4 text-center">
        <div className="text-[2.6rem] leading-none">👀</div>
        <h2 id="afk-title" className="stroke-text text-[1.7rem] font-bold leading-tight text-white">
          Are you still there?
        </h2>
        <p className="text-sm font-semibold leading-snug text-white/85">
          You&apos;ll leave the lobby in <span className="font-bold text-[#ffe23d]">{left}s</span> so someone else can play.
        </p>
        <button
          type="button"
          autoFocus
          onClick={() => {
            sfx.click()
            send({ t: 'active' })
            useGame.setState({ afkWarn: null })
          }}
          className="btn-3d press mt-1 w-full bg-gradient-to-b from-[#5dff5d] to-[#22c522] px-3 py-2 text-lg font-bold text-white"
        >
          <span className="stroke-thin">I&apos;M HERE! ✋</span>
        </button>
      </div>
    </div>
  )
}

/** Removed for being away: their slot went to someone else. One tap to play again. */
function AwayScreen() {
  return (
    <div className="pointer-events-auto absolute inset-0 z-[66] flex items-center justify-center bg-black/60">
      <div className="ui-panel pop-in flex w-[min(90vw,24rem)] flex-col items-center gap-2 px-5 py-4 text-center">
        <div className="text-[2.8rem] leading-none">💤</div>
        <h2 className="stroke-text text-[1.8rem] font-bold leading-tight text-white">You were away</h2>
        <p className="text-sm font-semibold leading-snug text-white/85">
          After {Math.round(DATA.afk.kickSec / 6) / 10} minutes without playing you left the lobby, so someone else could
          join. Your cash and items are saved.
        </p>
        <button
          type="button"
          autoFocus
          onClick={() => {
            sfx.click()
            retryConnection()
          }}
          className="btn-3d press mt-1 w-full bg-gradient-to-b from-[#5dff5d] to-[#22c522] px-3 py-2 text-lg font-bold text-white"
        >
          <span className="stroke-thin">PLAY AGAIN ▶</span>
        </button>
      </div>
    </div>
  )
}

/**
 * In a quiet room while another has players: "👥 12 players in another lobby ·
 * JOIN". Checked every LOOK_EVERY_MS, only while walking around (never mid-duel).
 */
function BusierLobbyOffer() {
  const online = useGame((s) => s.status === 'online')
  const seated = useGame((s) => Boolean(s.match))
  const roomId = useGame((s) => s.roomId)
  const [offer, setOffer] = useState(null)
  const [dismissed, setDismissed] = useState(null)

  useEffect(() => {
    if (!online || seated) return undefined
    let cancelled = false
    const look = () =>
      findBusierRoom().then((found) => {
        if (!cancelled) setOffer(found)
      })
    const first = setTimeout(look, 4000)
    const id = setInterval(look, LOOK_EVERY_MS)
    return () => {
      cancelled = true
      clearTimeout(first)
      clearInterval(id)
    }
  }, [online, seated, roomId])

  if (!offer || seated || !online || dismissed === offer.roomId || offer.roomId === roomId) return null
  return (
    <div className="lobby-offer-pos pointer-events-none absolute left-1/2 z-30 -translate-x-1/2">
      <div className="ui-panel pop-in pointer-events-auto flex items-center gap-2 py-1.5 pl-3 pr-1.5 text-white">
        <span className="stroke-thin whitespace-nowrap text-sm font-bold">👥 {offer.players} players in another lobby</span>
        <button
          type="button"
          onClick={() => {
            sfx.click()
            moveToRoom(offer)
            setOffer(null)
          }}
          className="btn-3d press bg-gradient-to-b from-[#5dff5d] to-[#22c522] px-3 py-1 text-sm font-bold"
        >
          <span className="stroke-thin">JOIN</span>
        </button>
        <button
          type="button"
          aria-label="No thanks"
          onClick={() => {
            sfx.click()
            setDismissed(offer.roomId)
          }}
          className="px-1 text-base font-bold text-white/70"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

/** Being here: the AFK warning, the "you were away" screen and the busier-lobby offer. */
export function Presence() {
  const status = useGame((s) => s.status)
  const afkWarn = useGame((s) => s.afkWarn)
  return (
    <>
      <BusierLobbyOffer />
      {afkWarn && status === 'online' && <AfkWarning until={afkWarn.until} />}
      {status === 'away' && <AwayScreen />}
    </>
  )
}

export default Presence
