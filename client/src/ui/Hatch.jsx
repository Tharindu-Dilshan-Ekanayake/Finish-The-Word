import { useEffect, useState } from 'react'

import { sfx } from '../audio/sfx'
import { eggById, petById, petPerks, RARITY_COLORS } from '../game/layout'
import { send } from '../net/api'
import { useGame } from '../net/gameStore'
import { money } from './format'

/** How long the egg shakes before it cracks open. */
const SHAKE_MS = 1700
const RARE = new Set(['epic', 'legendary', 'mythic'])

function close() {
  sfx.click()
  useGame.setState({ hatching: null })
}

/** One hatching, from the egg shaking to the pet popping out. Remounted per egg. */
function Hatching({ hatching }) {
  const [open, setOpen] = useState(false)
  const equipped = useGame((s) => s.profile?.equippedPet)
  const cash = useGame((s) => s.profile?.cash ?? 0)
  const egg = eggById(hatching.egg)
  const pet = petById(hatching.pet)

  useEffect(() => {
    sfx.drum()
    const id = setTimeout(() => {
      setOpen(true)
      if (RARE.has(pet?.rarity)) sfx.win()
      else sfx.reward()
    }, SHAKE_MS)
    return () => clearTimeout(id)
  }, [pet])

  if (!egg || !pet) return null
  const color = RARITY_COLORS[pet.rarity]

  return (
    // Hatching starts from the shop, so the popup's bottom banner may still be up.
    <div
      className="pointer-events-auto absolute inset-0 z-[65] flex items-center justify-center bg-black/65"
      style={{ paddingBottom: 'var(--ad-bottom, 0px)' }}
    >
      {!open ? (
        <div className="flex flex-col items-center gap-4">
          <span
            className="egg-shake egg-swatch block h-44 w-36 border-4 border-black"
            style={{ background: `radial-gradient(circle at 35% 28%, #fff8 0 12%, transparent 13%), ${egg.color}` }}
          />
          <span className="stroke-text text-3xl font-bold text-white">Hatching {egg.name}…</span>
        </div>
      ) : (
        <div className="pop-in flex w-[min(90vw,24rem)] flex-col items-center gap-2 text-center">
          <div className="relative flex size-44 items-center justify-center">
            <span className="hatch-burst absolute inset-0 rounded-full" style={{ '--burst': color }} />
            <span className="relative text-[6.5rem] leading-none drop-shadow-[0_0.3rem_0_rgba(0,0,0,0.35)]">{pet.icon}</span>
          </div>
          <span
            className="stroke-thin rounded px-2 py-0.5 text-sm font-bold uppercase text-white"
            style={{ background: color }}
          >
            {pet.rarity}
          </span>
          <span className="stroke-text text-[2.4rem] font-bold leading-none text-white">{pet.name}</span>
          <span className="stroke-text text-lg font-bold text-[#7dff7a]">
            {hatching.dup ? `Already yours! +${money(hatching.refund)} back` : 'NEW PET! 🎉'}
          </span>
          <div className="ui-panel flex w-full flex-col gap-0.5 px-3 py-2">
            {petPerks(pet).map((p) => (
              <span key={p} className="stroke-thin text-base font-bold text-white">
                {p}
              </span>
            ))}
          </div>
          <div className="mt-1 flex w-full gap-2">
            {!hatching.dup && equipped !== pet.id && (
              <button
                type="button"
                onClick={() => {
                  sfx.click()
                  send({ t: 'equip', kind: 'pet', id: pet.id })
                  useGame.setState({ hatching: null })
                }}
                className="btn-3d press flex-1 bg-gradient-to-b from-[#3ee7ff] to-[#2a6bff] px-2 py-2 text-base font-bold text-white"
              >
                <span className="stroke-thin">EQUIP</span>
              </button>
            )}
            <button
              type="button"
              disabled={cash < egg.price}
              onClick={() => {
                sfx.click()
                send({ t: 'buy', kind: 'egg', id: egg.id })
              }}
              className="btn-3d press flex-1 bg-gradient-to-b from-[#ffe94d] to-[#ff7a3d] px-2 py-2 text-base font-bold text-white disabled:opacity-50"
            >
              <span className="stroke-thin">AGAIN {money(egg.price)}</span>
            </button>
            <button
              type="button"
              autoFocus
              onClick={close}
              className="btn-3d press flex-1 bg-gradient-to-b from-[#5dff5d] to-[#22c522] px-2 py-2 text-base font-bold text-white"
            >
              <span className="stroke-thin">OK</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** The hatching screen, over everything else while an egg opens. */
export function Hatch() {
  const hatching = useGame((s) => s.hatching)
  if (!hatching) return null
  return <Hatching key={hatching.at} hatching={hatching} />
}

export default Hatch
