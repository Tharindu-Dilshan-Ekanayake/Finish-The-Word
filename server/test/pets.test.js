const assert = require('node:assert/strict')
const { test } = require('node:test')

const DATA = require('../src/game/data')
const { eggById, petAbility, petById, rollPet } = require('../src/game/pets')

test('every egg only hatches pets that exist', () => {
  for (const egg of DATA.eggs) {
    for (const [id] of egg.odds) assert.ok(petById(id), `${egg.id} -> ${id}`)
  }
})

test('rolls follow the odds, ends included', () => {
  const egg = eggById('beach')
  assert.equal(rollPet(egg, 0), egg.odds[0][0])
  assert.equal(rollPet(egg, 0.999999), egg.odds.at(-1)[0])
  const counts = {}
  for (let k = 0; k < 10000; k += 1) {
    const id = rollPet(egg, k / 10000)
    counts[id] = (counts[id] || 0) + 1
  }
  const total = egg.odds.reduce((s, [, w]) => s + w, 0)
  for (const [id, weight] of egg.odds) {
    assert.ok(Math.abs(counts[id] / 10000 - weight / total) < 0.002, id)
  }
})

test('abilities come from the equipped pet, nothing without one', () => {
  assert.deepEqual(petAbility(null), { time: 0, hints: 0, shields: 0, cash: 0 })
  assert.deepEqual(petAbility({ equippedPet: 'unicorn' }), { time: 3, hints: 2, shields: 1, cash: 25 })
  assert.deepEqual(petAbility({ equippedPet: 'nope' }), { time: 0, hints: 0, shields: 0, cash: 0 })
})
