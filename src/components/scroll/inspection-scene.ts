/**
 * The three.js side of the interactive inspection model.
 *
 * Deliberately framework-free. `InspectionModel.tsx` imports this with a dynamic `import()`
 * so three.js lands in its own chunk and never reaches the initial bundle of a page that
 * may never scroll this far — and never reaches a phone at all, which gets the still.
 *
 * Two rules this file exists to enforce:
 *
 * **No per-frame value crosses into React.** Hotspot markers are positioned by writing a
 * transform straight onto DOM nodes the component hands over. Routing projected screen
 * coordinates through `useState` would rerender the tree sixty times a second.
 *
 * **Geometry and copy have one owner.** Part names, hotspot anchors, camera poses, explode
 * offsets and the light rig all come from `inspection-flight.json` — the same file the
 * Blender script reads to build the film. A label cannot drift off the part it names,
 * because nothing here is written twice.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';

type Vec3 = [number, number, number];

type OrbitPose = { azimuth: number; elevation: number; distance: number };

export type SceneConfig = {
  asset: string;
  home: OrbitPose;
  idle: { amplitudeDeg: number; periodSeconds: number; bobMetres: number };
  scrollRotationDeg: number;
  lighting: {
    exposure: number;
    environmentIntensity: number;
    key: { position: Vec3; intensity: number; color: string };
    rim: { position: Vec3; intensity: number; distance: number; color: string };
    fill: { position: Vec3; intensity: number; color: string };
    contactShadow: { radius: number; opacity: number };
  };
  hotspots: { id: string; part: string; anchor: Vec3; camera: OrbitPose }[];
  explode: { id: string; parts: string[]; offset: Vec3 }[];
  /** Scroll-driven camera path for the hero. See `$sequence` in the manifest. */
  sequence: {
    at: number;
    beat: string | null;
    anchor: Vec3;
    camera: OrbitPose;
    dwell?: number;
    drift?: { azimuth: number; distance: number };
  }[];
  /** Projection framing. See `$framing` in the manifest. */
  framing?: { filmOffset?: number; fov?: number };
  /** Tiling detail maps that replace the stripped procedural roughness. See `$surface`. */
  surface?: {
    detail: string;
    normal: string;
    materials: Record<string, { repeat: number; roughness: number; normalScale: number }>;
  };
  /** Background, fog and ground. See `$world` in the manifest. */
  world?: {
    background: string;
    fog: { color: string; density: number };
    ground: {
      size: number;
      color: string;
      roughness: number;
      metalness: number;
      gridColor: string;
      gridSpacing: number;
      fadeRadius: number;
    };
  };
  /** Post-processing. See `$post` in the manifest. */
  post?: {
    enabled: boolean;
    bloom: { strength: number; radius: number; threshold: number };
    dof: { enabled: boolean; aperture: number; maxBlur: number; focalLength: number };
    vignette: { offset: number; darkness: number };
  };
  /** Scroll-velocity response. See `$inertia` in the manifest. */
  inertia?: {
    damping: number;
    max: number;
    stopThreshold: number;
    leanDeg: number;
    yawLeadDeg: number;
    exposureLift: number;
  };
};

/** Smoothstep. Linear interpolation between camera stops reads as a machine panning;
 *  easing each leg in and out reads as a camera operator finding the shot. */
const smooth = (t: number) => t * t * (3 - 2 * t);

export type ResolvedStop = {
  at: number;
  beat: string | null;
  anchor: THREE.Vector3;
  camera: OrbitPose;
  dwell?: number;
  drift?: { azimuth: number; distance: number };
};

