const assert = require('node:assert/strict')
const { test } = require('node:test')

const { loadDictionary, validateWord } = require('../src/game/words')

const none = new Set()

test('the dictionary is a Set with the ENABLE words in it', () => {
  const words = loadDictionary()
  assert.ok(words instanceof Set)
  assert.ok(words.size > 170000)
  for (const w of ['poodle', 'elephant', 'turtle', 'zyzzyvas']) assert.ok(words.has(w), w)
})

test('loading twice reads the files once', () => {
  assert.equal(loadDictionary(), loadDictionary())
})

test('a good word passes', () => {
  assert.equal(validateWord('elephant', 'e', none), null)
  assert.equal(validateWord('  Turtle ', 't', none), null)
})

test('letters only', () => {
  assert.match(validateWord('ice cream', 'i', none), /letters only/i)
  assert.match(validateWord('r2d2', 'r', none), /letters only/i)
  assert.match(validateWord('café', 'c', none), /letters only/i)
  assert.match(validateWord("can't", 'c', none), /letters only/i)
})

test('at least 3 letters', () => {
  assert.match(validateWord('ox', 'o', none), /at least 3/)
})

test('must start with the current letter', () => {
  assert.match(validateWord('turtle', 'e', none), /start with E/)
})

test('no repeats', () => {
  assert.match(validateWord('eagle', 'e', new Set(['eagle'])), /already used/)
})

test('must be a real word', () => {
  assert.match(validateWord('eeeeee', 'e', none), /not in the dictionary/)
})

test('profanity is out of the Set, plurals and listed inflections too', () => {
  const words = loadDictionary()
  for (const w of ['shit', 'shits', 'fuck', 'fucks', 'fucked', 'bitches', 'whore', 'whores']) {
    assert.ok(!words.has(w), w)
  }
  assert.match(validateWord('shit', 's', none), /not allowed/)
  // The refusal never repeats the word.
  assert.doesNotMatch(validateWord('shits', 's', none), /shit/i)
})

test('innocent words that share a prefix stay in', () => {
  for (const w of ['cocktail', 'title', 'therapist', 'grasshopper', 'class', 'spices']) {
    assert.equal(validateWord(w, w[0], none), null, w)
  }
})

test('junk input never throws', () => {
  for (const junk of [undefined, null, 42, {}, [], '', '   ']) {
    assert.equal(typeof validateWord(junk, 'a', none), 'string')
  }
  assert.match(validateWord('a'.repeat(500), 'a', none), /too long/)
})
