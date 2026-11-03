import { BufferAttribute, CanvasTexture, CircleGeometry, SRGBColorSpace } from 'three'

/**
 * A potato chip: a slightly oval disc bent into a saddle (the rim rises at the
 * sides and dips front and back), with a toasted edge baked into vertex colours.
 * ~20 triangles. Shared by the chips on the tables and the giant ones on the
 * fountain (scaled up per instance).
 */
export function createChipGeometry(radius = 0.17, curl = 2.2) {
  const geometry = new CircleGeometry(radius, 20).rotateX(-Math.PI / 2)
  geometry.scale(1.15, 1, 1)
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const z = position.getZ(i)
    position.setY(i, curl * (x * x - z * z))
    const r = Math.hypot(x / 1.15, z) / radius
    const shade = 1 - 0.2 * r * r
    colors[i * 3] = shade
    colors[i * 3 + 1] = shade * 0.96
    colors[i * 3 + 2] = shade * 0.86
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * A white cartoon hand on a red disc: the slap marker. Drawn with shapes rather than
 * an emoji so it looks the same on every device. 128 px.
 */
export function createSlapTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const c = size / 2

  ctx.beginPath()
  ctx.arc(c, c, 60, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(c, c, 53, 0, Math.PI * 2)
  const g = ctx.createRadialGradient(c - 14, c - 18, 6, c, c, 56)
  g.addColorStop(0, '#ff6b5e')
  g.addColorStop(1, '#d4182c')
  ctx.fillStyle = g
  ctx.fill()

  // The hand: palm, four fingers and a thumb, outlined.
  const parts = (stroke) => {
    ctx.save()
    ctx.translate(c + 2, c + 6)
    const pass = (fn) => {
      fn()
      if (stroke) ctx.stroke()
      else ctx.fill()
    }
    pass(() => roundRect(ctx, -22, -10, 44, 38, 12))
    for (const [x, h] of [[-21, 30], [-10, 38], [1, 40], [12, 34]]) pass(() => roundRect(ctx, x, -10 - h, 10, h + 8, 5))
    ctx.rotate(-0.75)
    pass(() => roundRect(ctx, -34, 0, 12, 30, 6))
    ctx.restore()
  }
  ctx.lineWidth = 7
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#5a0d16'
  parts(true)
  ctx.fillStyle = '#ffffff'
  parts(false)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/**
 * A plate liner: a 3 x 3 checker of `color` and cream, one square per chip, with a
 * darker rim. 192 px.
 */
export function createLinerTexture(color, dark, cols = 3, rows = 3) {
  const size = 192
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = dark
  ctx.fillRect(0, 0, size, size)
  const pad = 6
  const cw = (size - pad * 2) / cols
  const ch = (size - pad * 2) / rows
  for (let r = 0; r < rows; r += 1) {
    for (let col = 0; col < cols; col += 1) {
      ctx.fillStyle = (r + col) % 2 === 0 ? color : '#fff6e6'
      roundRect(ctx, pad + col * cw + 2, pad + r * ch + 2, cw - 4, ch - 4, 8)
      ctx.fill()
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}
