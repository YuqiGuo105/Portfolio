import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

export const FULL_BODY_REFERENCE = Object.freeze({ width: 1224, height: 1285, pixelsPerUnit: 240, originX: 600, groundY: 1150 })
export const FULL_BODY_COLORS = Object.freeze({ silver: '#b4b4b3', lid: '#979796', ink: '#30312f', blush: '#ff8c80', white: '#fafaf7', green: '#65e6bf' })

// Vertex-painted diffuse shading keeps this preview independent of shadow maps,
// environment textures and postprocessing. Each surface is painted only once.
function paint(geometry, color, kind) {
  const base = new THREE.Color(color), light = new THREE.Color('#dededb')
  const position = geometry.attributes.position, normal = geometry.attributes.normal
  const colors = new Float32Array(position.count * 3), value = new THREE.Color()
  for (let i = 0; i < position.count; i++) {
    const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i)
    const illumination = Math.max(0, -0.36 * nx + 0.55 * ny + 0.74 * nz)
    let shade = 0.85 + 0.15 * illumination
    let highlight = 0.02 * illumination
    if (kind === 'head') {
      shade = 0.95 + 0.05 * illumination
      const stripe = 1 - THREE.MathUtils.smoothstep(position.getX(i), -0.94, -0.81)
      highlight = 0.68 * stripe * THREE.MathUtils.smoothstep(nz, 0.08, 0.38)
    } else if (kind === 'lid') {
      const x = position.getX(i), y = position.getY(i)
      const edge = -0.82 + 1.52 * y
      highlight = 0.58 * (1 - THREE.MathUtils.smoothstep(x, edge - 0.18, edge + 0.16))
        * THREE.MathUtils.smoothstep(nz, 0, 0.24)
      shade = 0.96 + 0.04 * illumination
    } else if (kind === 'body') {
      shade = 0.90 + 0.10 * illumination
      highlight = 0.08 * Math.max(0, -nx) * Math.max(0, nz)
    } else if (kind === 'limb') {
      shade = 0.94 + 0.06 * illumination
      highlight = 0.52 * THREE.MathUtils.smoothstep(-nx, 0.12, 0.78)
        * THREE.MathUtils.smoothstep(nz, 0, 0.48)
    } else if (kind === 'raised-arm') {
      shade = 0.95 + 0.05 * illumination
      highlight = 0.40 * THREE.MathUtils.smoothstep(ny, 0.12, 0.78)
        * THREE.MathUtils.smoothstep(nz, 0, 0.48)
        * THREE.MathUtils.smoothstep(position.getX(i), 0.55, 0.85)
    }
    value.copy(base).multiplyScalar(shade).lerp(light, Math.min(0.70, highlight)).toArray(colors, i * 3)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

function solid(parent, name, geometry, color, { outline = 0.038, kind = 'body', shaded = true } = {}) {
  geometry.deleteAttribute('uv')
  if (shaded) paint(geometry, color, kind)
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: shaded ? '#ffffff' : color, vertexColors: shaded }))
  mesh.name = name
  parent.add(mesh)
  if (outline) {
    const unmerged = geometry.clone()
    unmerged.deleteAttribute('color'); unmerged.deleteAttribute('normal')
    const shell = mergeVertices(unmerged)
    unmerged.dispose(); shell.computeVertexNormals()
    const p = shell.attributes.position, n = shell.attributes.normal
    if (!shell.index) shell.setIndex(Array.from({ length: p.count }, (_, i) => i))
    for (let i = 0; i < p.count; i++) {
      const width = typeof outline === 'function' ? outline(p.getX(i), p.getY(i), p.getZ(i)) : outline
      p.setXYZ(i, p.getX(i) + n.getX(i) * width, p.getY(i) + n.getY(i) * width, p.getZ(i) + n.getZ(i) * width)
      n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i))
    }
    for (let i = 0; i < shell.index.count; i += 3) {
      const b = shell.index.getX(i + 1)
      shell.index.setX(i + 1, shell.index.getX(i + 2)); shell.index.setX(i + 2, b)
    }
    const stroke = new THREE.Mesh(shell, new THREE.MeshBasicMaterial({ color: FULL_BODY_COLORS.ink }))
    stroke.name = `${name}-outline`
    mesh.add(stroke)
  }
  return mesh
}

