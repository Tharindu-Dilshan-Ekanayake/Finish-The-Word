import { sfx } from '../audio/sfx'
import { send } from '../net/api'
import { useGame } from '../net/gameStore'
import { CHIPS } from './layout'

/**
 * What tapping chip `cell` of seat `plate`'s plate at table `tableId` would do for
 * the local player right now: 'hide' (pick it to hide a slap in), 'eat', or null.
 * Shared by the 3D chips and the on-screen pads so both always agree.
 */
export function chipAction(tableId, plate, cell, state = useGame.getState()) {
  const { match, reveal } = state
  if (!match || match.table !== tableId) return null
  if (match.phase === 'hiding' && !match.hidden && plate === match.seat) return 'hide'
  if (match.phase !== 'eating' || !match.myTurn || plate !== 1 - match.seat) return null
  // A bite is already on its way to the server.
  if (reveal && !reveal.kind && reveal.until > Date.now()) return null
  return match.theirPlate[cell] === '0' ? 'eat' : null
}

/** Does what chipAction says. Returns true if the tap did something. */
export function tapChip(tableId, plate, cell) {
  const state = useGame.getState()
  const action = chipAction(tableId, plate, cell, state)
  if (action === 'hide') {
    sfx.pop()
    state.toggleDraft(cell, CHIPS.slaps)
    return true
  }
  if (action === 'eat') {
    sfx.click()
    // Shown at once (lifted chip, drumroll card); the server's 'bite' confirms it.
    useGame.setState({ reveal: { mine: true, cell, kind: null, gain: null, until: Date.now() + 1500 } })
    send({ t: 'eat', cell })
    return true
  }
  return false
}

/** Locks in the picked chips (exactly DATA.chips.slaps of them). */
export function lockInSlaps() {
  const { draft } = useGame.getState()
  if (draft.length !== CHIPS.slaps) return
  sfx.click()
  send({ t: 'hide', cells: [...draft] })
}

/** Picks random chips for you to hide slaps in (you still lock them in). */
export function randomDraft() {
  const cells = Array.from({ length: CHIPS.cols * CHIPS.rows }, (_, i) => i)
  for (let i = cells.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[cells[i], cells[j]] = [cells[j], cells[i]]
  }
  sfx.pop()
  useGame.setState({ draft: cells.slice(0, CHIPS.slaps) })
}
