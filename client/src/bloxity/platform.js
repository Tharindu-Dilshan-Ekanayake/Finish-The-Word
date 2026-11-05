import { create } from 'zustand'

import DATA from '../../../shared/gameData.json'
import { boxityEnv } from './env'
import { getSDK, safeCall, waitForSDK } from './sdk'

/**
 * The Bloxity integration, in one place: SDK init, the platform features this game
 * services (emotes, leaderboards), ad breaks, synced settings, player events, chat
 * and screen ads. BloxityProvider owns auth and avatar on top of this.
 *
 * Platform state the UI reacts to lives in `usePlatform`; gameplay code registers
 * handlers for platform events with `onPlatformEvent`.
 */

export const GAME_SLUG = import.meta.env.VITE_GAME_SLUG || DATA.bloxity.gameSlug

export const usePlatform = create(() => ({
  /** Running inside a Bloxity page: Bloxity draws login, menu, chat and emote UI. */
  embedded: false,
  /** An ad break is running: simulation paused and audio muted. */
  paused: false,
  /** Synced settings (see SETTINGS below). */
  showFps: false,
  chatEnabled: true,
  /** 'Low' | 'Medium' | 'High' | 'Ultra', or null until told. */
  graphics: null,
  cameraSensitivity: 1,
  masterVolume: 0.8,
  musicVolume: 0.6,
}))

/** @type {{ playEmote?: (id: string) => void, respawn?: () => void, chat?: (m: object) => void,
 *           breakStart?: () => void, breakEnd?: () => void }} */
const handlers = {}

/** Registers the game's handler for a platform event (one handler per event). */
export function onPlatformEvent(name, fn) {
  handlers[name] = fn
}

/**
 * Settings this game supports. Registering a listener also makes the control appear
 * in the Bloxity menu, so only keys the game really applies are listed.
 */
const SETTINGS = {
  master_volume: (v) => usePlatform.setState({ masterVolume: clamp01(Number(v) / 100, 0.8) }),
  music_volume: (v) => usePlatform.setState({ musicVolume: clamp01(Number(v) / 100, 0.6) }),
  graphics_quality: (v) => usePlatform.setState({ graphics: v || null }),
  show_fps: (v) => usePlatform.setState({ showFps: v === 'true' }),
  camera_sensitivity: (v) => {
    const n = Number(v)
    usePlatform.setState({ cameraSensitivity: Number.isFinite(n) && n > 0 ? Math.min(5, n) : 1 })
  },
  enable_chat: (v) => usePlatform.setState({ chatEnabled: v !== 'false' }),
}

const clamp01 = (n, fallback) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback)

let initPromise = null

/**
 * Waits for the SDK script, then initialises it exactly once (a module-level latch
 * survives React StrictMode's double mount) and wires every platform feature.
 * Resolves with the SDK.
 */
export function initPlatform(gameSlug = GAME_SLUG) {
  if (!initPromise) {
    initPromise = waitForSDK().then(async (sdk) => {
      // Dev server only (this branch is not in production builds): a standalone page
      // on localhost that was told no environment makes the SDK point itself at the
      // page's own origin, i.e. the Vite server, where login can never work. Telling
      // it the SDK's own default (prod) keeps login working. An embedded page is
      // left alone: the local portal's handshake tells it the environment.
      if (import.meta.env.DEV && !window.BLOXITY_ENV && window.self === window.top) {
        window.BLOXITY_ENV = sdk.environment()
      }

      await sdk.init({ gameSlug })

      // As soon as init resolves, not after assets load: the portal decides which
      // buttons to show as soon as the game is up.
      safeCall(() => sdk.game.registerFeature('emotes'))
      // Declares the boards (and shows Bloxity's trophy button). Scores are
      // submitted by the game server.
      safeCall(() => sdk.leaderboard.define(DATA.bloxity.leaderboards))

      usePlatform.setState({ embedded: Boolean(safeCall(() => sdk.portal.isEmbeddedInLegion())) })
      wireAds(sdk)
      wireSettings(sdk)
      wireEvents(sdk)
      wireChat(sdk)
      wireReservedAreas(sdk)
      return sdk
    })
    // A failed init shouldn't poison every later attempt (e.g. HMR reload).
    initPromise.catch(() => {
      initPromise = null
    })
  }
  return initPromise
}

