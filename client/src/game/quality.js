import { create } from 'zustand'

import { usePlatform } from '../bloxity/platform'

/**
 * Graphics presets. Every visual feature reads one of these values before it
 * renders anything; LOW is the floor for low-end phones.
 *
 * maxFullAvatars - remote players drawn as full avatars (merged body: 1–4 draw
 *                  calls each; off-screen ones cost nothing), the nearest first,
 *                  out to fullDistance. Beyond that, or past the cap, they become
 *                  one instanced low-poly crowd.
 * maxPets        - pets drawn following their owners (nearest first; yours always).
 */
export const PRESETS = {
  low: {
    dpr: 1,
    shadows: false,
    shadowMapSize: 0,
    particles: false,
    maxFullAvatars: 6,
    fullDistance: 30,
    maxPets: 5,
    /** Name tags drawn at once (nearest players), and table signs (nearest tables). */
    maxNames: 8,
    maxTableSigns: 5,
    nameDistance: 24,
    labelDistance: 22,
    viewDistance: 140,
    clouds: 12,
    anisotropy: 4,
    blur: false,
  },
  medium: {
    dpr: [1, 1.5],
    shadows: true,
    shadowMapSize: 1024,
    particles: true,
    maxFullAvatars: 12,
    fullDistance: 45,
    maxPets: 12,
    maxNames: 14,
    maxTableSigns: 8,
    nameDistance: 32,
    labelDistance: 30,
    viewDistance: 260,
    clouds: 12,
    anisotropy: 4,
    blur: false,
  },
  high: {
    dpr: [1, 2],
    shadows: true,
    shadowMapSize: 2048,
    particles: true,
    maxFullAvatars: 18,
    fullDistance: 60,
    maxPets: 20,
    maxNames: 18,
    maxTableSigns: 12,
    nameDistance: 40,
    labelDistance: 38,
    viewDistance: 420,
    clouds: 18,
    anisotropy: 8,
    blur: true,
  },
}

const ORDER = ['low', 'medium', 'high']

/** Bloxity's graphics_quality setting ('Low' | 'Medium' | 'High' | 'Ultra'). */
const PLATFORM_PRESET = { Low: 'low', Medium: 'medium', High: 'high', Ultra: 'high' }

/**
 * The starting preset, from the device: phones, tablets and machines with 4 or
 * fewer cores start on LOW; other computers on MEDIUM (more players drawn as full
 * avatars, shadows), from which <PerformanceMonitor> drops them to LOW if FPS stays
 * under 45.
 */
function detectPreset() {
  if (typeof navigator === 'undefined') return 'low'
  const phoneOrTablet =
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.matchMedia?.('(pointer: coarse)').matches)
  const cores = navigator.hardwareConcurrency || 4
  return phoneOrTablet || cores <= 4 ? 'low' : 'medium'
}

/**
 * Starts on the detected preset. Bloxity's graphics_quality setting reports a value
 * straight away (its default is "High" for everyone), so only a change the player
 * makes in the Bloxity menu during the session moves the preset.
 */
export const useQuality = create((set, get) => ({
  preset: detectPreset(),

  /** Called by <PerformanceMonitor> when FPS stays under 45. */
  drop: () => {
    const i = ORDER.indexOf(get().preset)
    if (i > 0) set({ preset: ORDER[i - 1] })
  },
}))

let platformSettingSeen = false
usePlatform.subscribe((s, prev) => {
  if (s.graphics === prev.graphics) return
  // The first value is the stored/default one, not a choice made now.
  if (!platformSettingSeen) {
    platformSettingSeen = true
    return
  }
  const preset = PLATFORM_PRESET[s.graphics]
  if (preset) useQuality.setState({ preset })
})

export const useSettings = () => PRESETS[useQuality((s) => s.preset)]
/** Non-reactive read for useFrame loops. */
export const getSettings = () => PRESETS[useQuality.getState().preset]