function lathe(profile, depth = 0.66, segments = 48) {
  const geometry = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y)), segments)
  geometry.scale(1, 1, depth)
  geometry.computeVertexNormals()
  return geometry
}

function bezier(points, samples = 10) {
  return new THREE.CubicBezierCurve(...points.map(p => new THREE.Vector2(...p))).getPoints(samples).map(p => [p.x, p.y])
}

function curve(parent, name, points, radius, color, options = {}) {
  const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)))
  let geometry = new THREE.TubeGeometry(path, options.segments || (radius < 0.035 ? 12 : 20), radius, options.radialSegments || 8, false)
  if (options.caps) {
    const ends = [points[0], points.at(-1)].map(p => new THREE.SphereGeometry(radius, 8, 6).translate(...p))
    const joined = mergeGeometries([geometry, ...ends])
    geometry.dispose(); ends.forEach(end => end.dispose()); geometry = joined
  }
  return solid(parent, name, geometry, color, options)
}

function ellipsoid(parent, name, position, size, color, options = {}) {
  const geometry = new THREE.SphereGeometry(1, options.segments || 24, options.rings || 16)
  geometry.scale(...size)
  const mesh = solid(parent, name, geometry, color, options)
  mesh.position.set(...position)
  return mesh
}

function roundedShape(parent, name, shape, depth, bevel, color, outline = 0.045, kind = 'body') {
  const raw = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 4, curveSegments: 12, steps: 1 })
  raw.translate(0, 0, -depth / 2)
  raw.deleteAttribute('uv')
  const geometry = mergeVertices(raw)
  raw.dispose()
  geometry.computeVertexNormals()
  return solid(parent, name, geometry, color, { outline, kind })
}

// Cross-sections follow the source silhouette; elliptical depth gives each limb
// one continuous rounded surface instead of a cylinder joined to a sphere.
function referenceVolume(sections, { centerZ = 0, rings = 24, sides = 24 } = {}) {
  const { pixelsPerUnit: unit, originX, groundY } = FULL_BODY_REFERENCE
  const contour = new THREE.CatmullRomCurve3(sections.map(([y, left, right]) =>
    new THREE.Vector3(((left + right) / 2 - originX) / unit, (groundY - y) / unit, (right - left) / (2 * unit))), false, 'catmullrom', 0.35)
  const depths = new THREE.CatmullRomCurve3(sections.map(([y, , , depth]) =>
    new THREE.Vector3(depth / unit, (groundY - y) / unit, 0)), false, 'catmullrom', 0.35)
  const positions = [], indices = []
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings, p = contour.getPoint(t)
    const depth = Math.max(0, depths.getPoint(t).x)
    const z = typeof centerZ === 'function' ? centerZ(p.y, depth) : centerZ
    for (let side = 0; side < sides; side++) {
      const angle = side / sides * Math.PI * 2
      positions.push(p.x + Math.max(0, p.z) * Math.cos(angle), p.y, z + depth * Math.sin(angle))
      if (ring < rings) {
        const a = ring * sides + side, b = ring * sides + (side + 1) % sides
        if (ring > 0) indices.push(a, b, a + sides)
        if (ring < rings - 1) indices.push(b, b + sides, a + sides)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  const welded = mergeVertices(geometry)
  geometry.dispose(); welded.computeVertexNormals()
  return welded
}

// Two tangent-matched arcs carry the ankle into the toe and sole. Reuse the
// existing rings so the approved hip, inner leg gap and mesh budget stay fixed.
function roundFootContour(geometry, side) {
  const { pixelsPerUnit: unit, originX, groundY } = FULL_BODY_REFERENCE
  const left = side < 0, ankle = left ? 466 : 750, toe = left ? 430 : 782, sole = left ? 505 : 711
  const arcs = [
    new THREE.CubicBezierCurve(...[[ankle, 1036], [ankle, 1061], [toe, 1075], [toe, 1107]].map(p => new THREE.Vector2(...p))),
    new THREE.CubicBezierCurve(...[[toe, 1107], [toe, 1130], [left ? 460 : 757, 1143], [sole, 1143]].map(p => new THREE.Vector2(...p))),
  ]
  const position = geometry.attributes.position, rows = new Map()
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i)
    if ((groundY - y * unit) <= 1036) continue
    if (!rows.has(y)) rows.set(y, [])
    rows.get(y).push(i)
  }
  for (const [y, row] of rows) {
    const pixelY = groundY - y * unit, arc = arcs[pixelY <= 1107 ? 0 : 1]
    let lo = 0, hi = 1
    for (let step = 0; step < 24; step++) {
      const t = (lo + hi) / 2
      if (arc.getPoint(t).y < pixelY) lo = t
      else hi = t
    }
    const xs = row.map(i => position.getX(i)), min = Math.min(...xs), max = Math.max(...xs)
    if (max - min < 0.00001) continue
    const outer = (arc.getPoint((lo + hi) / 2).x - originX) / unit
    const delta = (outer - (left ? min : max)) * THREE.MathUtils.smoothstep(pixelY, 1036, 1046)
    for (const i of row) {
      const across = (position.getX(i) - min) / (max - min)
      position.setX(i, position.getX(i) + delta * (left ? 1 - across : across))
    }
  }
  geometry.computeVertexNormals()
  return geometry
}