/**
 * Banner ads only round a popup (a menu window): to its left, its right and below
 * it, on Bloxity's "panel" screen. Every other screen is declared ad-free, so
 * walking about, duelling and results never show a banner (see setAdScreen and
 * App's usePopupAds). Mid-roll breaks are the portal's to start; the game reports
 * gameplay as running the whole session (gameplayStart at load, gameplayEnd only
 * when the page closes) so none should come mid-game. If one does anyway, the game
 * pauses and mutes until it ends.
 */
const SIDE_SIZES = ['300x600', '160x600', '300x250']
const BOTTOM_SIZES = ['728x90', '320x50']
const AD_SCREENS = {
  menu: { show: false },
  lobby: { show: false },
  results: { show: false },
  gameplay: { show: false },
  panel: {
    show: true,
    slots: [
      { position: 'middle-left', sizes: SIDE_SIZES },
      { position: 'middle-right', sizes: SIDE_SIZES },
      { position: 'bottom-center', sizes: BOTTOM_SIZES },
    ],
  },
}

function wireAds(sdk) {
  safeCall(() => sdk.ads.declareScreens(AD_SCREENS))
  safeCall(() =>
    sdk.ads.onBreakStart(() => {
      usePlatform.setState({ paused: true })
      handlers.breakStart?.()
    }),
  )
  safeCall(() =>
    sdk.ads.onBreakEnd(() => {
      usePlatform.setState({ paused: false })
      handlers.breakEnd?.()
    }),
  )
}

function wireSettings(sdk) {
  for (const [key, apply] of Object.entries(SETTINGS)) {
    safeCall(() =>
      sdk.settings.listen(key, (value) => {
        // Outside Bloxity the game's own settings panel owns these (and the SDK
        // would only report its defaults, overwriting the player's saved choices).
        if (usePlatform.getState().embedded) apply(String(value ?? ''))
      }),
    )
  }
}

function wireEvents(sdk) {
  safeCall(() =>
    sdk.player.onEvent((event, data) => {
      if (event === 'play_emote' && typeof data === 'string') handlers.playEmote?.(data)
      else if (event === 'respawn_request') handlers.respawn?.()
    }),
  )
}

/** Chat bubbles: Bloxity draws the chat; the game shows messages over heads. */
function wireChat(sdk) {
  safeCall(() =>
    sdk.chat.onMessage((m) => {
      if (!usePlatform.getState().chatEnabled) return
      handlers.chat?.({
        userId: String(m.userId || '').replace(/^legion_/, ''),
        isLocalPlayer: Boolean(m.isLocalPlayer),
        text: sdk.chat.bubbleText(m),
        seconds: sdk.chat.bubbleSeconds || 4,
      })
    }),
  )
}

/** Margins (px) round our top-right bar: from the screen edge, and from Bloxity's areas. */
const BAR_EDGE = 12
const BAR_GAP = 8

/**
 * Where our top-right bar (❓, ⚙️, name card) goes, given Bloxity's reserved areas
 * ({ id: 'toolbar' | 'chat', left, top, width, height }, CSS px). It is as tall as
 * the toolbar's visible pill (the reported box has ~8 px of padding round it) and
 * tries, in order: beside the toolbar, centred on it; under the toolbar; under the
 * chat feed. It takes the first row with room for the whole bar on the right, so it
 * never covers anything Bloxity draws.
 *
 * `stacked` (portrait): the bar is a narrow column (name card over the buttons,
 * then cash/wins), so it needs less width but more height.
 */
export function placeTopBar(areas, width = window.innerWidth, buttons = 2, stacked = false) {
  const toolbar = areas.find((a) => a.id === 'toolbar' && a.width > 0)
  const h = toolbar ? Math.round(Math.min(48, Math.max(36, toolbar.height - 16))) : 44
  const need = stacked ? 200 : buttons * (h + 6) + 150
  const band = stacked ? 2 * h + 100 : h
  // Rightmost edge of anything Bloxity draws in the band [y, y + band].
  const blockedTo = (y) =>
    areas.reduce((x, a) => (a.top < y + band && a.top + a.height > y ? Math.max(x, a.left + a.width) : x), 0)

  const rows = [toolbar ? toolbar.top + (toolbar.height - h) / 2 : 8]
  for (const a of [...areas].sort((p, q) => p.top + p.height - (q.top + q.height))) rows.push(a.top + a.height + 6)
  for (const y of rows) {
    const room = width - BAR_EDGE - blockedTo(y) - (blockedTo(y) ? BAR_GAP : 0)
    if (room >= need) return { top: Math.max(0, Math.round(y)), h, maxWidth: Math.floor(room) }
  }
  const lowest = Math.max(0, ...areas.map((a) => a.top + a.height))
  return { top: Math.round(lowest + 6), h, maxWidth: width - 2 * BAR_EDGE }
}

