import { useFrame } from '@react-three/fiber'
import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  BufferAttribute,
  CanvasTexture,
  Color,
  InstancedBufferAttribute,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three'

import { DEFAULT_PROPORTIONS } from '../bloxity/store'
import { useGame } from '../net/gameStore'
import { actionFx, avatarAnchors, localPlayer, remoteEmotes, remotes, remoteSeats } from '../net/liveState'
import { mergedBoxes } from './instancing'
import Nametag from './Nametag'
import { DATA, FLOOR, PLAYER_HEIGHT } from './layout'
import PlayerAvatar from './PlayerAvatar'
import { getSettings } from './quality'
import { skipWhenHidden } from './sceneGraph'
import { clearSeatPose, poseAtSeat } from './seatPose'
import { useDisposable } from './useDisposable'

/** One snapshot interval: interpolation always runs one packet behind. */
const INTERP_S = 0.1
const MAX_PLAYERS = DATA.roomSize

/**
 * Impostors: far players are drawn as a picture of their own avatar instead of a
 * blocky stand-in. Each remote avatar is photographed from the front and from the
 * back into two 64 x 128 slots of one shared 1024 x 512 texture (2 MB), and drawn as
 * a camera-facing quad: all of them in one draw call.
 */
const SLOT_W = 64
const SLOT_H = 128
const COLS = 16
const ROWS = 4
/** Front + back per player: room for 32 players. */
const PAIRS = (COLS * ROWS) / 2
/** The snapshot camera sees only what is on this layer: the avatar being photographed, and the lights. */
const CAPTURE_LAYER = 7
/** Frames an avatar is drawn in full before its photo, so it is posed and measured. */
const POSE_FRAMES = 3
/** Snapshot after an avatar has loaded, and again after a change of outfit. */
const CAPTURE_AFTER_LOAD_MS = 400
const CAPTURE_AFTER_CHANGE_MS = 2500
/** The blocky stand-in's head reaches this high (at height 1): its name goes above. */
const PROXY_TOP = 2.11
/** A regular avatar's height, the least the snapshot frames. */
const MIN_TOP = 1.8
/** How much lower a seated player's head is than a standing one's. */
const SEATED_SINK = 0.5

/** id -> { group, visual, full, headTop, imp, active, dist, ... } */
const registry = new Map()
const ordered = []
const byDistance = (a, b) => a.dist - b.dist
/** Snapshot slot pairs: which player has which, and the free ones. */
const pairOf = new Map()
const freePairs = Array.from({ length: PAIRS }, (_, i) => PAIRS - 1 - i)

const _obj = new Object3D()
const _color = new Color()
const _pos = new Vector3()
const _fwd = new Vector3()
const _center = new Vector3()
const _clear = new Color()