// Keep the shoulder/wrist sweep fixed; paired contour rails give the hand its
// thumb mound, rounded palm and finger web without adding intersecting pieces.
function armVolume(sections, rings = 40, sides = 22) {
  const { pixelsPerUnit: unit, originX, groundY } = FULL_BODY_REFERENCE
  const path = new THREE.CatmullRomCurve3(sections.map(([x, y, z]) =>
    new THREE.Vector3((x - originX) / unit, (groundY - y) / unit, z)), false, 'catmullrom', 0.4)
  const radii = new THREE.CatmullRomCurve3(sections.map(([, , , width, depth]) =>
    new THREE.Vector3(width / unit, depth / unit, 0)), false, 'catmullrom', 0.4)
  const wristRing = 15, wristT = wristRing / rings, handRings = 40, totalRings = wristRing + handRings
  const wrist = path.getPoint(wristT), tangent = path.getTangent(wristT), radius = radii.getPoint(wristT)
  const normal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize()
  const hand = [
    [854, 724, 940, 760, 0.06, 40], [862, 704, 967, 748, 0.07, 40],
    [878, 692, 969, 725, 0.08, 38], [895, 691, 958, 702, 0.09, 30],
    [907, 675, 945, 687, 0.10, 19], [924, 653, 959, 662, 0.10, 20],
    [940, 638, 964, 646, 0.10, 16], [945, 633, 958, 634, 0.10, 8],
    [951, 632, 951, 632, 0.10, 0],
  ]
  const rail = side => new THREE.CatmullRomCurve3([
    wrist.clone().addScaledVector(normal, side === 0 ? radius.x : -radius.x),
    ...hand.map(section => new THREE.Vector3((section[side * 2] - originX) / unit, (groundY - section[side * 2 + 1]) / unit, section[4])),
  ], false, 'catmullrom', 0.35)
  const leftRail = rail(0), rightRail = rail(1)
  const handDepth = new THREE.CatmullRomCurve3([new THREE.Vector3(radius.y, 0, 0),
    ...hand.map(section => new THREE.Vector3(section[5] / unit, 0, 0)),
  ], false, 'catmullrom', 0.35)
  const positions = [], indices = []
  for (let ring = 0; ring <= totalRings; ring++) {
    const t = Math.min(wristT, ring / rings), center = path.getPoint(t), tangent = path.getTangent(t)
    const radius = radii.getPoint(t), normal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize()
    const width = ring === 0 ? 0 : Math.max(0, radius.x)
    const depth = ring === 0 ? 0 : Math.max(0, radius.y)
    const u = (ring - wristRing) / handRings
    const left = ring > wristRing ? leftRail.getPoint(u) : null
    const right = ring > wristRing ? rightRail.getPoint(u) : null
    const palmDepth = left ? Math.max(0, handDepth.getPoint(u).x) : 0
    for (let side = 0; side < sides; side++) {
      const angle = side / sides * Math.PI * 2
      if (left) {
        const across = (1 - Math.cos(angle)) / 2
        positions.push(THREE.MathUtils.lerp(left.x, right.x, across), THREE.MathUtils.lerp(left.y, right.y, across),
          left.z + palmDepth * Math.sin(angle))
      } else {
        positions.push(center.x + normal.x * width * Math.cos(angle), center.y + normal.y * width * Math.cos(angle), center.z + depth * Math.sin(angle))
      }
      if (ring < totalRings) {
        const a = ring * sides + side, b = ring * sides + (side + 1) % sides
        if (ring > 0) indices.push(a, b, a + sides)
        if (ring < totalRings - 1) indices.push(b, b + sides, a + sides)
      }
    }
  }
  const raw = new THREE.BufferGeometry()
  raw.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); raw.setIndex(indices)
  const geometry = mergeVertices(raw)
  raw.dispose(); geometry.computeVertexNormals()
  return geometry
}

