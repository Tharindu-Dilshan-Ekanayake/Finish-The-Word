import { create } from 'zustand'

/**
 * Event-driven game state for the UI: connection, room roster, tables, the local
 * player's match and profile. Updated by socket.js when messages arrive — never
 * from a frame loop. Server durations ("ends in N ms") are converted to local
 * deadlines on receipt so client clock skew can't matter.
 */

let toastId = 0

export const useGame = create((set, get) => ({
  /** 'connecting' | 'online' | 'offline' */
  status: 'connecting',
  selfId: null,
  roomId: null,
  capacity: 20,
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
  /** Duel outcome banner for this player: { win, reward, reason, theirSlaps, until }. */
  result: null,
  /**
   * The bite being revealed at this table: { mine, cell, kind, hearts, until }. `kind`
   * is null during the drumroll, then 'safe' | 'slap' | 'golden'; `hearts` is what
   * the biter has left.
   */
  reveal: null,
  /** Chips picked so far while hiding slaps (cells of your own plate), before locking in. */
  draft: [],
  /**
   * The big "YOUR TURN!" splash: { at, until } (epoch ms). It waits for the last
   * bite's reveal card to finish, so it appears just as you can pick a chip.
   */
  turnSplash: null,
  /** The "Quit the duel?" popup is open (only ever during the eating phase). */
  quitAsk: false,
  /** Full-screen flash for a slap / golden chip at your table: { kind, at, delay, until } (ms). */
  flash: null,
  /** Level-up celebration: { level, reward, title, until }. */
  levelUp: null,
  emotesOpen: true,

  openModal: (modal, shopTab) => set({ modal, ...(shopTab ? { shopTab } : {}) }),
  closeModal: () => set({ modal: null }),
  setShopTab: (shopTab) => set({ shopTab }),
  toggleEmotes: () => set({ emotesOpen: !get().emotesOpen }),

  /**
   * Picks or unpicks a chip to hide a slap in. Picking one more than allowed drops
   * the oldest pick, so a tap always does something.
   */
  toggleDraft: (cell, max) => {
    const draft = get().draft
    if (draft.includes(cell)) set({ draft: draft.filter((c) => c !== cell) })
    else set({ draft: [...(draft.length >= max ? draft.slice(1) : draft), cell] })
  },

  pushToast: (text) => {
    const id = ++toastId
    set({ toasts: [...get().toasts.slice(-3), { id, text }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3200)
  },
}))

export const isPlayingPhase = (phase) => phase === 'hiding' || phase === 'eating'