function lerpAngle(a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/** Stable pastel per player id for the crowd stand-ins (until their photo is taken). */
function idColor(id) {
  let h = 0
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return _color.setHSL((h % 360) / 360, 0.55, 0.62)
}

/** Blocky stand-in figure with per-part shading baked into vertex colours. */
function createProxyGeometry() {
  const parts = [
    { size: [0.36, 0.8, 0.4], at: [-0.2, 0.4, 0], shade: 0.45 },
    { size: [0.36, 0.8, 0.4], at: [0.2, 0.4, 0], shade: 0.45 },
    { size: [0.8, 0.8, 0.42], at: [0, 1.2, 0], shade: 0.9 },
    { size: [0.3, 0.8, 0.36], at: [-0.56, 1.2, 0], shade: 0.75 },
    { size: [0.3, 0.8, 0.36], at: [0.56, 1.2, 0], shade: 0.75 },
    { size: [0.5, 0.5, 0.5], at: [0, 1.86, 0], shade: 1 },
  ]
  const geometry = mergedBoxes(parts)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  // mergedBoxes keeps part order and a BoxGeometry has 24 vertices.
  parts.forEach((part, i) => {
    for (let v = i * 24; v < (i + 1) * 24; v += 1) colors.fill(part.shade, v * 3, v * 3 + 3)
  })
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

function createBlobTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(0,0,0,0.45)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new CanvasTexture(canvas)
}

/** A quad standing on its bottom edge, sampling one atlas slot per instance (`slotOffset`). */
function createImpostorMaterial(texture) {
  const material = new MeshBasicMaterial({ map: texture, alphaTest: 0.5 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.slotScale = { value: new Vector2(1 / COLS, 1 / ROWS) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 slotOffset;\nuniform vec2 slotScale;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vMapUv * slotScale + slotOffset;')
  }
  material.customProgramCacheKey = () => 'avatar-impostor'
  return material
}

function releasePair(id) {
  const k = pairOf.get(id)
  if (k === undefined) return
  pairOf.delete(id)
  freePairs.push(k)
}

function pairFor(id) {
  if (pairOf.has(id)) return pairOf.get(id)
  const k = freePairs.pop()
  if (k === undefined) return -1
  pairOf.set(id, k)
  return k
}

/**
 * Photographs entry `e`'s avatar from the front and the back into its two atlas
 * slots, with an orthographic camera that sees only the capture layer.
 */
function capture(gl, scene, res, e) {
  const k = pairFor(e.id)
  if (k < 0) return
  const height = Math.max(MIN_TOP, e.headTop.y || 0) * 1.05 + 0.05
  const width = height * (SLOT_W / SLOT_H)
  const cam = res.camera
  cam.left = -width / 2
  cam.right = width / 2
  cam.top = height / 2
  cam.bottom = -height / 2
  cam.near = 0.1
  cam.far = 30
  cam.updateProjectionMatrix()
  cam.layers.set(CAPTURE_LAYER)

  e.full.traverse((o) => o.layers.enable(CAPTURE_LAYER))
  scene.traverse((o) => {
    if (o.isLight) o.layers.enable(CAPTURE_LAYER)
  })
  e.group.updateMatrixWorld(true)
  e.group.getWorldPosition(_center)
  _center.y += height / 2
  // The way they face (the avatar faces its group's +Z).
  e.visual.getWorldDirection(_fwd)
  _fwd.y = 0
  if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1)
  _fwd.normalize()

  const previousTarget = gl.getRenderTarget()
  gl.getClearColor(_clear)
  const previousAlpha = gl.getClearAlpha()
  const shadows = gl.shadowMap.autoUpdate
  gl.shadowMap.autoUpdate = false
  for (const back of [0, 1]) {
    const slot = k * 2 + back
    const x = (slot % COLS) * SLOT_W
    const y = Math.floor(slot / COLS) * SLOT_H
    res.target.viewport.set(x, y, SLOT_W, SLOT_H)
    res.target.scissor.set(x, y, SLOT_W, SLOT_H)
    res.target.scissorTest = true
    cam.position.copy(_center).addScaledVector(_fwd, back ? -10 : 10)
    cam.lookAt(_center)
    cam.updateMatrixWorld()
    gl.setRenderTarget(res.target)
    gl.setClearColor(0x000000, 0)
    gl.clear(true, true, false)
    gl.render(scene, cam)
  }
  gl.setRenderTarget(previousTarget)
  gl.setClearColor(_clear, previousAlpha)
  gl.shadowMap.autoUpdate = shadows
  e.full.traverse((o) => o.layers.disable(CAPTURE_LAYER))
  e.imp.height = height
  e.imp.width = width
  e.imp.ready = true
}

const RemotePlayer = memo(function RemotePlayer({ meta }) {
  const { id } = meta
  const groupRef = useRef(null)
  const visualRef = useRef(null)
  const fullRef = useRef(null)
  const tagRef = useRef(null)
  /** Set by RemotePlayers each frame: is this one of the nearest few whose tag shows? */
  const [tagGate] = useState(() => ({ show: true }))
  /**
   * Top of their head, so the name sits above it: measured by PlayerAvatar while
   * their full avatar is drawn, set by RemotePlayers to the photo's or the stand-in's
   * top otherwise.
   */
  const [headTop] = useState(() => ({ y: 0 }))
  // Offset idle animations so a seated crowd doesn't breathe in unison.
  const motionRef = useRef({ time: id.length * 1.7, speed: 0, grounded: true, maxSpeed: 7, seated: false })
  const heightScale = meta.proportions?.height ?? 1

  useLayoutEffect(() => {
    const entry = {
      group: groupRef.current,
      visual: visualRef.current,
      full: fullRef.current,
      headTop,
      /** The photo: requested at `captureAt` (ms), posed for `poseFrames`, `ready` once taken. */
      imp: { captureAt: 0, poseFrames: 0, ready: false, height: 0, width: 0 },
      heightScale: 1,
      active: false,
      dist: 0,
      id,
      tagGate,
    }
    // Hidden avatars (no data yet, or drawn far away as a photo) cost nothing.
    skipWhenHidden(groupRef.current)
    skipWhenHidden(fullRef.current)
    registry.set(id, entry)
    avatarAnchors.set(id, visualRef.current)
    return () => {
      registry.delete(id)
      avatarAnchors.delete(id)
      releasePair(id)
    }
  }, [id, tagGate, headTop])

  /** Asks for a (new) photo of this avatar in `ms`. */
  const requestCapture = useCallback(
    (ms) => {
      const e = registry.get(id)
      if (e) e.imp.captureAt = performance.now() + ms
    },
    [id],
  )
  const onAvatarReady = useCallback(() => requestCapture(CAPTURE_AFTER_LOAD_MS), [requestCapture])
  // A new outfit or new proportions: photograph it again once it has loaded.
  useEffect(() => requestCapture(CAPTURE_AFTER_CHANGE_MS), [requestCapture, meta.equipped, meta.proportions])
  useEffect(() => {
    const e = registry.get(id)
    if (e) e.heightScale = heightScale
  }, [id, heightScale])

  useFrame((_state, delta) => {
    const group = groupRef.current
    const visual = visualRef.current
    const entry = registry.get(id)
    if (!group || !entry) return

    const r = remotes.get(id)
    const seat = remoteSeats.get(id)
    if (!r && !seat) {
      group.visible = false
      entry.active = false
      return
    }
    group.visible = true
    entry.active = true

    const m = motionRef.current
    m.time += delta
    // A Bloxity emote plays until that player moves or sits (or the clip ends).
    const emote = remoteEmotes.get(id)
    if (emote && (seat || emote.done || (r && r.s > 0.5))) remoteEmotes.delete(id)
    m.emote = remoteEmotes.get(id) || null

    if (seat) {
      group.position.set(seat.x, 0, seat.z)
      poseAtSeat(visual, tagRef.current, seat, m, delta, actionFx.get(id))
    } else {
      if (m.seated || m.danceT != null) clearSeatPose(visual, tagRef.current, m)
      r.alpha = Math.min(1, r.alpha + delta / INTERP_S)
      r.x = r.fx + (r.tx - r.fx) * r.alpha
      r.y = r.fy + (r.ty - r.fy) * r.alpha
      r.z = r.fz + (r.tz - r.fz) * r.alpha
      r.ry = lerpAngle(r.fry, r.try, r.alpha)
      group.position.set(r.x, r.y, r.z)
      visual.rotation.y = r.ry
      m.speed = r.s
      m.grounded = r.g
    }
  })

  return (
    <group ref={groupRef} visible={false}>
      <group ref={visualRef}>
        <group ref={fullRef} visible={false}>
          <Suspense fallback={null}>
            <PlayerAvatar
              equipped={meta.equipped ?? null}
              proportions={meta.proportions || DEFAULT_PROPORTIONS}
              silent
              castShadow={false}
              targetHeight={PLAYER_HEIGHT}
              motionRef={motionRef}
              headTop={headTop}
              onReady={onAvatarReady}
            />
          </Suspense>
        </group>
      </group>
      <group ref={tagRef}>
        <Nametag id={id} name={meta.name} streak={meta.streak} title={meta.title} gate={tagGate} top={headTop} />
      </group>
    </group>
  )
})

/**
 * Everyone else in the room.
 *
 * LOD: the nearest `maxFullAvatars` within `fullDistance` (per quality preset) are
 * drawn as full Bloxity avatars: a merged body plus worn items, 1–4 draw calls
 * each, nothing when off-screen. Everyone further away is drawn as a photo of their
 * own avatar (an impostor: all of them one draw call), or, for the moment before
 * their photo is taken, a blocky stand-in (one more). Everyone gets an instanced
 * blob shadow.
 */
export function RemotePlayers() {
  const players = useGame((s) => s.players)
  const selfId = useGame((s) => s.selfId)
  const proxyRef = useRef(null)
  const impostorRef = useRef(null)
  const blobRef = useRef(null)
  /** The avatar being posed for its photo, if any (one at a time). */
  const posing = useRef(null)

  const res = useDisposable(() => {
    const blobTexture = createBlobTexture()
    const target = new WebGLRenderTarget(COLS * SLOT_W, ROWS * SLOT_H, { depthBuffer: true })
    target.texture.colorSpace = SRGBColorSpace
    const impostorGeometry = new PlaneGeometry(1, 1).translate(0, 0.5, 0)
    impostorGeometry.setAttribute('slotOffset', new InstancedBufferAttribute(new Float32Array(MAX_PLAYERS * 2), 2))
    return {
      blobTexture,
      target,
      camera: new OrthographicCamera(),
      impostorGeometry,
      impostorMaterial: createImpostorMaterial(target.texture),
      proxyGeometry: createProxyGeometry(),
      proxyMaterial: new MeshLambertMaterial({ vertexColors: true }),
      blobGeometry: new PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2),
      blobMaterial: new MeshBasicMaterial({
        map: blobTexture,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    }
  }, [])

  useLayoutEffect(() => {
    // Instance colours must exist before first render so the shader is built with them.
    const proxy = proxyRef.current
    for (let i = 0; i < MAX_PLAYERS; i += 1) proxy.setColorAt(i, _color.set('#ffffff'))
    proxy.count = 0
    impostorRef.current.count = 0
    blobRef.current.count = 0
  }, [])

  useFrame(({ gl, scene, camera }) => {
    const proxy = proxyRef.current
    const impostor = impostorRef.current
    const blob = blobRef.current
    const slotOffset = impostor.geometry.getAttribute('slotOffset')
    const settings = getSettings()
    const now = performance.now()

    // Photos, one avatar at a time: shown in full for a few frames (posed and
    // measured by PlayerAvatar), then photographed. Seated players wait until they stand.
    const pending = posing.current
    if (pending) {
      if (!registry.has(pending.id) || !pending.active) posing.current = null
      else if (--pending.imp.poseFrames <= 0) {
        capture(gl, scene, res, pending)
        pending.imp.captureAt = 0
        posing.current = null
      }
    } else {
      for (const e of registry.values()) {
        if (!e.active || !e.imp.captureAt || now < e.imp.captureAt || remoteSeats.has(e.id)) continue
        e.imp.poseFrames = POSE_FRAMES
        posing.current = e
        break
      }
    }

    ordered.length = 0
    for (const e of registry.values()) {
      if (!e.active) {
        e.full.visible = false
        continue
      }
      e.dist = Math.hypot(e.group.position.x - localPlayer.position.x, e.group.position.z - localPlayer.position.z)
      ordered.push(e)
    }
    ordered.sort(byDistance)

    let proxies = 0
    let impostors = 0
    let blobs = 0
    for (let i = 0; i < ordered.length; i += 1) {
      const e = ordered[i]
      const full = (i < settings.maxFullAvatars && e.dist < settings.fullDistance) || posing.current === e
      e.full.visible = full
      e.tagGate.show = i < settings.maxNames

      if (!full) {
        if (e.imp.ready) {
          // Their photo, turned to face the camera: the back view if they face away.
          _pos.copy(e.group.position)
          const tx = camera.position.x - _pos.x
          const tz = camera.position.z - _pos.z
          e.visual.getWorldDirection(_fwd)
          const back = _fwd.x * tx + _fwd.z * tz < 0 ? 1 : 0
          const slot = pairOf.get(e.id) * 2 + back
          slotOffset.setXY(impostors, (slot % COLS) / COLS, Math.floor(slot / COLS) / ROWS)
          _obj.position.copy(_pos)
          // Seated: the standing photo sinks to a seated player's head height (the
          // chair and the table hide the rest).
          if (remoteSeats.has(e.id)) _obj.position.y -= SEATED_SINK * e.heightScale
          _obj.rotation.set(0, Math.atan2(tx, tz), 0)
          _obj.scale.set(e.imp.width, e.imp.height, 1)
          _obj.updateMatrix()
          impostor.setMatrixAt(impostors, _obj.matrix)
          impostors += 1
          e.headTop.y = e.imp.height - 0.05 - (remoteSeats.has(e.id) ? SEATED_SINK * e.heightScale : 0)
        } else {
          _obj.position.copy(e.group.position)
          _obj.rotation.set(0, e.visual.rotation.y, 0)
          _obj.scale.set(1, e.heightScale, 1)
          _obj.updateMatrix()
          proxy.setMatrixAt(proxies, _obj.matrix)
          proxy.setColorAt(proxies, idColor(e.id))
          proxies += 1
          e.headTop.y = PROXY_TOP * e.heightScale
        }
      }

      _obj.position.set(e.group.position.x, FLOOR.blob, e.group.position.z)
      _obj.rotation.set(0, 0, 0)
      _obj.scale.set(1, 1, 1)
      _obj.updateMatrix()
      blob.setMatrixAt(blobs, _obj.matrix)
      blobs += 1
    }

    // Without realtime shadows the local player gets a blob too.
    if (!settings.shadows) {
      _obj.position.set(localPlayer.position.x, FLOOR.blob, localPlayer.position.z)
      _obj.rotation.set(0, 0, 0)
      _obj.scale.set(1, 1, 1)
      _obj.updateMatrix()
      blob.setMatrixAt(blobs, _obj.matrix)
      blobs += 1
    }

    // An instanced mesh with nothing to draw still costs a draw call.
    for (const [mesh, count] of [
      [proxy, proxies],
      [impostor, impostors],
      [blob, blobs],
    ]) {
      mesh.count = count
      mesh.visible = count > 0
      if (count) mesh.instanceMatrix.needsUpdate = true
    }
    if (proxies) proxy.instanceColor.needsUpdate = true
    if (impostors) slotOffset.needsUpdate = true
  })

  return (
    <>
      {Object.values(players)
        .filter((p) => p.id !== selfId)
        .map((p) => (
          <RemotePlayer key={p.id} meta={p} />
        ))}
      {/* Crowd instances move every frame; their bounds are not worth recomputing. */}
      <instancedMesh ref={proxyRef} args={[res.proxyGeometry, res.proxyMaterial, MAX_PLAYERS]} frustumCulled={false} />
      <instancedMesh
        ref={impostorRef}
        args={[res.impostorGeometry, res.impostorMaterial, MAX_PLAYERS]}
        frustumCulled={false}
      />
      <instancedMesh ref={blobRef} args={[res.blobGeometry, res.blobMaterial, MAX_PLAYERS + 1]} frustumCulled={false} />
    </>
  )
}

export default RemotePlayers