/**
 * The camera pose for a scroll position. Exported so the headless motion probe can sample
 * the SAME function the page runs — a probe that reimplements the interpolation proves the
 * probe moves, not that the page does.
 *
 * Each leg is two movements, not one:
 *
 * 1. **The dwell.** For the first `dwell` fraction of the leg the camera stays with the
 *    inspection point while its copy is being read, carrying only a slow drift. This is the
 *    thing whose absence made the hero read as a slideshow of poses: a camera that never
 *    rests gives the reader nowhere to stand.
 * 2. **The travel.** The remainder eases across to the next stop, so the shot accelerates
 *    away from the point and settles into the next one.
 *
 * The dwell is deliberately a drift and not a freeze. The film measured that keying an
 * identical camera at a beat's start and end left 53% of frames visually static with a
 * 19-frame dead run; carrying a slow push through the dwell fixed it. Same lesson, applied
 * here before it could happen again.
 */
export function sampleSequence(
  stops: ResolvedStop[],
  progress: number,
  out: THREE.Vector3
): OrbitPose {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  let i = 0;
  while (i < stops.length - 2 && p >= stops[i + 1].at) i += 1;
  const a = stops[i];
  const b = stops[i + 1];
  const span = Math.max(1e-4, b.at - a.at);
  const local = THREE.MathUtils.clamp((p - a.at) / span, 0, 1);

  const dwell = THREE.MathUtils.clamp(a.dwell ?? 0, 0, 0.9);
  const drift = a.drift ?? { azimuth: 0, distance: 1 };

  // Where the drift has carried the camera by the end of the dwell.
  const drifted: OrbitPose = {
    azimuth: a.camera.azimuth + drift.azimuth,
    elevation: a.camera.elevation,
    distance: a.camera.distance * drift.distance,
  };

  if (local <= dwell && dwell > 0) {
    const d = local / dwell;
    out.copy(a.anchor);
    return {
      azimuth: THREE.MathUtils.lerp(a.camera.azimuth, drifted.azimuth, d),
      elevation: THREE.MathUtils.lerp(a.camera.elevation, drifted.elevation, d),
      distance: THREE.MathUtils.lerp(a.camera.distance, drifted.distance, d),
    };
  }

  const t = smooth(THREE.MathUtils.clamp((local - dwell) / Math.max(1e-4, 1 - dwell), 0, 1));
  out.lerpVectors(a.anchor, b.anchor, t);
  return {
    azimuth: THREE.MathUtils.lerp(drifted.azimuth, b.camera.azimuth, t),
    elevation: THREE.MathUtils.lerp(drifted.elevation, b.camera.elevation, t),
    distance: THREE.MathUtils.lerp(drifted.distance, b.camera.distance, t),
  };
}

/** The beat whose copy belongs to a scroll position. */
export function beatForProgress(stops: { at: number; beat: string | null }[], progress: number) {
  let current: string | null = null;
  for (const stop of stops) {
    if (progress >= stop.at) current = stop.beat;
  }
  return current;
}

export { orbit as orbitPosition, toThree as blenderToThree };

export type SceneHandle = {
  /** 0..1 scroll progress through the pinned section. */
  setProgress(progress: number): void;
  focus(hotspotId: string | null): void;
  /** Keyboard/button rotation, in radians. Pointer drag is not the only way in. */
  nudge(deltaYaw: number): void;
  setExploded(exploded: boolean): void;
  reset(): void;
  /** Pause the render loop when the section leaves the viewport. */
  setActive(active: boolean): void;
  dispose(): void;
};

/**
 * Blender is Z-up; glTF and three.js are Y-up, and the exporter converted the geometry on
 * the way out. Every coordinate in the manifest is authored in Blender space so it matches
 * the camera beats, so every one of them has to come through here.
 */
function toThree(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[2], -v[1]);
}

/**
 * Place the camera on a sphere around the part being inspected — the same construction the
 * Blender script uses, for the same reason: hand-written XYZ positions repeatedly framed
 * the wrong thing, and a pose derived from the feature cannot.
 */