function surfaceSeam(parent, mesh, name, points, radius, color) {
  const meshes = Array.isArray(mesh) ? mesh : [mesh]
  meshes.forEach(surface => surface.updateWorldMatrix(true, false))
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1))
  const path = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, 0)))
  const surface = path.getPoints(48).map(({ x, y }) => {
    ray.ray.origin.set(x, y, 3)
    const hit = ray.intersectObjects(meshes, false)[0]
    if (!hit) throw new Error(`${name}: crease must lie on the body surface at ${x.toFixed(3)}, ${y.toFixed(3)}`)
    return [x, y, hit.point.z + radius * 0.6]
  })
  return curve(parent, name, surface, radius, color, { outline: 0, shaded: false, caps: true, segments: 24, radialSegments: 6 })
}

// Clip the hand's existing surface triangles to the ink ribbon. Matching the
// actual facets avoids floating cords or chords cutting through the palm edge.
function handCrease(parent, skin, name, segments, radius, color, taperEnd = 1) {
  const { originX, groundY, pixelsPerUnit: unit } = FULL_BODY_REFERENCE
  const path = new THREE.CurvePath()
  segments.forEach(segment => path.add(new THREE.CubicBezierCurve3(...segment.map(([x, y]) =>
    new THREE.Vector3((x - originX) / unit, (groundY - y) / unit, 0)))))
  const rows = [], patches = [], positions = [], steps = 20, length = path.getLength()
  for (let step = 0; step <= steps; step++) {
    const t = step / steps, point = path.getPointAt(t), tangent = path.getTangentAt(t)
    const cap = Math.min(1, t * length / radius, (1 - t) * length / radius)
    const width = radius * Math.sqrt(Math.max(0, 1 - (1 - cap) ** 2))
      * THREE.MathUtils.lerp(1, taperEnd, THREE.MathUtils.smoothstep(t, 0.78, 1))
    rows.push([-1, 1].map(across => new THREE.Vector3(point.x - tangent.y * width * across, point.y + tangent.x * width * across, 0)))
  }
  for (let i = 0; i < steps; i++) {
    const [a, b] = rows[i], [c, d] = rows[i + 1]
    if (i > 0) patches.push([a, c, b])
    if (i < steps - 1) patches.push([b, c, d])
  }
  const bounds = points => new THREE.Box2().setFromPoints(points)
  const ink = patches.map(points => ({ points, bounds: bounds(points) }))
  const side = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
  const { position } = skin.geometry.attributes, index = skin.geometry.index
  for (let i = 0; i < index.count; i += 3) {
    const triangle = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(position, index.getX(i + k)))
    if (side(...triangle) <= 1e-12) continue
    const box = bounds(triangle)
    for (const patch of ink) {
      if (!box.intersectsBox(patch.bounds)) continue
      let polygon = triangle
      for (let edge = 0; edge < 3 && polygon.length; edge++) {
        const a = patch.points[edge], b = patch.points[(edge + 1) % 3], clipped = []
        for (let j = 0; j < polygon.length; j++) {
          const p = polygon[j], q = polygon[(j + 1) % polygon.length]
          const dp = side(a, b, p), dq = side(a, b, q)
          if (dp >= 0) clipped.push(p)
          if ((dp >= 0) !== (dq >= 0)) clipped.push(p.clone().lerp(q, dp / (dp - dq)))
        }
        polygon = clipped
      }
      for (let j = 1; j < polygon.length - 1; j++) {
        const face = [polygon[0], polygon[j], polygon[j + 1]]
        if (side(...face) > 1e-12) face.forEach(p => positions.push(p.x, p.y, p.z + 0.002))
      }
    }
  }
  const raw = new THREE.BufferGeometry()
  raw.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const geometry = mergeVertices(raw, 1e-7)
  raw.dispose(); geometry.computeVertexNormals()
  return solid(parent, name, geometry, color, { outline: 0, shaded: false })
}

