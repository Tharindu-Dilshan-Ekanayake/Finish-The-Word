const DATA = require('./data')

/**
 * Pets: hatched from eggs bought with cash, one equipped at a time. A pet follows
 * its owner around the plaza and brings its abilities to every duel:
 *   time    - extra seconds on each of your turns
 *   hints   - suggestions you can ask for, per duel
 *   shields - slaps blocked (no heart lost) when you run out of time, per duel
 *   cash    - % more cash from duel rewards
 */

const NONE = Object.freeze({ time: 0, hints: 0, shields: 0, cash: 0 })

const petById = (id) => DATA.pets.find((p) => p.id === id) || null
const eggById = (id) => DATA.eggs.find((e) => e.id === id) || null

/** The duel abilities of the pet a profile has equipped (all zero without one). */
function petAbility(profile) {
  const pet = petById(profile?.equippedPet)
  if (!pet) return NONE
  return { time: pet.time || 0, hints: pet.hints || 0, shields: pet.shields || 0, cash: pet.cash || 0 }
}

/** Which pet an egg hatches: weighted by its odds. `rand` is 0..1 (injectable for tests). */
function rollPet(egg, rand = Math.random()) {
  const total = egg.odds.reduce((sum, [, weight]) => sum + weight, 0)
  let r = rand * total
  for (const [id, weight] of egg.odds) {
    r -= weight
    if (r < 0) return id
  }
  return egg.odds[egg.odds.length - 1][0]
}

module.exports = { petById, eggById, petAbility, rollPet }
