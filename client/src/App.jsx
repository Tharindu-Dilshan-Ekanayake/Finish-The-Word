import { lazy, Suspense, useCallback, useEffect, useState } from 'react'

import { platform, popupAdLayout, setAdScreen, usePlatform } from './bloxity/platform'
import { useGame } from './net/gameStore'
import { renderStats } from './net/liveState'
import { useConnection } from './net/useConnection'
import Hatch from './ui/Hatch'
import HUD from './ui/HUD'
import InteractPrompt from './ui/InteractPrompt'
import LoadingScreen from './ui/LoadingScreen'
import MatchUI from './ui/MatchUI'
import Presence from './ui/Presence'
import Toasts from './ui/Toasts'
import { useTouch } from './ui/touch'
import TouchControls from './ui/TouchControls'

// The 3D scene (three, R3F, the world) is its own chunk so the loading screen paints
// first; the menus aren't needed until the player opens one.
const GameScene = lazy(() => import('./game/GameScene'))
const Modals = lazy(() => import('./ui/Modals'))

/** Bloxity's "Show FPS" setting. */
function FpsReadout() {
  const [fps, setFps] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFps(renderStats.fps), 500)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-50 -translate-x-1/2 rounded bg-black/50 px-2 py-0.5 font-mono text-xs text-white">
      {fps} FPS
    </div>
  )
}

/**
 * Ads only while a popup (menu window) is open: banners to its left, right and
 * below it. None while walking about, in a duel or on the results. A duel that
 * starts while a menu is open closes the menu, so the player sees it begin (and the
 * banners go with it). Re-checked on resize, which can change what fits.
 */
function usePopupAds() {
  const modal = useGame((s) => s.modal)
  const phase = useGame((s) => s.match?.phase)
  const dueling = phase === 'countdown' || phase === 'playing'
  const popup = Boolean(modal) && !dueling

  useEffect(() => {
    if (dueling && useGame.getState().modal) useGame.getState().closeModal()
  }, [dueling])

  useEffect(() => {
    if (!popup) {
      setAdScreen(null)
      return undefined
    }
    const apply = () => {
      const layout = popupAdLayout(window.innerWidth, window.innerHeight)
      setAdScreen(layout.any ? 'panel' : null, layout)
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [popup])
}

/** Esc closes an open menu; otherwise, inside Bloxity, it opens Bloxity's menu. */
function useEscapeMenu() {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || useGame.getState().modal) return
      if (usePlatform.getState().embedded) platform.showMenu()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function App() {
  useConnection()
  usePopupAds()
  useEscapeMenu()
  const [ready, setReady] = useState(false)
  const modal = useGame((s) => s.modal)
  const showFps = usePlatform((s) => s.showFps)
  const touch = useTouch((s) => s.touch)
  const onReady = useCallback(() => setReady(true), [])

  return (
    <div className="relative h-dvh w-screen select-none overflow-hidden bg-[#ffd9c0] font-game">
      <Suspense fallback={null}>
        <GameScene onReady={onReady} />
      </Suspense>

      <HUD />
      <MatchUI />
      <InteractPrompt />
      <Toasts />
      {touch && <TouchControls />}
      {showFps && <FpsReadout />}
      {modal && (
        <Suspense fallback={null}>
          <Modals />
        </Suspense>
      )}
      <Hatch />
      <Presence />
      {!ready && <LoadingScreen />}
    </div>
  )
}

export default App