const headProfile = [
  [0, 1.658], [0.30, 1.668],
  ...bezier([[0.30, 1.668], [0.88, 1.69], [0.98, 1.85], [1.005, 2.13]]).slice(1),
  [1.075, 3.015], [1.06, 3.04], [0.99, 3.04], [0.98, 2.23], [0, 2.20],
]

const headOuterProfile = headProfile.slice(0, 14)

function faceZ(x, y) {
  const outer = headOuterProfile
  let radius = 1.1
  for (let i = 1; i < outer.length; i++) {
    const a = outer[i - 1], b = outer[i]
    if (y >= a[1] && y <= b[1]) {
      radius = THREE.MathUtils.lerp(a[0], b[0], (y - a[1]) / (b[1] - a[1] || 1)); break
    }
  }
  return Math.sqrt(Math.max(0, radius * radius - x * x)) * 0.66
}

export { faceZ as potFaceDepth }

function facePatch(parent, name, x, y, rx, ry, color, offset) {
  // Concentric rings follow the pot surface; a single triangle fan cuts through it.
  const positions = [x, y, faceZ(x, y) + offset], indices = []
  const segments = rx < 0.05 ? 24 : rx < 0.12 ? 32 : 40, rings = rx < 0.05 ? 2 : rx < 0.17 ? 3 : 4
  for (let ring = 1; ring <= rings; ring++) {
    for (let side = 0; side < segments; side++) {
      const a = side / segments * Math.PI * 2, r = ring / rings
      const px = x + Math.cos(a) * rx * r, py = y + Math.sin(a) * ry * r
      positions.push(px, py, faceZ(px, py) + offset)
      const current = 1 + (ring - 1) * segments + side, next = 1 + (ring - 1) * segments + (side + 1) % segments
      if (ring === 1) indices.push(0, current, next)
      else indices.push(current - segments, current, next, current - segments, next, next - segments)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return solid(parent, name, geometry, color, { outline: 0, shaded: false })
}

export function createFullBodyPot() {
  const root = new THREE.Group(); root.name = 'MrPotFullBody'
  const body = new THREE.Group(); body.name = 'BodyRig'; root.add(body)
  const { silver, lid: lidColor, ink, white, blush, green } = FULL_BODY_COLORS

  for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.name = side < 0 ? 'LegLeft' : 'LegRight'; body.add(leg)
    const sections = side < 0 ? [
      [910, 522, 522, 0], [938, 472, 584, 66], [1010, 467, 581, 47],
      [1036, 466, 579, 48], [1056, 461, 578, 52], [1073, 450, 576, 58],
      [1090, 436, 574, 65], [1108, 430, 572, 68], [1120, 429, 571, 63], [1130, 438, 563, 47],
      [1135, 449, 556, 30], [1141, 480, 535, 15], [1143, 505, 505, 0],
    ] : [
      [910, 692, 692, 0], [938, 629, 740, 66], [1010, 630, 750, 47],
      [1036, 631, 750, 48], [1056, 632, 754, 52], [1073, 634, 766, 58],
      [1090, 635, 779, 65], [1108, 637, 782, 68], [1120, 637, 782, 63], [1130, 646, 772, 47],
      [1135, 655, 767, 30], [1141, 681, 739, 15], [1143, 711, 711, 0],
    ]
    solid(leg, `${leg.name}Boot`, roundFootContour(referenceVolume(sections, {
      // Bury the cap inside the belly and ease its front into the shin.
      centerZ: (y, depth) => 0.18 + 0.20 * THREE.MathUtils.smoothstep(y, -0.005, 0.14)
        + 0.14 * THREE.MathUtils.smoothstep(y, 0.58, 0.86) - depth,
      rings: 38, sides: 20,
    }), side), silver, {
      outline: (x, y) => 0.055 * (1 - THREE.MathUtils.smoothstep(y, 0.68, 0.94)),
      kind: 'limb',
    })
  }

  const leftArm = new THREE.Group(); leftArm.name = 'ArmLeft'; body.add(leftArm)
  const leftSleeve = solid(leftArm, 'LeftSleeve', referenceVolume([
    [750, 480, 480, 0], [778, 437, 487, 32], [817, 403, 471, 40],
    [857, 379, 459, 43], [900, 364, 453, 44], [938, 357, 453, 42],
    [965, 363, 447, 36], [984, 374, 430, 27], [993, 383, 418, 19],
    [996, 390, 408, 10], [997, 399, 399, 0],
  ], { centerZ: y => -0.08 + 0.22 * THREE.MathUtils.smoothstep(y, 1.25, 1.65), rings: 24, sides: 22 }), silver, { outline: 0.055, kind: 'limb' })
  surfaceSeam(leftArm, leftSleeve, 'LeftThumbSeam', [[-0.80, 0.83], [-0.77, 0.75], [-0.70, 0.72], [-0.66, 0.76]], 0.029, ink)

  const rightArm = new THREE.Group(); rightArm.name = 'ArmRight'; body.add(rightArm)
  const raisedArm = solid(rightArm, 'RightArmSurface', armVolume([
    [697, 805, 0.10, 0, 0], [735, 811, 0.10, 48, 42],
    [785, 815, 0.07, 47, 44], [833, 798, 0.04, 45, 43],
    [875, 763, 0.04, 43, 41], [912, 728, 0.06, 44, 40],
    [921, 710, 0.07, 42, 38], [926, 695, 0.08, 30, 29],
    [932, 679, 0.09, 18, 20], [939, 659, 0.10, 17, 18],
    [950, 642, 0.10, 16, 16], [954, 631, 0.10, 0, 0],
  ]), silver, { outline: (x) => 0.052 * THREE.MathUtils.smoothstep(x, 0.42, 0.65), kind: 'raised-arm' })
  handCrease(rightArm, raisedArm, 'RightThumbSeam', [
    [[899, 689], [918, 696], [925, 716], [916, 727]],
    [[916, 727], [907, 738], [894, 734], [889, 722]],
  ], 0.029, ink, 0.45)
  handCrease(rightArm, raisedArm, 'RightPalmCrease', [
    [[916, 727], [911.5, 732.5], [918, 750], [936, 752]],
    [[936, 752], [945, 753], [960, 750], [966, 744]],
  ], 0.027, ink)

  const torso = solid(body, 'Torso', referenceVolume([
    [744, 604, 604, 0], [765, 485, 725, 73], [810, 468, 744, 91],
    [855, 453, 760, 102], [903, 453, 764, 106], [946, 463, 755, 100],
    [977, 487, 733, 85], [999, 539, 674, 52], [1008, 608, 608, 0],
  ], { centerZ: y => THREE.MathUtils.lerp(0.26, 0.03, THREE.MathUtils.smoothstep(y, 0.59, 1.69)), rings: 24 }), silver, {
    outline: 0,
    kind: 'limb',
  })
  surfaceSeam(body, [torso, leftSleeve], 'LeftArmCrease', [[-0.56, 1.41], [-0.61, 1.20], [-0.61, 1.02], [-0.56, 0.84]], 0.026, ink)
  surfaceSeam(body, [torso, raisedArm], 'RightArmCrease', [[0.62, 1.42], [0.66, 1.20], [0.65, 1.00], [0.60, 0.83]], 0.026, ink)
  surfaceSeam(body, torso, 'BellyCrease', [[-0.31, 0.65], [-0.15, 0.616], [0.033, 0.604], [0.21, 0.62], [0.33, 0.66]], 0.022, ink)
  ellipsoid(body, 'ChestLightBezel', [0.37, 1.375, 0.45], [0.082, 0.083, 0.029], '#78a99a', { outline: 0, segments: 16, rings: 10 })
  ellipsoid(body, 'ChestLight', [0.37, 1.375, 0.475], [0.061, 0.063, 0.025], green, { outline: 0, shaded: false, segments: 16, rings: 10 })
  ellipsoid(body, 'ChestLightGlint', [0.351, 1.397, 0.497], [0.019, 0.020, 0.007], '#effff8', { outline: 0, shaded: false, segments: 8, rings: 6 })

  const head = new THREE.Group(); head.name = 'HeadPivot'; head.position.set(0, 2.35, 0.48); root.add(head)
  const headParts = new THREE.Group(); headParts.name = 'HeadParts'; headParts.position.y = -2.35; head.add(headParts)
  solid(headParts, 'PotHead', lathe(headProfile), silver, { kind: 'head', outline: 0.060 })
  const lowerProfile = headProfile.slice(0, 4)
  const lowerLip = [...lowerProfile.slice(1).reverse().map(([x, y]) => [-x, y, 0.02]),
    ...lowerProfile.map(([x, y]) => [x, y, 0.02])]
  curve(headParts, 'HeadLowerLip', lowerLip, 0.045, ink, { outline: 0, shaded: false })
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape()
    shape.moveTo(side * 1.07, 2.57)
    shape.bezierCurveTo(side * 1.19, 2.64, side * 1.26, 2.66, side * 1.35, 2.68)
    shape.bezierCurveTo(side * 1.48, 2.70, side * 1.45, 2.82, side * 1.35, 2.82)
    shape.bezierCurveTo(side * 1.25, 2.82, side * 1.16, 2.77, side * 1.07, 2.75)
    shape.closePath()
    roundedShape(headParts, side < 0 ? 'PotHandleLeft' : 'PotHandleRight', shape, 0.15, 0.018, silver, 0.050)
  }

  const lid = new THREE.Group(); lid.name = 'Lid'; lid.position.y = 3.1; headParts.add(lid)
  const dome = [[0, -0.03], [1.08, -0.03], [1.08, 0.03], ...bezier([[1.08, 0.03], [0.89, 0.35], [0.42, 0.48], [0, 0.48]], 18).slice(1)]
  solid(lid, 'LidDome', lathe(dome), lidColor, { kind: 'lid', outline: 0.050 })
  const rim = Array.from({ length: 9 }, (_, i) => {
    const angle = i / 8 * Math.PI * 2
    return [1.125 + Math.cos(angle) * 0.055, Math.sin(angle) * 0.065]
  })
  solid(lid, 'LidRim', lathe(rim), '#c2c2bf', { outline: 0.048 })
  for (const [name, y] of [['LidTopSeam', 0.07], ['LidBottomSeam', -0.07]]) {
    const geometry = new THREE.TorusGeometry(1.135, 0.025, 6, 48)
    geometry.rotateX(Math.PI / 2); geometry.scale(1, 1, 0.66); geometry.translate(0, y, 0)
    solid(lid, name, geometry, ink, { outline: 0, shaded: false })
  }
  const knobCurve = new THREE.CatmullRomCurve3([
    [-0.08, 0.50, 0], [-0.21, 0.61, 0], [-0.235, 0.70, 0], [-0.18, 0.77, 0], [0, 0.80, 0],
    [0.18, 0.77, 0], [0.235, 0.70, 0], [0.21, 0.61, 0], [0.08, 0.50, 0],
  ].map(p => new THREE.Vector3(...p)), true)
  solid(lid, 'LoopKnob', new THREE.TubeGeometry(knobCurve, 36, 0.045, 10, true), ink, { outline: 0, shaded: false })
  for (const [index, points] of [
    [[-0.16, 0.91, 0], [-0.09, 1.06, 0], [-0.20, 1.23, 0], [-0.25, 1.38, 0], [-0.13, 1.53, 0]],
    [[0.25, 0.91, 0], [0.31, 1.05, 0], [0.23, 1.20, 0], [0.23, 1.34, 0], [0.33, 1.43, 0]],
  ].entries()) {
    curve(lid, `Steam${index}`, points, 0.052, '#e8e9ef', { outline: 0, shaded: false, caps: true })
  }

  const face = new THREE.Group(); face.name = 'Face'; headParts.add(face)
  for (const side of [-1, 1]) {
    const label = side < 0 ? 'Left' : 'Right', x = side * 0.473, y = 2.39
    const eye = new THREE.Group(); eye.name = `Eye${label}`; face.add(eye)
    eye.userData = { radiusX: 0.19, radiusY: 0.226 }
    facePatch(eye, `Eye${label}Border`, x, y, 0.19, 0.226, ink, 0.018)
    facePatch(eye, `Eye${label}White`, x, y, 0.162, 0.199, white, 0.025)
    facePatch(eye, `Eye${label}Pupil`, x - side * 0.012, y - 0.005, 0.107, 0.139, '#303230', 0.032)
    facePatch(eye, `Eye${label}Glint`, x - side * 0.025, y + 0.063, 0.034, 0.035, '#ffffff', 0.039)
    facePatch(face, `Cheek${label}`, side * 0.665, 2.09, 0.158, 0.157, blush, 0.018)
    facePatch(face, `Cheek${label}Glint`, side * 0.665 - 0.050, 2.147, 0.040, 0.041, '#ffb2a8', 0.025)
    const browPoints = [[side * 0.61, 2.745], [side * 0.53, 2.80], [side * 0.445, 2.80]]
    curve(face, `Brow${label}`, browPoints.map(([px, py]) => [px, py, faceZ(px, py) + 0.035]), 0.032, ink, { outline: 0, shaded: false, caps: true })
  }
  curve(face, 'Smile', [[-0.16, 2.20], [-0.11, 2.135], [0, 2.11], [0.11, 2.135], [0.16, 2.20]].map(([x, y]) => [x, y, faceZ(x, y) + 0.035]), 0.030, ink, { outline: 0, shaded: false, caps: true })
  root.userData = { reference: 'mr-pot-tour-guide.png', scale: '240 reference pixels per unit', back: 'Inferred volume; only the front is reference-grounded' }
  for (const [group, pivot] of [[leftArm, [-0.52, 1.61, -0.04]], [rightArm, [0.52, 1.52, -0.04]],
    [body.getObjectByName('LegLeft'), [-0.33, 0.82, -0.06]], [body.getObjectByName('LegRight'), [0.38, 0.82, -0.06]]]) {
    group.position.set(...pivot)
    for (const child of group.children) child.position.sub(group.position)
  }
  root.updateMatrixWorld(true)
  return { root, body, head, lid, face, leftArm, rightArm }
}

export function fullBodyStats(root) {
  let meshes = 0, triangles = 0
  root.traverse(object => {
    if (!object.isMesh) return
    meshes++
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3
  })
  return { meshes, triangles }
}

export function disposeFullBody(root) {
  root.traverse(object => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose() } })
}
