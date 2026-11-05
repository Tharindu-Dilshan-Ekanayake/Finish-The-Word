import { create } from 'zustand'

/**
 * Event-driven game state for the UI: connection, room roster, tables, the local
 * player's match and profile. Updated by socket.js when messages arrive — never
 * from a frame loop. Server durations ("ends in N ms") are converted to local
 * deadlines on receipt so client clock skew can't matter.
 */

let toastId = 0

export const useGame = create((set, get) => ({
  /** 'connecting' | 'online' | 'offline' | 'failed' | 'away' (removed for being AFK) */
  status: 'connecting',
  /** "Are you still there?": { until } (epoch ms) when this player will be removed for being away. */
  afkWarn: null,
  selfId: null,
  roomId: null,
  capacity: 30,
  /** id -> { id, name, streak, equipped, proportions } */
  players: {},
  /** id -> public table state + `endsAt` */
  tables: {},
  /** This player's private match state + `endsAt`, or null when not seated. */
  match: null,
  /** Owner's profile view + `giftAt` / `questResetAt` deadlines. */
  profile: null,
  lb: { streaks: [], wins: [], levels: [], playtime: [] },
  toasts: [],
  /** null | 'shop' | 'items' | 'rewards' | 'quests' | 'help' | 'settings' */
  modal: null,
  shopTab: 'chairs',
  /** Duel outcome banner for this player: { win, reward, reason, words, longest, until }. */
  result: null,
  /** Why the server refused your last word: { reason, at }. */
  wordError: null,
  /** Your pet's suggestion for this turn: { word }. */
  hint: null,
  /** Words you added to your Word Book this duel (shown with a NEW tag in the chain). */
  freshWords: [],
  /** An egg being hatched, for the hatching screen: { egg, pet, dup, refund, at }. */
  hatching: null,
  /** How many letters your opponent has typed on their turn: { n, at }. */
  oppTyping: null,
  /**
   * The last thing that happened in your duel, for the callout under the VS bar:
   * { kind: 'word' | 'timeout' | 'shield', mine, word?, bonus?, lucky?, hearts?, until }.
   */
  callout: null,
  /** The big "YOUR TURN!" splash: { at, until } (epoch ms). */
  turnSplash: null,
  /** The "Quit the duel?" popup is open (only ever during the playing phase). */
  quitAsk: false,
  /** Edge flash when you're too slow ('fail') or play a big word ('golden'): { kind, at, delay, until } (ms). */
  flash: null,
  /** Level-up celebration: { level, reward, title, until }. */
  levelUp: null,
  emotesOpen: true,

  openModal: (modal, shopTab) => set({ modal, ...(shopTab ? { shopTab } : {}) }),
  closeModal: () => set({ modal: null }),
  setShopTab: (shopTab) => set({ shopTab }),
  toggleEmotes: () => set({ emotesOpen: !get().emotesOpen }),

  pushToast: (text) => {
    const id = ++toastId
    set({ toasts: [...get().toasts.slice(-3), { id, text }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3200)
  },
}))

export const isPlayingPhase = (phase) => phase === 'playing'