function orbit(feature: THREE.Vector3, pose: OrbitPose): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(pose.azimuth);
  const el = THREE.MathUtils.degToRad(pose.elevation);
  const horizontal = Math.cos(el) * pose.distance;
  // Built in Blender's convention, then converted, so the manifest's numbers mean the same
  // thing here as they do in the film.
  return toThree([
    feature.x + horizontal * Math.cos(az),
    -feature.z + horizontal * Math.sin(az),
    feature.y + Math.sin(el) * pose.distance,
  ] as Vec3);
}

/** A soft dark ellipse under the model. Cheaper than a shadow map and, on a transparent
 *  canvas over a dark page, more convincing than one. */
function contactShadow(radius: number, opacity: number): THREE.Mesh {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,1)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      depthWrite: false,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.001;
  return mesh;
}

/**
 * The floor the object stands on: the page's own blueprint grid, drawn into a texture and
 * faded to nothing with a radial alpha so it dissolves into the fog instead of ending at a
 * visible edge. A hard-edged ground plane is worse than no ground plane.
 */
function buildGround(cfg: NonNullable<SceneConfig['world']>['ground']): THREE.Mesh {
  const px = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = cfg.color;
  ctx.fillRect(0, 0, px, px);

  const cells = Math.max(2, Math.round(cfg.size / cfg.gridSpacing));
  const step = px / cells;
  ctx.strokeStyle = cfg.gridColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= cells; i += 1) {
    const at = Math.round(i * step) + 0.5;
    ctx.moveTo(at, 0);
    ctx.lineTo(at, px);
    ctx.moveTo(0, at);
    ctx.lineTo(px, at);
  }
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  // Alpha falls off radially so the plane has no visible border.
  const alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = alphaCanvas.height = 512;
  const actx = alphaCanvas.getContext('2d')!;
  const fade = actx.createRadialGradient(256, 256, 0, 256, 256, 256);
  const stop = THREE.MathUtils.clamp(cfg.fadeRadius / cfg.size, 0.05, 0.95);
  fade.addColorStop(0, 'rgba(255,255,255,1)');
  fade.addColorStop(stop, 'rgba(255,255,255,0.75)');
  fade.addColorStop(1, 'rgba(255,255,255,0)');
  actx.fillStyle = fade;
  actx.fillRect(0, 0, 512, 512);
  const alphaMap = new THREE.CanvasTexture(alphaCanvas);

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(cfg.size, cfg.size),
    new THREE.MeshStandardMaterial({
      map: texture,
      alphaMap,
      transparent: true,
      roughness: cfg.roughness,
      metalness: cfg.metalness,
      color: 0xffffff,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.001;
  return mesh;
}

export type CreateSceneOptions = {
  canvas: HTMLCanvasElement;
  config: SceneConfig;
  /** Marker elements keyed by hotspot id. Positioned directly, never through React state. */
  markers: Map<string, HTMLElement>;
  reducedMotion: boolean;
  onLoaded: () => void;
  onError: (reason: string) => void;
};

export async function createScene(options: CreateSceneOptions): Promise<SceneHandle | null> {
  const { canvas, config, markers, reducedMotion, onLoaded, onError } = options;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // Opaque, not transparent. The object used to float in the page's void on a fake blob
      // shadow; it now stands in its own room with a floor and fog. Opacity is also what
      // makes post-processing safe: depth of field and bloom composite against a real
      // background instead of punching holes in a transparent canvas over the page.
      alpha: false,
      powerPreference: 'high-performance',
    });
  } catch {
    // No WebGL, a blocked context, or a driver refusal. The component owns the fallback.
    onError('webgl-unavailable');
    return null;
  }

  // A lost context is not an error the page can ignore: the canvas goes blank and stays
  // blank. Fall back to the still rather than leave an empty rectangle.
  const onContextLost = (event: Event) => {
    event.preventDefault();
    onError('context-lost');
  };
  canvas.addEventListener('webglcontextlost', onContextLost);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // AgX, matching the Blender view transform the film was graded with, so the interactive
  // model and the rendered film read as the same object under the same light.
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = config.lighting.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  if (config.world) {
    scene.background = new THREE.Color(config.world.background);
    // Exponential-squared fog: distance reads without a hard horizon line.
    scene.fog = new THREE.FogExp2(config.world.fog.color, config.world.fog.density);
  }
  // `filmOffset` is the three.js analogue of the Blender camera shift the film uses: it
  // slides the projection sideways so the subject sits right of centre, clear of the copy
  // column. Moving the object itself would break the orbit maths, and changing the lens
  // would only make it bigger in the middle — still behind the headline.
  const camera = new THREE.PerspectiveCamera(config.framing?.fov ?? 38, 1, 0.05, 60);
  camera.filmOffset = config.framing?.filmOffset ?? 0;

  // Neutral studio reflections only. The mood comes from the three explicit lights below;
  // this exists so the brass and steel have something to reflect, which is the exact
  // failure that made EEVEE unusable for the film.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = config.lighting.environmentIntensity;

  const { key, rim, fill } = config.lighting;
  const keyLight = new THREE.DirectionalLight(new THREE.Color(key.color), key.intensity);
  keyLight.position.set(...key.position);
  const rimLight = new THREE.PointLight(
    new THREE.Color(rim.color),
    rim.intensity,
    rim.distance,
    2
  );
  rimLight.position.set(...rim.position);
  const fillLight = new THREE.DirectionalLight(new THREE.Color(fill.color), fill.intensity);
  fillLight.position.set(...fill.position);
  scene.add(keyLight, rimLight, fillLight);

  const model = new THREE.Group();
  const spin = new THREE.Group();
  spin.add(model);
  scene.add(spin);
  scene.add(contactShadow(config.lighting.contactShadow.radius, config.lighting.contactShadow.opacity));
  if (config.world) scene.add(buildGround(config.world.ground));

  // ------------------------------------------------------------------ load
  const gltf = await new Promise<{ scene: THREE.Group } | null>((resolve) => {
    new GLTFLoader().load(
      config.asset,
      (result) => resolve(result as unknown as { scene: THREE.Group }),
      undefined,
      () => resolve(null)
    );
  });

  if (!gltf) {
    canvas.removeEventListener('webglcontextlost', onContextLost);
    envRT.texture.dispose();
    pmrem.dispose();
    renderer.dispose();
    onError('asset-failed');
    return null;
  }

  model.add(gltf.scene);

  // ---- surface detail -------------------------------------------------------
  // Put back the micro-variation glTF could not carry. One tiling pair, applied to every
  // material at a per-material repeat, because a scratch on a 0.42 m cylinder and a scratch
  // on a 27 mm bezel are not the same size.
  const ownedTextures: THREE.Texture[] = [];
  if (config.surface) {
    const loader = new THREE.TextureLoader();
    const detail = loader.load(config.surface.detail);
    const normal = loader.load(config.surface.normal);
    for (const tex of [detail, normal]) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      ownedTextures.push(tex);
    }
    gltf.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const raw of materials) {
        const material = raw as THREE.MeshStandardMaterial;
        const tuning = config.surface!.materials[material.name];
        if (!tuning) continue;
        // Each material needs its own texture instance: `repeat` lives on the texture, so
        // sharing one would make the last material win for everybody.
        const d = detail.clone();
        const n = normal.clone();
        d.needsUpdate = n.needsUpdate = true;
        d.repeat.set(tuning.repeat, tuning.repeat);
        n.repeat.set(tuning.repeat, tuning.repeat);
        ownedTextures.push(d, n);
        material.roughnessMap = d;
        material.normalMap = n;
        material.normalScale = new THREE.Vector2(tuning.normalScale, tuning.normalScale);
        material.roughness = tuning.roughness;
        material.needsUpdate = true;
      }
    });
  }

  // Centre the object horizontally and stand it on y=0, so the contact shadow sits under
  // it and rotation happens around the object rather than around the world origin.
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const centre = bounds.getCenter(new THREE.Vector3());
  gltf.scene.position.x -= centre.x;
  gltf.scene.position.z -= centre.z;
  gltf.scene.position.y -= bounds.min.y;
  const height = bounds.max.y - bounds.min.y;
  const pivot = new THREE.Vector3(0, height / 2, 0);

  // Resolve explode groups once. Missing names are a manifest bug, not a runtime condition
  // to paper over — the GLB test asserts every one of them exists.
  const explodeGroups = config.explode.map((group) => ({
    offset: toThree(group.offset),
    objects: group.parts
      .map((name) => gltf.scene.getObjectByName(name))
      .filter((obj): obj is THREE.Object3D => Boolean(obj)),
  }));
  const restPositions = new Map<THREE.Object3D, THREE.Vector3>();
  for (const group of explodeGroups) {
    for (const obj of group.objects) restPositions.set(obj, obj.position.clone());
  }

  const hotspotAnchors = new Map(
    config.hotspots.map((h) => [h.id, toThree(h.anchor).sub(new THREE.Vector3(centre.x, bounds.min.y, centre.z))])
  );

  // Sequence stops, resolved once into the same model space the hotspot anchors use.
  const originOffset = new THREE.Vector3(centre.x, bounds.min.y, centre.z);
  const stops: ResolvedStop[] = (config.sequence ?? []).map((stop) => ({
    at: stop.at,
    beat: stop.beat,
    anchor: toThree(stop.anchor).sub(originOffset),
    camera: stop.camera,
    dwell: stop.dwell,
    drift: stop.drift,
  }));
  const legAnchor = new THREE.Vector3();

  // ------------------------------------------------------------------ post-processing
  //
  // Order matters and is not arbitrary: render -> bloom -> depth of field -> vignette ->
  // output. `OutputPass` must be last because that is where tone mapping and the colour-space
  // conversion happen once the composer owns the pipeline; leaving them on the renderer as
  // well double-applies them and washes the image out.
  //
  // Depth of field is the single biggest contributor to a product reading as photographed
  // rather than rendered. Its focus distance is driven every frame from the camera to the
  // CURRENT inspection anchor, so the part being inspected is always the sharp thing and
  // everything else falls away.
  let composer: EffectComposer | null = null;
  let bokeh: BokehPass | null = null;
  if (config.post?.enabled) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloomCfg = config.post.bloom;
    composer.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(1, 1),
        bloomCfg.strength,
        bloomCfg.radius,
        // A high threshold on purpose: bloom is here for the brass and the accent rim, not
        // to make the whole page glow.
        bloomCfg.threshold
      )
    );

    if (config.post.dof.enabled) {
      bokeh = new BokehPass(scene, camera, {
        focus: 1.0,
        aperture: config.post.dof.aperture,
        maxblur: config.post.dof.maxBlur,
      });
      composer.addPass(bokeh);
    }

    const vignette = new ShaderPass(VignetteShader);
    vignette.uniforms.offset.value = config.post.vignette.offset;
    vignette.uniforms.darkness.value = config.post.vignette.darkness;
    composer.addPass(vignette);

    composer.addPass(new OutputPass());
  }

  // ------------------------------------------------------------------ state
  const homePosition = orbit(pivot, config.home);

  // Start ON the sequence's first stop, not at `home`. Seeding from home meant the very
  // first thing a visitor saw was the camera easing out of a pose that is not in the
  // journey at all — an unintended opening swoop, and a wrong first frame for anyone who
  // never scrolls.
  const seedAnchor = new THREE.Vector3();
  const seedPose = stops.length > 1 ? sampleSequence(stops, 0, seedAnchor) : config.home;
  if (stops.length <= 1) seedAnchor.copy(pivot);
  const seedPosition = orbit(seedAnchor, seedPose);

  camera.position.copy(seedPosition);
  camera.lookAt(seedAnchor);

  let targetCamera = seedPosition.clone();
  let targetLookAt = seedAnchor.clone();
  const currentLookAt = seedAnchor.clone();


  let progress = 0;
  // Scroll velocity, smoothed. The object leans into the direction of travel and settles
  // back when scrolling stops, which is most of what separates an object with weight from a
  // picture of an object. Raw delta is far too jittery to drive a transform directly.
  let previousProgress = 0;
  let rawVelocity = 0;
  let velocity = 0;
  let dragYaw = 0;
  let dragPitch = 0;
  let scrollYaw = 0;
  let explodeAmount = 0;
  let explodeTarget = 0;
  let focused: string | null = null;
  let active = true;
  let disposed = false;
  const clock = new THREE.Clock();

  const projected = new THREE.Vector3();

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    renderer.setSize(rect.width, rect.height, false);
    composer?.setSize(rect.width, rect.height);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  // ------------------------------------------------------------------ pointer
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (event: PointerEvent) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    dragYaw += (event.clientX - lastX) * 0.006;
    // Clamped so the model can never be driven under the floor or flipped over, which
    // would leave a visitor stranded with no way to tell which way is up.
    dragPitch = THREE.MathUtils.clamp(dragPitch + (event.clientY - lastY) * 0.004, -0.5, 0.55);
    lastX = event.clientX;
    lastY = event.clientY;
    // A drag is an explicit request to look somewhere; keeping a hotspot camera locked on
    // would fight the pointer.
    focused = null;
  };
  const endDrag = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = 'grab';
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'pan-y';

  // ------------------------------------------------------------------ loop
  function frame() {
    if (disposed) return;
    const elapsed = clock.getElapsedTime();
    const delta = Math.min(clock.getDelta(), 0.1);
    // Frame-rate independent easing: the same visual settle on a 60 Hz and a 144 Hz screen.
    const ease = 1 - Math.pow(0.0001, delta);

    if (focused) {
      const hotspot = config.hotspots.find((h) => h.id === focused);
      const anchor = hotspotAnchors.get(focused);
      if (hotspot && anchor) {
        targetCamera = orbit(anchor, hotspot.camera);
        targetLookAt = anchor;
      }
      // Ease the object back to its home orientation so the named part is actually facing
      // the camera when it arrives.
      dragYaw += (0 - dragYaw) * ease;
      dragPitch += (0 - dragPitch) * ease;
    } else if (stops.length > 1) {
      // Fly the sequence. Scroll progress selects the leg and smoothstep eases within it.
      // BOTH the camera pose and the look-at point move — a camera that travels while
      // staring at one fixed point reads as a pan, not as an inspection.
      const pose = sampleSequence(stops, progress, legAnchor);
      targetCamera = orbit(legAnchor, pose);
      targetLookAt = legAnchor;
    } else {
      targetCamera = homePosition;
      targetLookAt = pivot;
    }

    camera.position.lerp(targetCamera, ease);
    currentLookAt.lerp(targetLookAt, ease);
    camera.lookAt(currentLookAt);

    const idleYaw = reducedMotion
      ? 0
      : THREE.MathUtils.degToRad(config.idle.amplitudeDeg) *
        Math.sin((elapsed / config.idle.periodSeconds) * Math.PI * 2);
    const idleBob = reducedMotion
      ? 0
      : config.idle.bobMetres * Math.sin((elapsed / config.idle.periodSeconds) * Math.PI * 2 + 1.1);

    // ---- inertia -------------------------------------------------------------
    const inertia = config.inertia;
    if (inertia && !reducedMotion) {
      velocity = THREE.MathUtils.lerp(velocity, rawVelocity, inertia.damping);
      if (Math.abs(velocity) < inertia.stopThreshold) velocity = 0;
      velocity = THREE.MathUtils.clamp(velocity, -inertia.max, inertia.max);
      rawVelocity *= 0.82;
    } else {
      velocity = 0;
    }
    const swing = inertia ? velocity / Math.max(1e-6, inertia.max) : 0;

    spin.rotation.y =
      dragYaw + scrollYaw + idleYaw + THREE.MathUtils.degToRad((inertia?.yawLeadDeg ?? 0) * swing);
    // Lean is on Z: the object tips the way it is being dragged through space, like a hand
    // carrying it. Pitch stays owned by the pointer so the two never fight.
    spin.rotation.z = THREE.MathUtils.degToRad((inertia?.leanDeg ?? 0) * swing);
    spin.rotation.x = dragPitch;
    spin.position.y = idleBob;
    // A fast scroll lifts exposure very slightly, the way a real lens gains a touch of
    // flare through a move. Small on purpose: it must read as light, not as a flicker.
    renderer.toneMappingExposure =
      config.lighting.exposure * (1 + (inertia?.exposureLift ?? 0) * Math.abs(swing));

    explodeAmount += (explodeTarget - explodeAmount) * ease;
    if (Math.abs(explodeTarget - explodeAmount) > 0.0005) {
      for (const group of explodeGroups) {
        for (const obj of group.objects) {
          const rest = restPositions.get(obj)!;
          obj.position.copy(rest).addScaledVector(group.offset, explodeAmount);
        }
      }
    }

    if (bokeh) {
      // Focus on whatever the camera is currently looking at, so the inspected part is sharp
      // and the rest of the object falls off. A fixed focus distance would blur the subject
      // the moment the camera pushed in.
      const focusDistance = camera.position.distanceTo(currentLookAt);
      (bokeh.uniforms as Record<string, { value: number }>).focus.value = focusDistance;
    }
    if (composer) composer.render();
    else renderer.render(scene, camera);

    // Position the hotspot markers by projecting their anchors. Written straight to the
    // DOM node: this runs every frame and must never touch React state.
    for (const hotspot of config.hotspots) {
      const element = markers.get(hotspot.id);
      const anchor = hotspotAnchors.get(hotspot.id);
      if (!element || !anchor) continue;
      projected.copy(anchor).applyMatrix4(spin.matrixWorld).project(camera);
      const rect = canvas.getBoundingClientRect();
      const x = (projected.x * 0.5 + 0.5) * rect.width;
      const y = (-projected.y * 0.5 + 0.5) * rect.height;
      const behind = projected.z > 1;
      element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      element.style.opacity = behind ? '0' : '1';
      // A marker facing away from the viewer must not stay clickable or tabbable.
      element.style.pointerEvents = behind ? 'none' : 'auto';
      element.toggleAttribute('inert', behind);
    }
  }

  renderer.setAnimationLoop(frame);
  onLoaded();

  return {
    setProgress(next) {
      rawVelocity += next - previousProgress;
      previousProgress = next;
      progress = next;
      scrollYaw = THREE.MathUtils.degToRad(config.scrollRotationDeg) * (next - 0.5);
    },
    focus(hotspotId) {
      focused = hotspotId;
    },
    nudge(deltaYaw) {
      dragYaw += deltaYaw;
      focused = null;
    },
    setExploded(exploded) {
      explodeTarget = exploded ? 1 : 0;
    },
    reset() {
      dragYaw = 0;
      dragPitch = 0;
      focused = null;
      explodeTarget = 0;
    },
    setActive(next) {
      if (next === active) return;
      active = next;
      // Stopping the loop entirely is the point: an idle WebGL canvas left running off
      // screen keeps a GPU busy for nothing.
      renderer.setAnimationLoop(next ? frame : null);
      if (next) clock.getDelta();
    },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);

      // Removing objects from a scene does not free GPU memory; each owned geometry,
      // material and texture has to be disposed by hand.
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const material = mesh.material;
        for (const entry of Array.isArray(material) ? material : [material]) {
          if (!entry) continue;
          for (const value of Object.values(entry)) {
            if (value instanceof THREE.Texture) value.dispose();
          }
          entry.dispose();
        }
      });
      composer?.dispose();
      for (const tex of ownedTextures) tex.dispose();
      envRT.texture.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