/**
 * Bloxity's toolbar and chat feed take the top-left of the screen. The SDK reports
 * their rectangles and sets --boxity-ui-top itself. From them:
 *   --reserved-left-bottom        the left HUD column starts below anything on the left
 *   --bar-top / -h / -maxw        where our top-right bar goes (see placeTopBar)
 */
function wireReservedAreas(sdk) {
  let last = []
  const apply = () => {
    const root = document.documentElement.style
    // The SDK reports these areas even when the game runs on its own, where nothing
    // is drawn there: only keep clear of them inside Bloxity.
    const embedded = usePlatform.getState().embedded
    const areas = embedded ? last : []
    let bottom = 0
    for (const a of areas) if (a.left < window.innerWidth / 3) bottom = Math.max(bottom, a.top + a.height)
    root.setProperty('--reserved-left-bottom', `${Math.round(bottom)}px`)
    // Inside Bloxity there is no ⚙️ (Bloxity's ☰ has the settings): one button fewer.
    const portrait = window.innerHeight > window.innerWidth
    const bar = placeTopBar(areas, window.innerWidth, embedded ? 1 : 2, portrait)
    root.setProperty('--bar-top', `${bar.top}px`)
    root.setProperty('--bar-h', `${bar.h}px`)
    root.setProperty('--bar-maxw', `${bar.maxWidth}px`)
  }
  safeCall(() =>
    sdk.ui.onReservedAreasChange((areas) => {
      last = Array.isArray(areas) ? areas : []
      apply()
    }),
  )
  window.addEventListener('resize', apply)
  usePlatform.subscribe((s, prev) => {
    if (s.embedded !== prev.embedded) apply()
  })
}

/* ---- Calls the game makes into the platform ----------------------------------- */

const sdk = () => getSDK()

export const platform = {
  loadingStep: (label) => safeCall(() => sdk()?.game.loadingStep(label)),
  loadingEnd: () => safeCall(() => sdk()?.game.loadingEnd()),
  gameplayStart: () => safeCall(() => sdk()?.game.gameplayStart()),
  gameplayEnd: () => safeCall(() => sdk()?.game.gameplayEnd()),
  /** Joinable room id for friends and invites; '' when not in a room. */
  updateRoom: (roomId) => safeCall(() => sdk()?.game.updateRoom(roomId || '')),
  playerJoined: (username) => username && safeCall(() => sdk()?.game.playerJoined(username)),
  playerInRoom: (username) => username && safeCall(() => sdk()?.game.playerInRoom(username)),
  showMenu: () => safeCall(() => sdk()?.portal.showMenu(true)),
  token: () => safeCall(() => sdk()?.auth.getToken()) || null,
  guest: () => safeCall(() => sdk()?.auth.getGuest?.()) || null,

  /** Hosted multiplayer: ask the matchmaker which pod to join. */
  resolveEndpoint: (hostingId, opts) => sdk().net.resolveEndpoint(hostingId, opts),

  /** Custom-character data for an equipped set (null for the regular avatar). */
  characterFor: (equipped) =>
    Promise.resolve(safeCall(() => sdk()?.avatar.getCharacterFor?.(equipped))).catch(() => null),
  characterAccessoryMatrix: (character, bone) =>
    safeCall(() => sdk()?.avatar.characterAccessoryMatrix(character, bone)) || null,
}

/* ---- Screen ads ------------------------------------------------------------------ */

/** A menu window's width (Modals' Frame: min(94vw, 36rem)). */
const POPUP_W = 576
/** Gap (px) between a banner and the screen edge, and between a banner and the popup. */
const AD_GAP = 12
const ALL_POSITIONS = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']
const dims = (size) => size.split('x').map(Number)

