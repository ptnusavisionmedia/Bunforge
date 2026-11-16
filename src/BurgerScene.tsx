import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import {
  Component,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  AdditiveBlending,
  Color,
  DataTexture,
  DoubleSide,
  DirectionalLight,
  Group,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three'
import { getIngredientModel } from './ingredientModels'

export type CameraCommand = {
  action: 'left' | 'right' | 'zoom-in' | 'zoom-out' | 'reset'
  serial: number
}

type Layer = { id: string; ingredientId: string; height: number }

type SceneProps = {
  layers: Layer[]
  selectedId: string | null
  onSelect: (id: string) => void
  exploded: boolean
  cameraCommand: CameraCommand | null
  assemblyKey: number
  reducedMotion: boolean
  isMobile: boolean
  onUnavailable: () => void
  onSceneReady?: () => void
}

type PlacedLayer = Layer & { y: number }
type AnimatedLayer = PlacedLayer & {
  animation: LayerAnimation
}
type LayerAnimation = {
  kind: 'arrive' | 'shift' | 'reorder' | 'open' | 'leave'
  duration: number
  delay?: number
  side?: number
  rise?: number
}
type LayerPose = {
  x: number
  y: number
  z: number
  pitch: number
  roll: number
  scale: number
}
type LayerMotion = {
  item: AnimatedLayer
  start: LayerPose
  laneX: number
  laneZ: number
  elapsed: number
  delay: number
  incomingSpeed: number
  speed: number
  playing: boolean
}

const FOV = 35
const DEFAULT_AZIMUTH = 0.4
const DEFAULT_INCLINATION = 1.305
const EXPLODED_GAP = 0.44

function CameraRig({
  height,
  command,
  isMobile,
  reducedMotion,
}: {
  height: number
  command: CameraCommand | null
  isMobile: boolean
  reducedMotion: boolean
}) {
  const { camera, size, gl, invalidate } = useThree()
  const performance = useThree((state) => state.performance)
  // Lift the look-at point a little so the burger sits below the stage title, with air around it.
  const targetY = height / 2 - 0.21 + (isMobile ? 0.12 : 0.34)
  const aspect = size.width / Math.max(size.height, 1)
  const verticalFit = (height / 2 + 0.95) / Math.tan(MathUtils.degToRad(FOV / 2))
  const horizontalFit = 6.7 / Math.max(aspect, 0.57)
  const fit = Math.max(7.2, verticalFit + 1.9, horizontalFit)
  const target = useMemo(() => new Vector3(), [])
  const cameraState = useRef({
    azimuth: DEFAULT_AZIMUTH,
    polar: DEFAULT_INCLINATION,
    zoom: 1,
    currentAzimuth: DEFAULT_AZIMUTH,
    currentPolar: DEFAULT_INCLINATION,
    currentDistance: fit,
    currentY: targetY,
    lastCommand: -1,
  })

  useLayoutEffect(() => {
    const controls = cameraState.current
    if (camera instanceof PerspectiveCamera) {
      camera.far = Math.max(220, fit * 5)
      camera.updateProjectionMatrix()
    }
    if (command && command.serial !== controls.lastCommand) {
      controls.lastCommand = command.serial
      switch (command.action) {
        case 'left':
          controls.azimuth -= Math.PI / 8
          break
        case 'right':
          controls.azimuth += Math.PI / 8
          break
        case 'zoom-in':
          controls.zoom = Math.max(0.62, controls.zoom * 0.86)
          break
        case 'zoom-out':
          controls.zoom = Math.min(1.75, controls.zoom / 0.86)
          break
        case 'reset':
          controls.azimuth =
            DEFAULT_AZIMUTH +
            Math.round((controls.currentAzimuth - DEFAULT_AZIMUTH) / (Math.PI * 2)) * Math.PI * 2
          controls.polar = DEFAULT_INCLINATION
          controls.zoom = 1
          break
      }
    }
    invalidate()
  }, [camera, command, fit, targetY, invalidate])

  useEffect(() => {
    const canvas = gl.domElement
    const oldTouchAction = canvas.style.touchAction
    canvas.style.touchAction = 'pan-y'
    let active: { id: number; x: number; y: number; moved: boolean } | null = null

    function startDrag(event: PointerEvent) {
      if (!event.isPrimary || event.button !== 0) return
      active = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
      canvas.setPointerCapture(event.pointerId)
    }

    function moveDrag(event: PointerEvent) {
      if (!active || active.id !== event.pointerId) return
      const dx = event.clientX - active.x
      const dy = event.clientY - active.y
      const horizontalOnly = isMobile || event.pointerType === 'touch'
      const travel = horizontalOnly ? Math.abs(dx) : Math.hypot(dx, dy)
      if (!active.moved && travel < 4) return
      active = { id: active.id, x: event.clientX, y: event.clientY, moved: true }
      performance.regress() // turunkan resolusi sementara saat memutar, kembali tajam setelah berhenti
      const controls = cameraState.current
      controls.azimuth -= dx * 0.011
      if (!horizontalOnly) {
        controls.polar = MathUtils.clamp(controls.polar - dy * 0.009, 0.62, 1.51)
      }
      invalidate()
    }

    function finishDrag(event: PointerEvent) {
      if (active?.id !== event.pointerId) return
      active = null
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    }

    canvas.addEventListener('pointerdown', startDrag)
    canvas.addEventListener('pointermove', moveDrag)
    canvas.addEventListener('pointerup', finishDrag)
    canvas.addEventListener('pointercancel', finishDrag)
    return () => {
      canvas.style.touchAction = oldTouchAction
      canvas.removeEventListener('pointerdown', startDrag)
      canvas.removeEventListener('pointermove', moveDrag)
      canvas.removeEventListener('pointerup', finishDrag)
      canvas.removeEventListener('pointercancel', finishDrag)
    }
  }, [gl, invalidate, isMobile, performance])

  useFrame((_, delta) => {
    const controls = cameraState.current
    const distance = Math.max(fit * controls.zoom, 4.8, height * 0.95 + 2.2)
    const ease = (from: number, to: number) =>
      reducedMotion || Math.abs(from - to) < 0.001
        ? to
        : MathUtils.damp(from, to, 13, Math.min(delta, 0.034))

    controls.currentY = ease(controls.currentY, targetY)
    controls.currentDistance = ease(controls.currentDistance, distance)
    controls.currentAzimuth = ease(controls.currentAzimuth, controls.azimuth)
    controls.currentPolar = ease(controls.currentPolar, controls.polar)

    target.set(0, controls.currentY, 0)
    const groundRadius = controls.currentDistance * Math.sin(controls.currentPolar)
    camera.position.set(
      groundRadius * Math.sin(controls.currentAzimuth),
      controls.currentY + controls.currentDistance * Math.cos(controls.currentPolar),
      groundRadius * Math.cos(controls.currentAzimuth),
    )
    camera.lookAt(target)
    if (
      controls.currentAzimuth !== controls.azimuth ||
      controls.currentY !== targetY ||
      controls.currentDistance !== distance ||
      controls.currentPolar !== controls.polar
    ) {
      invalidate()
    }
  })

  return null
}

const stationaryAnimation: LayerAnimation = { kind: 'shift', duration: 0.36 }
const exitAnimation: LayerAnimation = { kind: 'leave', duration: 0.42 }

function atRest(y: number): LayerPose {
  return { x: 0, y, z: 0, pitch: 0, roll: 0, scale: 1 }
}

function getPose(group: Group): LayerPose {
  return {
    x: group.position.x,
    y: group.position.y,
    z: group.position.z,
    pitch: group.rotation.x,
    roll: group.rotation.z,
    scale: group.scale.x,
  }
}

function applyPose(group: Group, pose: LayerPose) {
  group.position.set(pose.x, pose.y, pose.z)
  group.rotation.set(pose.pitch, 0, pose.roll)
  group.scale.setScalar(pose.scale)
}

function startingPose(layer: AnimatedLayer): LayerPose {
  const { rise = 0, side = 0 } = layer.animation
  return {
    x: side,
    y: layer.y + rise,
    z: Math.abs(side) * 0.43,
    pitch: rise > 0 ? 0.075 : 0,
    roll: -side * 0.14,
    scale: 1,
  }
}

function movingPose(layer: AnimatedLayer, motion: LayerMotion, t: number): LayerPose {
  const { start, incomingSpeed } = motion
  const { kind, duration, side = 0, rise = 0 } = layer.animation
  const ease = MathUtils.smootherstep
  const fall = kind === 'arrive' ? ease(t, 0, 0.82) : kind === 'reorder'
    ? ease(t, 0.25, 0.77)
    : MathUtils.smoothstep(t, 0, 1)
  const drift = kind === 'arrive' ? ease(t, 0.03, 0.81) : ease(t, 0, 1)
  const carry = incomingSpeed * duration * t * (1 - t) ** 3
  const pose: LayerPose = {
    x: start.x * (1 - drift),
    y: MathUtils.lerp(start.y, layer.y, fall) + carry,
    z: start.z * (1 - drift),
    pitch: start.pitch * (1 - drift),
    roll: start.roll * (1 - drift),
    scale: MathUtils.lerp(start.scale, 1, drift),
  }

  switch (kind) {
    case 'arrive': {
      const contact = ease(t, 0.82, 1)
      pose.y += Math.sin(contact * Math.PI) ** 2 * 0.025
      return pose
    }
    case 'open': {
      const lift = ease(t, 0, 0.25) * (1 - ease(t, 0.5, 1))
      pose.y += Math.max(0, layer.y + rise - pose.y) * lift
      pose.z = MathUtils.lerp(pose.z, -0.14, lift)
      pose.pitch = MathUtils.lerp(pose.pitch, -0.08, lift)
      return pose
    }
    case 'reorder': {
      const arc = ease(t, 0, 0.28) * (1 - ease(t, 0.72, 1))
      pose.x = MathUtils.lerp(pose.x, motion.laneX, arc)
      pose.z = MathUtils.lerp(pose.z, motion.laneZ, arc)
      pose.roll = MathUtils.lerp(pose.roll, -Math.sign(side) * 0.065, arc)
      return pose
    }
    case 'leave': {
      const shrink = ease(t, 0.29, 1)
      return {
        x: MathUtils.lerp(start.x, 1.47, drift),
        y: start.y + 0.37 * drift + carry,
        z: MathUtils.lerp(start.z, 0.44, drift),
        pitch: MathUtils.lerp(start.pitch, 0.12, drift),
        roll: MathUtils.lerp(start.roll, -0.24, drift),
        scale: MathUtils.lerp(start.scale, 0.06, shrink),
      }
    }
    default:
      return pose
  }
}

function Ingredient({
  item,
  selected,
  reducedMotion,
  onSelect,
  onExited,
}: {
  item: AnimatedLayer
  selected: boolean
  reducedMotion: boolean
  onSelect: SceneProps['onSelect']
  onExited: (item: AnimatedLayer) => void
}) {
  const invalidate = useThree((state) => state.invalidate)
  const camera = useThree((state) => state.camera)
  const groupRef = useRef<Group>(null)
  const motion = useRef<LayerMotion | null>(null)
  const exiting = item.animation.kind === 'leave'
  const model = useMemo(() => {
    const object = getIngredientModel(item.ingredientId)
    object.traverse((node) => {
      if (node instanceof Mesh) {
        node.castShadow = true
        node.receiveShadow = true
      }
    })
    return object
  }, [item.ingredientId])

  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group) return

    const previous = motion.current
    const hiddenExit = exiting && previous && !group.visible
    const entering = !previous && item.animation.kind === 'arrive'
    const start = entering ? startingPose(item) : previous ? getPose(group) : atRest(item.y)
    const delay = entering ? item.animation.delay ?? 0 : 0
    const stationary = item.animation.kind === 'shift'
      && Math.abs(start.y - item.y) < 0.0005
      && Math.max(Math.abs(start.x), Math.abs(start.z), Math.abs(start.pitch), Math.abs(start.roll), Math.abs(start.scale - 1)) < 0.0005
    const alreadyFinished = previous?.item === item && !previous.playing
    const playing = !reducedMotion && !stationary && !alreadyFinished && !hiddenExit
    const side = item.animation.kind === 'reorder' ? item.animation.side ?? 0 : 0
    const heading = Math.atan2(camera.position.x, camera.position.z)
    const across = Math.sign(side) * 0.39
    const depth = Math.sign(side) * Math.sqrt(Math.max(0, side ** 2 - across ** 2))
    motion.current = {
      item,
      start,
      laneX: Math.cos(heading) * across + Math.sin(heading) * depth,
      laneZ: -Math.sin(heading) * across + Math.cos(heading) * depth,
      elapsed: 0,
      delay,
      incomingSpeed: MathUtils.clamp(previous?.speed ?? 0, -2.1, 2.1),
      speed: 0,
      playing,
    }
    group.visible = playing ? delay === 0 : !exiting
    applyPose(group, playing ? start : atRest(item.y))
    if (hiddenExit) queueMicrotask(() => onExited(item))
    invalidate()
  }, [camera, item, exiting, invalidate, onExited, reducedMotion])

  useFrame((_, delta) => {
    const group = groupRef.current
    const state = motion.current
    if (!group || !state?.playing) return

    const dt = Math.min(delta, 0.05)
    state.elapsed += dt
    const t = MathUtils.clamp((state.elapsed - state.delay) / item.animation.duration, 0, 1)
    if (t >= 1) {
      state.playing = false
      state.speed = 0
      group.visible = !exiting
      if (exiting) onExited(item)
      else applyPose(group, atRest(item.y))
      return
    }
    if (t > 0) {
      const next = movingPose(item, state, t)
      state.speed = dt > 0 ? (next.y - group.position.y) / dt : 0
      applyPose(group, next)
      group.visible = true
    }
    invalidate()
  })

  function select(event: ThreeEvent<MouseEvent>) {
    if (exiting || !groupRef.current?.visible || event.delta > 6) return
    event.stopPropagation()
    onSelect(item.id)
  }

  return (
    <group ref={groupRef} onClick={select}>
      <primitive object={model} dispose={null} />
      {selected && !exiting && (
        <mesh position={[0, Math.min(item.height * 0.6, 0.18), 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.34, 0.01, 6, 72]} />
          <meshBasicMaterial color="#ffc63d" transparent opacity={0.76} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

function entry(layer: PlacedLayer, index: number, assembling: boolean, handoff = 0): AnimatedLayer {
  if (layer.id === 'bun-bottom') return { ...layer, animation: stationaryAnimation }
  const top = layer.id === 'bun-top'
  const side = top || index % 2 !== 0 ? 1 : -1
  return {
    ...layer,
    animation: {
      kind: 'arrive',
      duration: top ? 0.64 : 0.53,
      delay: handoff + (assembling ? Math.min(index * 0.075, 0.49) : 0.1),
      rise: top ? 0.86 : assembling ? 0.62 : 0.39,
      side: side * (top ? 0.2 : assembling ? 0.45 : 0.86),
    },
  }
}

function IngredientAssembly({
  placed,
  selectedId,
  onSelect,
  assemblyKey,
  reducedMotion,
}: Pick<SceneProps, 'selectedId' | 'onSelect' | 'assemblyKey' | 'reducedMotion'> & {
  placed: PlacedLayer[]
}) {
  const [rendered, setRendered] = useState(() => placed.map((layer, index) => entry(layer, index, true)))
  const previousAssemblyKey = useRef(assemblyKey)

  useLayoutEffect(() => {
    const intro = previousAssemblyKey.current !== assemblyKey
    previousAssemblyKey.current = assemblyKey
    const liveIds = new Set(placed.map((layer) => layer.id))
    setRendered((previous) => {
      const previousById = new Map(previous.map((layer) => [layer.id, layer]))
      const previousOrder = previous.filter((layer) => layer.animation.kind !== 'leave' && liveIds.has(layer.id))
      const previousRank = new Map(previousOrder.map((layer, index) => [layer.id, index]))
      const nextOrder = placed.filter((layer) => previousRank.has(layer.id))
      const nextRank = new Map(nextOrder.map((layer, index) => [layer.id, index]))
      const isAdded = placed.some((layer) => !previousRank.has(layer.id))
      const replacing = intro && previous.some((layer) => !liveIds.has(layer.id) && layer.animation.kind !== 'leave')
      let newIndex = 0
      const active = placed.map((layer, index): AnimatedLayer => {
        const current = previousById.get(layer.id)
        if (!current) {
          const handoff = intro ? (replacing ? 0.14 : 0) : Math.min(newIndex * 0.045, 0.16)
          newIndex += 1
          return entry(layer, index, intro, handoff)
        }
        if (layer.id === 'bun-top' && isAdded) {
          return { ...layer, animation: { kind: 'open', duration: intro ? 1.12 : 0.63, rise: 0.43 } }
        }
        const move = (nextRank.get(layer.id) ?? 0) - (previousRank.get(layer.id) ?? 0)
        if (move !== 0) {
          const laneDistance = Math.min(1.34 + Math.abs(move) * 0.04, 1.52)
          return { ...layer, animation: { kind: 'reorder', duration: 0.59, side: Math.sign(move) * laneDistance } }
        }
        if (layer.y === current.y && layer.ingredientId === current.ingredientId && current.animation.kind !== 'leave') return current
        return { ...layer, animation: stationaryAnimation }
      })
      const leaving = reducedMotion ? [] : previous
        .filter((layer) => !liveIds.has(layer.id))
        .map((layer) => layer.animation.kind === 'leave' ? layer : { ...layer, animation: exitAnimation })
      const next = [...active, ...leaving]
      return next.length === previous.length && next.every((layer, index) => layer === previous[index]) ? previous : next
    })
  }, [placed, assemblyKey, reducedMotion])

  const removeExited = useCallback((item: AnimatedLayer) => {
    setRendered((previous) => previous.filter((layer) => layer !== item))
  }, [])

  return rendered.map((item) => (
    <Ingredient
      key={item.id}
      item={item}
      onSelect={onSelect}
      selected={selectedId === item.id}
      onExited={removeExited}
      reducedMotion={reducedMotion}
    />
  ))
}

function ironTexture() {
  const width = 128
  const data = new Uint8Array(width * width * 4)
  let seed = 0x53de847b
  for (let index = 0; index < width * width; index += 1) {
    seed = Math.imul(seed, 1664525) + 1013904223
    const grain = 122 + ((seed >>> 22) & 95)
    data.set([grain, grain, grain, 255], index * 4)
  }
  const map = new DataTexture(data, width, width, RGBAFormat)
  map.wrapS = RepeatWrapping
  map.wrapT = RepeatWrapping
  map.magFilter = LinearFilter
  map.minFilter = LinearMipmapLinearFilter
  map.generateMipmaps = true
  map.repeat.set(3, 3)
  map.needsUpdate = true
  return map
}

const grillRibs = Array.from({ length: 15 }, (_, index) => {
  const offset = (index - 7) * 0.214
  return { offset, length: 2 * Math.sqrt(1.665 ** 2 - offset ** 2) }
})

const glowVertex = /* glsl */ `
  varying vec2 uvPosition;
  void main() {
    uvPosition = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const glowFragment = /* glsl */ `
  varying vec2 uvPosition;
  void main() {
    float radius = length(uvPosition - vec2(0.5));
    float glow = (1.0 - smoothstep(0.12, 0.50, radius)) * 0.25;
    gl_FragColor = vec4(0.30, 0.78, 0.68, glow);
  }
`

function GrillStage() {
  const bumpMap = useMemo(ironTexture, [])
  const ribsRef = useRef<InstancedMesh>(null)
  useEffect(() => () => bumpMap.dispose(), [bumpMap])
  useLayoutEffect(() => {
    const ribs = ribsRef.current
    if (!ribs) return
    const shape = new Object3D()
    for (const [index, { offset, length }] of grillRibs.entries()) {
      shape.position.set(offset, -0.038, 0)
      shape.scale.z = length
      shape.updateMatrix()
      ribs.setMatrixAt(index, shape.matrix)
    }
    ribs.instanceMatrix.needsUpdate = true
    ribs.computeBoundingSphere()
  }, [])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.37, 0]}>
        <planeGeometry args={[8.5, 8.5]} />
        <shaderMaterial
          vertexShader={glowVertex}
          fragmentShader={glowFragment}
          transparent
          depthWrite={false}
        />
      </mesh>
      <mesh receiveShadow position={[0, -0.235, 0]}>
        <cylinderGeometry args={[1.84, 1.69, 0.24, 100]} />
        <meshStandardMaterial color="#0f2f2d" roughness={0.83} metalness={0.32} bumpMap={bumpMap} bumpScale={0.032} />
      </mesh>
      <mesh receiveShadow position={[0, -0.13, 0]}>
        <cylinderGeometry args={[1.86, 1.89, 0.078, 100]} />
        <meshStandardMaterial color="#2c4f4a" roughness={0.71} metalness={0.44} bumpMap={bumpMap} bumpScale={0.022} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.081, 0]}>
        <circleGeometry args={[1.77, 100]} />
        <meshStandardMaterial color="#143735" roughness={0.89} metalness={0.27} bumpMap={bumpMap} bumpScale={0.029} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.084, 0]}>
        <torusGeometry args={[1.798, 0.031, 9, 100]} />
        <meshStandardMaterial color="#3f6862" roughness={0.57} metalness={0.53} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.245, 0]}>
        <torusGeometry args={[1.799, 0.012, 7, 100]} />
        <meshStandardMaterial color="#3f8a7e" emissive="#0b3a33" emissiveIntensity={0.29} roughness={0.54} metalness={0.52} />
      </mesh>
      <group rotation={[0, -0.21, 0]}>
        <instancedMesh ref={ribsRef} args={[undefined, undefined, grillRibs.length]} receiveShadow>
          <boxGeometry args={[0.099, 0.075, 1]} />
          <meshStandardMaterial color="#28514c" roughness={0.78} metalness={0.44} bumpMap={bumpMap} bumpScale={0.021} />
        </instancedMesh>
      </group>
    </group>
  )
}

const sparkVertex = /* glsl */ `
  uniform float elapsed;
  uniform float resolution;
  varying float opacity;
  varying float hue;

  void main() {
    float start = position.y;
    float lifetime = 0.58 + 0.26 * position.z;
    float progress = clamp((elapsed - start) / lifetime, 0.0, 1.0);
    float angle = position.x + progress * (0.15 + position.z * 0.2);
    float radius = 1.34 + position.z * 0.57 + progress * 0.6;
    vec3 point = vec3(
      cos(angle) * radius,
      0.07 + progress * (0.76 + position.z * 1.25),
      sin(angle) * radius
    );
    vec4 view = modelViewMatrix * vec4(point, 1.0);
    opacity = smoothstep(0.0, 0.15, progress) * pow(1.0 - progress, 1.6);
    hue = position.z;
    gl_PointSize = (7.0 + hue * 11.0) * resolution / max(2.0, -view.z);
    gl_Position = projectionMatrix * view;
  }
`

const sparkFragment = /* glsl */ `
  varying float opacity;
  varying float hue;
  void main() {
    float radius = distance(gl_PointCoord, vec2(0.5));
    float alpha = (1.0 - smoothstep(0.06, 0.52, radius)) * opacity;
    gl_FragColor = vec4(1.0, 0.29 + hue * 0.29, 0.06 + hue * 0.10, alpha);
  }
`

function Embers({ assemblyKey, isMobile }: { assemblyKey: number; isMobile: boolean }) {
  const { invalidate, viewport } = useThree()
  const elapsed = useRef(0)
  const material = useRef<ShaderMaterial>(null)
  const uniforms = useMemo(() => ({
    elapsed: { value: 0 },
    resolution: { value: viewport.dpr },
  }), [viewport.dpr])
  const points = useMemo(() => {
    const count = isMobile ? 19 : 36
    return Float32Array.from({ length: count * 3 }, (_, index) => {
      const point = Math.floor(index / 3)
      switch (index % 3) {
        case 0:
          return point * 2.399963
        case 1:
          return ((point * 17) % 23) / 64
        default:
          return ((point * 37) % 41) / 41
      }
    })
  }, [isMobile])

  useLayoutEffect(() => {
    elapsed.current = 0
    invalidate()
  }, [assemblyKey, invalidate])

  useFrame((_, delta) => {
    if (!material.current || elapsed.current >= 1.28) return
    elapsed.current += Math.min(delta, 0.034)
    material.current.uniforms.elapsed.value = elapsed.current
    invalidate()
  })

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[points, 3]} />
      </bufferGeometry>
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={sparkVertex}
        fragmentShader={sparkFragment}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  )
}

// Tiga panel cahaya studio, dipanggang sekali ke peta lingkungan (tanpa library tambahan)
const STUDIO_PANELS: ReadonlyArray<readonly [color: string, intensity: number, position: readonly [number, number, number], size: readonly [number, number]]> = [
  ['#ffe9d3', 1.8, [-3, 4, 2], [3.7, 2.4]],
  ['#f8f2de', 0.82, [3, 2, 2], [2, 2]],
  ['#ffd27a', 2.1, [0, 2, -4], [4, 2]],
]

const StudioEnvironment = memo(function StudioEnvironment() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    const studio = new Scene()
    const geometry = new PlaneGeometry(1, 1)
    const materials: MeshBasicMaterial[] = []
    for (const [color, intensity, position, size] of STUDIO_PANELS) {
      const material = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity), side: DoubleSide, toneMapped: false })
      const panel = new Mesh(geometry, material)
      panel.position.set(...position)
      panel.scale.set(size[0], size[1], 1)
      panel.lookAt(0, 0, 0)
      studio.add(panel)
      materials.push(material)
    }
    const generator = new PMREMGenerator(gl)
    const target = generator.fromScene(studio, 0, 0.1, 100, { size: 128 })
    scene.environment = target.texture
    scene.environmentIntensity = 0.55
    invalidate()
    return () => {
      scene.environment = null
      target.dispose()
      generator.dispose()
      geometry.dispose()
      materials.forEach((material) => material.dispose())
    }
  }, [gl, scene, invalidate])

  return null
})

function Lighting({ isMobile, height }: { isMobile: boolean; height: number }) {
  const shadowSize = isMobile ? 512 : 1024
  const lightHeight = Math.max(6.2, height + 3.9)
  const keyLight = useRef<DirectionalLight>(null)
  useLayoutEffect(() => {
    keyLight.current?.shadow.camera.updateProjectionMatrix()
  }, [height])

  return (
    <>
      <hemisphereLight args={['#fff3e0', '#2f5a55', 1.45]} />
      <directionalLight
        ref={keyLight}
        position={[-4.4, lightHeight, 3.7]}
        color="#ffe3c0"
        intensity={2.56}
        castShadow
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={Math.max(4.5, height + 1)}
        shadow-camera-bottom={-3}
        shadow-camera-near={0.1}
        shadow-camera-far={Math.max(20, lightHeight + 10)}
        shadow-normalBias={0.016}
      />
      <directionalLight position={[3.4, 2.5, 4.5]} color="#fff8ef" intensity={0.89} />
      <pointLight position={[1.3, 2.1, -3]} color="#ffc86b" intensity={18.5} distance={9} decay={2} />
      <StudioEnvironment />
    </>
  )
}

function SceneLifecycle({ onUnavailable, onReady }: { onUnavailable: () => void; onReady: () => void }) {
  const canvas = useThree((state) => state.gl.domElement)
  useEffect(() => {
    function onContextLost(event: Event) {
      event.preventDefault()
      onUnavailable()
    }
    canvas.addEventListener('webglcontextlost', onContextLost)
    onReady()
    return () => canvas.removeEventListener('webglcontextlost', onContextLost)
  }, [canvas, onReady, onUnavailable])
  return null
}

class SceneBoundary extends Component<
  { onUnavailable: () => void; children: ReactNode },
  { unavailable: boolean }
> {
  state = { unavailable: false }

  static getDerivedStateFromError() {
    return { unavailable: true }
  }

  componentDidCatch() {
    this.props.onUnavailable()
  }

  render() {
    return this.state.unavailable ? null : this.props.children
  }
}

export default function BurgerScene(props: SceneProps) {
  const { layers, exploded, reducedMotion, isMobile, assemblyKey, cameraCommand, onUnavailable } = props
  const [ready, setReady] = useState(false)
  const onReady = useCallback(() => setReady(true), [])
  const { onSceneReady } = props
  useEffect(() => { if (ready) onSceneReady?.() }, [ready, onSceneReady])
  const { placed, height } = useMemo(() => {
    let y = 0
    const gap = exploded ? EXPLODED_GAP : 0
    const placed = layers.map((layer) => {
      const positioned = { ...layer, y }
      y += layer.height + gap
      return positioned
    })
    return { placed, height: Math.max(0.7, y - gap) }
  }, [layers, exploded])

  return (
    <div className="burger-canvas">
      <SceneBoundary onUnavailable={onUnavailable}>
        <Canvas
          shadows
          frameloop="demand"
          dpr={isMobile ? [1, 1.25] : [1, 1.6]}
          performance={{ min: 0.62, max: 1, debounce: 220 }}
          camera={{ fov: FOV, near: 0.1, far: 220, position: [2.6, 2.7, 6.5] }}
          gl={{ alpha: true, antialias: !isMobile, powerPreference: 'high-performance' }}
          aria-label="Model burger interaktif"
        >
          <SceneLifecycle onUnavailable={onUnavailable} onReady={onReady} />
          <Lighting isMobile={isMobile} height={height} />
          <CameraRig
            height={height}
            command={cameraCommand}
            isMobile={isMobile}
            reducedMotion={reducedMotion}
          />
          <GrillStage />
          <IngredientAssembly
            placed={placed}
            selectedId={props.selectedId}
            onSelect={props.onSelect}
            assemblyKey={assemblyKey}
            reducedMotion={reducedMotion}
          />
          {!reducedMotion && <Embers assemblyKey={assemblyKey} isMobile={isMobile} />}
        </Canvas>
      </SceneBoundary>
      {!ready && (
        <div
          className="scene-loading"
          style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}
          role="status"
        >
          Menyiapkan panggangan…
        </div>
      )}
    </div>
  )
}
