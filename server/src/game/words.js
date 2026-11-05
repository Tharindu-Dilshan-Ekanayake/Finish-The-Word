const fs = require('fs')
const path = require('path')

const DATA = require('./data')

/**
 * The dictionary every word in a duel is checked against. Server only: the client
 * never sees the list and its own checks are just for show.
 *
 *   data/words.txt            the ENABLE word list (one lowercase word per line)
 *   data/profanity.txt        LDNOOBW's English list (phrases in it are skipped)
 *   data/profanity-extra.txt  inflected forms that list misses
 *   data/common.txt           the 10,000 most common English words (no swears), for
 *                             the words WordBot plays and pets suggest: everyday
 *                             words, not ENABLE's obscure ones
 *
 * Loaded once into a Set at server start (see server.js): ~173k words, about 10 MB
 * of heap, and every lookup is O(1).
 */

const DATA_DIR = path.join(__dirname, '..', '..', 'data')
const WORD = /^[a-z]+$/
/** ENABLE's longest word has 28 letters. */
const MAX_LENGTH = 28
const MIN_LENGTH = DATA.words.minLength

/** @type {Set<string> | null} */
let dictionary = null
/** Words taken out of the dictionary, kept so a rejection can say why. */
let banned = null
/** first letter -> everyday words (in the dictionary, 3+ letters) starting with it. */
let commonByLetter = null

function readList(file) {
  return fs
    .readFileSync(path.join(DATA_DIR, file), 'utf8')
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith('#'))
}

const pluralOf = (w) => (/(s|x|z|ch|sh)$/.test(w) ? `${w}es` : `${w}s`)

/** Reads the word lists into memory. Safe to call again: only the first call reads. */
function loadDictionary() {
  if (dictionary) return dictionary
  const started = Date.now()

  const words = new Set()
  for (const w of readList('words.txt')) if (WORD.test(w)) words.add(w)

  banned = new Set()
  for (const w of [...readList('profanity.txt'), ...readList('profanity-extra.txt')]) {
    if (!WORD.test(w)) continue // multi-word phrases can't be typed here anyway
    banned.add(w)
    banned.add(pluralOf(w))
  }
  let removed = 0
  for (const w of banned) if (words.delete(w)) removed += 1

  commonByLetter = new Map()
  let common = 0
  for (const w of readList('common.txt')) {
    if (w.length < MIN_LENGTH || !words.has(w)) continue
    if (!commonByLetter.has(w[0])) commonByLetter.set(w[0], [])
    commonByLetter.get(w[0]).push(w)
    common += 1
  }

  dictionary = words
  console.log(`[words] ${words.size} words loaded, ${removed} blocked, ${common} everyday, in ${Date.now() - started} ms`)
  return dictionary
}

/**
 * An everyday word starting with `letter` that hasn't been used, `minLength` to
 * `maxLength` letters, or null when there is none. Tries a few at random before
 * scanning, so it stays cheap however long the duel gets. The default 4+ letters
 * skips the common list's odd short ones (abbreviations like "nam").
 */
function pickWord(letter, usedWords, { minLength = 4, maxLength = MAX_LENGTH } = {}) {
  loadDictionary()
  const list = commonByLetter.get(letter) || []
  const ok = (w) => w.length >= minLength && w.length <= maxLength && !usedWords.has(w)
  for (let k = 0; k < 12 && list.length; k += 1) {
    const w = list[Math.floor(Math.random() * list.length)]
    if (ok(w)) return w
  }
  return list.find(ok) || null
}

/** Lowercased and trimmed, as validateWord compares it. */
const normalise = (input) => (typeof input === 'string' ? input.trim().toLowerCase() : '')

/**
 * Checks one word for the chain. `currentLetter` is the letter it must start with
 * and `usedWords` a Set of the words already said this duel (lowercase).
 *
 * @returns {string | null} why the word is refused, shown to the player as is; null when it is good
 */
function validateWord(input, currentLetter, usedWords) {
  const words = loadDictionary()
  const word = normalise(input)
  const letter = String(currentLetter || '').toLowerCase()

  if (!word) return 'Type a word first'
  if (word.length > MAX_LENGTH) return 'That word is way too long'
  if (!WORD.test(word)) return 'Letters only: no spaces, numbers or symbols'
  if (word.length < MIN_LENGTH) return `Words need at least ${MIN_LENGTH} letters`
  if (word[0] !== letter) return `Your word must start with ${letter.toUpperCase()}`
  if (usedWords.has(word)) return `${word.toUpperCase()} was already used`
  // Never echo a blocked word back.
  if (banned.has(word)) return 'That word is not allowed 🙊'
  if (!words.has(word)) return `${word.toUpperCase()} is not in the dictionary`
  return null
}

module.exports = { loadDictionary, validateWord, normalise, pickWord, MAX_LENGTH }