/**
 * Which banners fit round a popup on a w×h (CSS px) screen: the biggest side banner
 * that fits between the screen edge and the popup, and a bottom banner that does not
 * run into the side ones. On a phone that is usually just the 320×50 below.
 * Returns the SDK's screen options ({ skip, sizes }) and `bottom`, the height (px)
 * the popup must keep clear at the bottom of the screen.
 */
export function popupAdLayout(w, h) {
  const room = (w - Math.min(0.94 * w, POPUP_W)) / 2 - 2 * AD_GAP
  const sides = SIDE_SIZES.filter((size) => {
    const [sw, sh] = dims(size)
    return sw <= room && sh + 2 * AD_GAP <= h
  })
  // The leaderboard banner only on screens tall enough to keep the popup roomy.
  const bottoms = BOTTOM_SIZES.filter((size) => {
    const [bw, bh] = dims(size)
    return bw + 2 * AD_GAP <= w && h >= (bh > 50 ? 540 : 340)
  })
  // A side banner (vertically centred) and the bottom one must not overlap.
  const clash = (side, bottom) => {
    const [sw, sh] = dims(side)
    const [bw, bh] = dims(bottom)
    return (w - bw) / 2 < AD_GAP + sw + AD_GAP && (h + sh) / 2 > h - AD_GAP - bh - AD_GAP
  }
  let side = null
  let bottom = null
  for (const s of [...sides, null]) {
    const b = bottoms.find((size) => !s || !clash(s, size)) || null
    if (s || b) {
      side = s
      bottom = b
      break
    }
  }

  const used = []
  const sizes = {}
  if (side) {
    used.push('middle-left', 'middle-right')
    sizes['middle-left'] = side
    sizes['middle-right'] = side
  }
  if (bottom) {
    used.push('bottom-center')
    sizes['bottom-center'] = bottom
  }
  return {
    options: { skip: ALL_POSITIONS.filter((p) => !used.includes(p)), sizes },
    bottom: bottom ? dims(bottom)[1] + 2 * AD_GAP : 0,
    any: used.length > 0,
  }
}

let screen = null
let screenKey = ''

/** Space (px) menus keep clear at the bottom of the screen for the banner there. */
function reserveBottom(px) {
  document.documentElement.style.setProperty('--ad-bottom', `${px}px`)
}

/**
 * Tells Bloxity which screen is showing so it can place banners round it, or null to
 * take every banner down (which also hides any Bloxity put up by itself). Outside
 * Bloxity the SDK sends nothing and nothing is reserved.
 * @param {string|null} type  'panel' while a popup is open, otherwise null
 * @param {{ options?: object, bottom?: number }} [layout]  from popupAdLayout
 */
export function setAdScreen(type, layout = {}) {
  const key = type ? `${type}:${JSON.stringify(layout.options || {})}` : ''
  // null always goes through: it hides banners the portal may have shown by itself.
  if (type && key === screenKey) return
  screenKey = key
  const s = sdk()
  if (!s?.ads?.screen) return
  if (!type) {
    safeCall(() => screen?.hide())
    safeCall(() => s.ads.hideScreen?.())
    screen = null
    reserveBottom(0)
    return
  }
  const shown = safeCall(() => s.ads.screen(type, layout.options || {})) || null
  screen = shown
  // 'closed' straight away: not embedded, or the portal does no screen ads.
  const live = Boolean(shown) && shown.state !== 'closed'
  reserveBottom(live ? layout.bottom || 0 : 0)
  safeCall(() =>
    shown?.onStateChange((state) => {
      if (state === 'closed' && screen === shown) reserveBottom(0)
    }),
  )
}

/* ---- Emote catalogue ---------------------------------------------------------- */

let emoteCatalog = null

/**
 * Bloxity emotes by id: { id, name, clip: { len, loop, tracks } }. Fetched once.
 * @returns {Promise<Map<string, object>>}
 */
export function loadEmoteCatalog() {
  if (!emoteCatalog) {
    emoteCatalog = fetch(`${boxityEnv().apiUrl}/v1/avatar/emotes`)
      .then((r) => (r.ok ? r.json() : { emotes: [] }))
      .then((body) => {
        const list = Array.isArray(body) ? body : body.emotes || []
        return new Map(list.filter((e) => e?.id && e.clip?.tracks).map((e) => [e.id, e]))
      })
      .catch(() => {
        emoteCatalog = null
        return new Map()
      })
  }
  return emoteCatalog
}

