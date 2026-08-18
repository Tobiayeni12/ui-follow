import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ParticleBurst } from './particles.js';
import { THEMES, DEFAULT_THEME, resolveTheme } from './themes.js';

const CYAN = '#25F4EE';
const PINK = '#FE2C55';

// Typeface fonts bundled with three.js (served from our own /vendor/three
// static route — nothing is fetched from a third-party CDN).
const THREE_FONTS = {
  'helvetiker-bold': '/vendor/three/examples/fonts/helvetiker_bold.typeface.json',
  'helvetiker-regular': '/vendor/three/examples/fonts/helvetiker_regular.typeface.json',
  'optimer-bold': '/vendor/three/examples/fonts/optimer_bold.typeface.json',
  'optimer-regular': '/vendor/three/examples/fonts/optimer_regular.typeface.json',
  'gentilis-bold': '/vendor/three/examples/fonts/gentilis_bold.typeface.json',
  'gentilis-regular': '/vendor/three/examples/fonts/gentilis_regular.typeface.json',
  'droid-sans-bold': '/vendor/three/examples/fonts/droid/droid_sans_bold.typeface.json',
  'droid-serif-bold': '/vendor/three/examples/fonts/droid/droid_serif_bold.typeface.json',
  'droid-sans-mono-regular': '/vendor/three/examples/fonts/droid/droid_sans_mono_regular.typeface.json',
};
const DEFAULT_FONT_KEY = 'helvetiker-bold';

// If a real update pushes the display more than this many followers behind
// target, we switch from per-unit "flip" animations to one accelerated
// count-up tween — this is the "sensible protection" against a big jump
// spawning hundreds of individual animations.
const STEP_THRESHOLD = 5;

const clock = new THREE.Clock();

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}
function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function formatCount(n) {
  return Math.round(n).toLocaleString('en-US');
}

// Deterministic pseudo-noise in [0, 1], purely a function of world-space X —
// shared by the "melting" geometry sag and its matching drip placement so
// drips always start exactly where the surface actually dips down.
function meltNoise(x) {
  return 0.5 + 0.5 * (Math.sin(x * 3.3 + 0.6) * 0.6 + Math.sin(x * 7.1 + 2.1) * 0.4);
}

// Number meshes may have either a single material or a [front/back, side]
// array (two-tone themes, e.g. red front face + blue bevel edge) — these
// helpers let the animation code treat both cases uniformly.
function forEachMaterial(mesh, fn) {
  if (Array.isArray(mesh.material)) mesh.material.forEach(fn);
  else fn(mesh.material);
}
function setMeshOpacity(mesh, value) {
  forEachMaterial(mesh, (m) => {
    m.opacity = value;
  });
}
function disposeMesh(mesh) {
  if (!mesh) return;
  mesh.geometry.dispose();
  forEachMaterial(mesh, (m) => m.dispose());
}

function makeGlowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(180,255,250,0.55)');
  g.addColorStop(1, 'rgba(180,255,250,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Generates a tileable red-and-white spiderweb pattern for the "Spider-Man"
// theme — radial threads + wobbly concentric rings, classic comic-book web.
function makeWebTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#D71921';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.75;
  const spokes = 12;

  for (let i = 0; i < spokes; i++) {
    const angle = (i / spokes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
    ctx.stroke();
  }

  const rings = 6;
  for (let r = 1; r <= rings; r++) {
    const radius = (r / rings) * maxR;
    ctx.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const angle = (i / spokes) * Math.PI * 2;
      const wobble = radius * 0.06 * Math.sin(angle * 3 + r);
      const px = cx + Math.cos(angle) * (radius + wobble);
      const py = cy + Math.sin(angle) * (radius + wobble);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  // Canvas pixel values are sRGB-encoded (like any 2D-drawn color); without
  // this the renderer treats them as linear and the result washes out badly.
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.6, 1.6);
  tex.needsUpdate = true;
  return tex;
}

const THEME_TEXTURE_MAKERS = { 'web-red': makeWebTexture };

// Transparent-background web-strand burst used by the "Web Shot" gain
// animation — a soft glow core behind fading radial threads, meant to be
// additively blended and tinted per-theme rather than tiled onto geometry.
function makeWebSplatTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.46;

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
  glow.addColorStop(0, 'rgba(255,255,255,0.55)');
  glow.addColorStop(0.4, 'rgba(255,255,255,0.18)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  const spokes = 10;
  for (let i = 0; i < spokes; i++) {
    const angle = (i / spokes) * Math.PI * 2;
    const ex = cx + Math.cos(angle) * maxR;
    const ey = cy + Math.sin(angle) * maxR;
    const grad = ctx.createLinearGradient(cx, cy, ex, ey);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }

  const rings = 5;
  for (let r = 1; r <= rings; r++) {
    const radius = (r / rings) * maxR;
    const alpha = 0.85 * (1 - r / rings) + 0.1;
    ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const angle = (i / spokes) * Math.PI * 2;
      const wobble = radius * 0.05 * Math.sin(angle * 3 + r);
      const px = cx + Math.cos(angle) * (radius + wobble);
      const py = cy + Math.sin(angle) * (radius + wobble);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Procedural bat silhouette (body, two scalloped wings, ears) for the
// "Bats" horror theme's gain animation — drawn once and reused across every
// bat sprite in a burst.
function makeBatTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#050505';
  ctx.translate(size / 2, size / 2);

  ctx.beginPath();
  ctx.ellipse(0, 0, 6, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  const wing = (sign) => {
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.quadraticCurveTo(sign * 30, -22, sign * 52, -2);
    ctx.quadraticCurveTo(sign * 38, 2, sign * 26, -4);
    ctx.quadraticCurveTo(sign * 30, 10, sign * 14, 6);
    ctx.quadraticCurveTo(sign * 16, 14, sign * 4, 10);
    ctx.closePath();
    ctx.fill();
  };
  wing(1);
  wing(-1);

  const ear = (sign) => {
    ctx.beginPath();
    ctx.moveTo(sign * 4, -9);
    ctx.lineTo(sign * 7, -16);
    ctx.lineTo(sign * 2, -10);
    ctx.closePath();
    ctx.fill();
  };
  ear(1);
  ear(-1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export class FollowerScene {
  constructor(canvas, { onLabel } = {}) {
    this.canvas = canvas;
    this.onLabel = onLabel || (() => {});
    this.displayedCount = 0;
    this.goal = 2000;
    this.settings = {
      particlesEnabled: true,
      animationSpeed: 1,
      rotationIntensity: 1,
      counterScale: 1,
      counterFont: DEFAULT_FONT_KEY,
      theme: DEFAULT_THEME,
      animationStyle: 'default',
    };
    this.pendingTarget = null;
    this.busy = false;
    this.font = null;
    this.fontKey = null;
    this._fontCache = new Map();
    this._textureCache = new Map();
    this.themeKey = DEFAULT_THEME;
    this.material2 = null; // set by applyTheme() for two-tone themes
    this.webSplatSprite = null; // lazily created by _playWebBurst()
    this._themeParticleColors = [CYAN, PINK];
    this.dripGroup = null; // real 3D slime drips for the "Horror" theme
    this.dripMaterial = null;
    this._dripsBuiltFor = null; // `horror:${displayedCount}` cache key
    this._dripColor = '#2fae52';
    this._gradientColors = null; // [topHex, bottomHex] vertex-color gradient, if any
    this._meltStrength = 0; // how far the bottom of the letterforms sags, if any
    this.numberGroup = null; // currently visible mesh's parent anchor
    this.currentMesh = null;
    this._ready = false;
  }

  async init({ count, goal, settings }) {
    this.displayedCount = count;
    this.goal = goal;
    Object.assign(this.settings, settings);

    this._setupRenderer();
    this._setupScene();
    this._setupLights();
    this._setupEnvironment();

    const initialFontKey = THREE_FONTS[settings.counterFont] ? settings.counterFont : DEFAULT_FONT_KEY;
    this.font = await this._loadFont(initialFontKey);
    this.fontKey = initialFontKey;

    this.material = new THREE.MeshPhysicalMaterial({ reflectivity: 1 });

    this.numberAnchor = new THREE.Group();
    this.heroGroup.add(this.numberAnchor);

    this.dripGroup = new THREE.Group();
    this.dripGroup.visible = false;
    this.numberAnchor.add(this.dripGroup);

    this.particles = new ParticleBurst(this.scene, { maxParticles: 80 });

    this.glowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: new THREE.Color(CYAN),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.glowSprite.scale.set(4.2, 4.2, 1);
    this.glowSprite.position.set(0, 0, -0.6);
    this.heroGroup.add(this.glowSprite);

    this.applyTheme(this.settings.theme);

    this.currentMesh = this._buildNumberMesh(this.displayedCount);
    this.numberAnchor.add(this.currentMesh);

    this._applyCounterScale();
    this._updateGoalVisual();

    this._ready = true;
    this._animate();
    window.addEventListener('resize', () => this._onResize());
    this._onResize();
  }

  // ---------------------------------------------------------------- setup

  _setupRenderer() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.renderer = renderer;
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 100);
    this.camera.position.set(0, 0.6, 11);
    this.camera.lookAt(0, 0, 0);

    this.rootGroup = new THREE.Group();
    // Slight fixed perspective tilt, per spec ("slight perspective angle").
    this.rootGroup.rotation.x = -0.1;
    this.rootGroup.rotation.y = 0.16;
    this.scene.add(this.rootGroup);

    this.heroGroup = new THREE.Group();
    this.rootGroup.add(this.heroGroup);

    this._baseY = 0;
    this._t0 = clock.getElapsedTime();
  }

  _setupLights() {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(this.ambientLight);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 3.6);
    this.keyLight.position.set(3, 5, 6);
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0xffffff, 1.1);
    this.fillLight.position.set(-4, -2, 4);
    this.scene.add(this.fillLight);

    this.backRimLight = new THREE.DirectionalLight(0xffffff, 1.4);
    this.backRimLight.position.set(0, -4, -3);
    this.scene.add(this.backRimLight);

    // Theme-driven accent rim lights (cyan/pink by default, recolored by
    // applyTheme() — e.g. blue/white for the Spider-Man theme).
    this.rimLightA = new THREE.PointLight(new THREE.Color(CYAN), 14, 22, 2);
    this.rimLightA.position.set(-3.4, 1.6, 3);
    this.scene.add(this.rimLightA);

    this.rimLightB = new THREE.PointLight(new THREE.Color(PINK), 14, 22, 2);
    this.rimLightB.position.set(3.4, -1.4, 2.6);
    this.scene.add(this.rimLightB);

    // Base intensities, scaled per-theme in applyTheme() via
    // theme.lightIntensityScale (lighter/diffuse materials need much less
    // light before they blow out under ACES tone mapping than the dark
    // "classic" glass material these were originally tuned for).
    this._baseLightIntensity = {
      ambient: this.ambientLight.intensity,
      key: this.keyLight.intensity,
      fill: this.fillLight.intensity,
      backRim: this.backRimLight.intensity,
      rimA: this.rimLightA.intensity,
      rimB: this.rimLightB.intensity,
    };
  }

  _setupEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = envRT.texture;
    pmrem.dispose();
  }

  // ------------------------------------------------------------- geometry

  _buildNumberMesh(value) {
    const geo = new TextGeometry(formatCount(value), {
      font: this.font,
      size: 1.6,
      depth: 0.42,
      curveSegments: 8,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.035,
      bevelSegments: 4,
    });
    geo.computeBoundingBox();
    const center = new THREE.Vector3();
    geo.boundingBox.getCenter(center);
    geo.translate(-center.x, -center.y, -center.z);

    // "Melting" deformation (e.g. the "Horror" theme) sags the bottom of the
    // actual letterforms before anything else touches the geometry, so the
    // gradient and normals below are computed against the already-melted
    // shape rather than the original crisp one.
    if (this._meltStrength) {
      this._applyMeltSag(geo, this._meltStrength);
    }
    geo.computeVertexNormals();

    // Vertical top-to-bottom color gradient (e.g. the "Horror" theme's
    // slime look) — vertex colors instead of a UV-mapped texture, since
    // ExtrudeGeometry's default UVs aren't reliably 0-1 to map a gradient
    // texture against. material2 (the bevel) ignores this attribute unless
    // its own vertexColors flag is also enabled, so it stays a flat color.
    if (this._gradientColors) {
      geo.computeBoundingBox();
      this._applyVerticalGradientColors(geo, this._gradientColors[0], this._gradientColors[1]);
    }

    // ExtrudeGeometry (which TextGeometry builds on) always splits faces into
    // group 0 = front/back caps and group 1 = the extruded sides + bevel —
    // a two-material array lets two-tone themes color those independently
    // (e.g. red front face, blue bevel edge) with zero extra geometry work.
    const materials = this.material2 ? [this.material.clone(), this.material2.clone()] : this.material.clone();
    const mesh = new THREE.Mesh(geo, materials);
    forEachMaterial(mesh, (m) => {
      m.transparent = true;
    });
    return mesh;
  }

  _applyVerticalGradientColors(geo, topHex, bottomHex) {
    const { min, max } = geo.boundingBox;
    const height = Math.max(0.0001, max.y - min.y);
    const top = new THREE.Color(topHex);
    const bottom = new THREE.Color(bottomHex);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) - min.y) / height;
      c.copy(bottom).lerp(top, Math.min(1, Math.max(0, t)));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  // Pulls vertices near the bottom of the letterforms downward by an amount
  // that varies with X (via meltNoise, shared with drip placement below so
  // the drips start exactly where the surface is actually sagging), giving
  // an uneven, dripping baseline instead of a crisp horizontal one. Only
  // the lower portion of each glyph is affected — falloff³ keeps the top of
  // the numbers legible.
  _applyMeltSag(geo, strength) {
    const { min, max } = geo.boundingBox;
    const height = Math.max(0.0001, max.y - min.y);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const yNorm = (y - min.y) / height;
      const zone = Math.max(0, 1 - yNorm / 0.42);
      const falloff = zone * zone * zone;
      pos.setY(i, y - falloff * meltNoise(x) * strength);
    }
    pos.needsUpdate = true;
    geo.computeBoundingBox();
  }

  // -------------------------------------------------------------- public

  applySettings(settings) {
    const fontChanged =
      settings.counterFont && THREE_FONTS[settings.counterFont] && settings.counterFont !== this.fontKey;
    const themeChanged = settings.theme && THEMES[settings.theme] && settings.theme !== this.themeKey;
    Object.assign(this.settings, settings);
    this._applyCounterScale();
    if (fontChanged && this._ready) this._switchFont(settings.counterFont);
    if (themeChanged && this._ready) this.applyTheme(settings.theme);
  }

  /** Swaps material color/texture, rim light colors, glow + particle colors. */
  applyTheme(themeKey) {
    const theme = resolveTheme(themeKey);
    this.themeKey = THEMES[themeKey] ? themeKey : DEFAULT_THEME;

    this._applyMaterialProps(this.material, theme.material);
    this.material.map = theme.texture ? this._getThemeTexture(theme.texture) : null;
    this._gradientColors = theme.gradientTop && theme.gradientBottom ? [theme.gradientTop, theme.gradientBottom] : null;
    this.material.vertexColors = !!this._gradientColors;
    this._meltStrength = theme.meltStrength || 0;
    this.material.needsUpdate = true;

    // Two-tone themes (e.g. red front face + blue bevel) supply material2,
    // applied to the extruded side/bevel faces — see _buildNumberMesh().
    if (theme.material2) {
      if (!this.material2) this.material2 = new THREE.MeshPhysicalMaterial({ reflectivity: 1 });
      this._applyMaterialProps(this.material2, theme.material2);
      this.material2.needsUpdate = true;
    } else {
      this.material2 = null;
    }

    if (this.rimLightA) this.rimLightA.color.set(theme.rimColorA);
    if (this.rimLightB) this.rimLightB.color.set(theme.rimColorB);
    if (this.glowSprite) this.glowSprite.material.color.set(theme.glowColor);
    this._themeParticleColors = [theme.particleColorA, theme.particleColorB];

    if (this._baseLightIntensity) {
      const scale = theme.lightIntensityScale ?? 1;
      this.ambientLight.intensity = this._baseLightIntensity.ambient * scale;
      this.keyLight.intensity = this._baseLightIntensity.key * scale;
      this.fillLight.intensity = this._baseLightIntensity.fill * scale;
      this.backRimLight.intensity = this._baseLightIntensity.backRim * scale;
      this.rimLightA.intensity = this._baseLightIntensity.rimA * scale;
      this.rimLightB.intensity = this._baseLightIntensity.rimB * scale;
    }

    // ACES filmic tone mapping (the "classic" premium-glass look) rolls off
    // saturated reds hard, turning them pink/coral — themes built around a
    // strong red (e.g. Spider-Man) opt out via toneMapping: 'none'.
    if (this.renderer) {
      this.renderer.toneMapping =
        theme.toneMapping === 'none' ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = theme.toneMappingExposure ?? 1.05;
    }

    this._dripColor = theme.dripColor || '#2fae52';
    if (this.dripGroup) this.dripGroup.visible = this.themeKey === 'horror';
    this._dripsBuiltFor = null; // force a rebuild check on the next frame

    if (this.themeKey === 'bats') this._startAmbientBats();
    else this._stopAmbientBats();

    if (this.currentMesh) this._swapMeshInstant(this.displayedCount);
  }

  // material.color is a THREE.Color *instance* — assigning a raw number
  // over it (as a plain Object.assign would) breaks the shader uniform,
  // so it needs to go through .set() instead.
  _applyMaterialProps(material, props) {
    const { color, ...rest } = props;
    Object.assign(material, rest);
    if (color !== undefined) material.color.set(color);
  }

  _getThemeTexture(key) {
    if (this._textureCache.has(key)) return this._textureCache.get(key);
    const maker = THEME_TEXTURE_MAKERS[key];
    const tex = maker ? maker() : null;
    if (tex) this._textureCache.set(key, tex);
    return tex;
  }

  setGoal(goal) {
    this.goal = goal;
    this._updateGoalVisual();
  }

  /** Real or test follower increase — plays the celebratory animation. */
  handleFollowerUpdate({ newCount }) {
    if (!this._ready) return;
    this.pendingTarget = Math.max(this.pendingTarget ?? this.displayedCount, newCount);
    this._maybeAdvance();
  }

  /** Quiet correction (e.g. an unfollow) — updates the number, no fanfare. */
  handleCountSync({ newCount }) {
    if (!this._ready || this.busy) return;
    this.displayedCount = newCount;
    this._swapMeshInstant(newCount);
    this._updateGoalVisual();
  }

  // ------------------------------------------------------------- private

  _dur(ms) {
    return ms / Math.max(0.25, this.settings.animationSpeed);
  }

  _applyCounterScale() {
    if (this.heroGroup) this.heroGroup.scale.setScalar(this.settings.counterScale);
  }

  _updateGoalVisual() {
    this.onLabel({ type: 'progress', goal: formatCount(this.goal) });
  }

  async _loadFont(key) {
    if (this._fontCache.has(key)) return this._fontCache.get(key);
    const url = THREE_FONTS[key] || THREE_FONTS[DEFAULT_FONT_KEY];
    const font = await new Promise((resolve, reject) => {
      new FontLoader().load(url, resolve, undefined, reject);
    });
    this._fontCache.set(key, font);
    return font;
  }

  async _switchFont(key) {
    const font = await this._loadFont(key);
    this.font = font;
    this.fontKey = key;
    if (this.currentMesh) this._swapMeshInstant(this.displayedCount);
  }

  _swapMeshInstant(value) {
    const oldMesh = this.currentMesh;
    const newMesh = this._buildNumberMesh(value);
    this.numberAnchor.add(newMesh);
    this.currentMesh = newMesh;
    if (oldMesh) {
      this.numberAnchor.remove(oldMesh);
      disposeMesh(oldMesh);
    }
  }

  async _maybeAdvance() {
    if (this.busy) return;
    if (this.pendingTarget == null || this.pendingTarget <= this.displayedCount) {
      this.pendingTarget = null;
      return;
    }
    this.busy = true;
    const remaining = this.pendingTarget - this.displayedCount;
    try {
      if (remaining <= STEP_THRESHOLD) {
        await this._playStepFlip(this.displayedCount + 1, 1);
      } else {
        const target = this.pendingTarget;
        await this._playAccelerated(target, remaining);
      }
    } finally {
      this.busy = false;
      this._maybeAdvance();
    }
  }

  async _tween(duration, onUpdate) {
    const start = performance.now();
    return new Promise((resolve) => {
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        onUpdate(t);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  _burstEffects(gainLabel) {
    // The "Bats" theme has its own signature gain animation, independent of
    // the animationStyle dropdown — picking this theme always flies bats.
    if (this.settings.theme === 'bats') {
      this._playBatBurst(gainLabel);
      return;
    }
    if (this.settings.animationStyle === 'web') {
      this._playWebBurst(gainLabel);
      return;
    }

    this.glowSprite.material.opacity = 0;
    this._tween(this._dur(650), (t) => {
      const s = t < 0.5 ? t / 0.5 : 1 - (t - 0.5) / 0.5;
      this.glowSprite.material.opacity = easeOutCubic(s) * 0.85;
      this.glowSprite.scale.setScalar(4.2 + easeOutCubic(t) * 1.4);
    });

    if (this.settings.particlesEnabled) {
      const [colorA, colorB] = this._themeParticleColors;
      this.particles.burst(new THREE.Vector3(0, 0, 0.3), 24, colorA, colorB);
    }

    this.onLabel({ type: 'gain', text: gainLabel });
  }

  /**
   * "Web Shot" gain animation: two web-shooter streaks converge on the
   * counter from opposite corners, then a radial web splat snaps onto the
   * number with an elastic pop and dissolves — a Spidey-inspired, but
   * purely color/motion based (not trademarked-artwork based) alternative
   * to the default glow burst.
   */
  _playWebBurst(gainLabel) {
    const [colorA, colorB] = this._themeParticleColors;
    const target = new THREE.Vector3(0, 0, 0.4);
    const corners = [
      { start: new THREE.Vector3(-4.6, 3.0, 0.5), color: colorA },
      { start: new THREE.Vector3(4.6, -2.8, 0.5), color: colorB },
    ];

    corners.forEach(({ start, color }) => {
      const streak = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: makeGlowTexture(),
          color: new THREE.Color(color),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      streak.scale.set(0.22, 1.1, 1);
      streak.position.copy(start);
      streak.material.rotation = Math.atan2(target.y - start.y, target.x - start.x) - Math.PI / 2;
      this.heroGroup.add(streak);

      this._tween(this._dur(230), (t) => {
        streak.position.lerpVectors(start, target, easeOutCubic(t));
        streak.material.opacity = Math.sin(Math.min(1, t) * Math.PI) * 0.9;
      }).then(() => {
        this.heroGroup.remove(streak);
        streak.material.dispose();
      });
    });

    if (!this.webSplatSprite) {
      this.webSplatSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: makeWebSplatTexture(),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      this.webSplatSprite.position.set(0, 0, 0.35);
      this.heroGroup.add(this.webSplatSprite);
    }
    this.webSplatSprite.material.color.set(colorA);
    this.webSplatSprite.scale.set(0.01, 0.01, 1);
    this.webSplatSprite.material.opacity = 0;

    setTimeout(async () => {
      await this._tween(this._dur(380), (t) => {
        const s = 3.6 * Math.max(0.02, easeOutBack(t));
        this.webSplatSprite.scale.set(s, s, 1);
        this.webSplatSprite.material.opacity = Math.min(1, t / 0.4) * 0.9;
      });
      await this._tween(this._dur(200), () => {});
      await this._tween(this._dur(400), (t) => {
        this.webSplatSprite.material.opacity = 0.9 * (1 - easeOutCubic(t));
      });
    }, this._dur(150));

    if (this.settings.particlesEnabled) {
      setTimeout(() => {
        this.particles.burst(new THREE.Vector3(0, 0, 0.3), 20, colorA, colorB);
      }, this._dur(150));
    }

    this.onLabel({ type: 'gain', text: gainLabel });
  }

  /**
   * Launches a single bat from the counter outward on a random heading.
   * Used both by the ambient "Bats" idle loop (one at a time, continuously)
   * and by the gain burst (several at once).
   */
  _spawnBat(angle = Math.random() * Math.PI * 2) {
    if (!this._batTexture) this._batTexture = makeBatTexture();

    const speed = 1.7 + Math.random() * 1.1; // slower & shorter travel — stays on-screen
    const rise = 1.5 + Math.random() * 2.5;
    const scale = 0.62 + Math.random() * 0.3; // big enough to actually read as a bat
    const flapSeed = Math.random() * 10;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle) * 0.5 + 0.4; // bias upward, like startled bats

    const bat = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this._batTexture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    bat.position.set(0, 0, 0.4);
    bat.scale.set(scale, scale * 0.6, 1);
    this.heroGroup.add(bat);

    // Fade in quickly, HOLD at full opacity for the bulk of the animation
    // (not a continuous fade the whole time), then fade out — a bat that's
    // only ever mid-fade is too subtle to notice live.
    this._tween(this._dur(1900 + Math.random() * 500), (t) => {
      const e = easeOutCubic(t);
      bat.position.x = dirX * speed * e;
      bat.position.y = dirY * speed * e + Math.sin(t * Math.PI) * rise * 0.3;
      let alpha;
      if (t < 0.12) alpha = t / 0.12;
      else if (t < 0.6) alpha = 1;
      else alpha = 1 - (t - 0.6) / 0.4;
      bat.material.opacity = alpha;
      const flap = 0.7 + Math.abs(Math.sin(t * 14 + flapSeed)) * 0.5;
      bat.scale.set(scale * flap, scale * 0.6, 1);
      bat.material.rotation = Math.sin(t * 10 + flapSeed) * 0.3;
    }).then(() => {
      this.heroGroup.remove(bat);
      bat.material.dispose();
    });
  }

  /** "Bats" theme's gain animation: a small swarm scatters at once, on top of the ambient trickle. */
  _playBatBurst(gainLabel) {
    const batCount = 9;
    for (let i = 0; i < batCount; i++) {
      this._spawnBat((i / batCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.6);
    }
    this.onLabel({ type: 'gain', text: gainLabel });
  }

  /**
   * Continuous idle animation for the "Bats" theme: one bat flies out every
   * couple of seconds, forever, independent of follower gains — started/
   * stopped by applyTheme() as the theme switches to/from "bats".
   */
  _startAmbientBats() {
    if (this._ambientBatsRunning) return;
    this._ambientBatsRunning = true;
    const loop = () => {
      if (!this._ambientBatsRunning) return;
      this._spawnBat();
      this._ambientBatTimer = setTimeout(loop, this._dur(1400 + Math.random() * 1800));
    };
    loop();
  }

  _stopAmbientBats() {
    this._ambientBatsRunning = false;
    if (this._ambientBatTimer) clearTimeout(this._ambientBatTimer);
    this._ambientBatTimer = null;
  }

  /** Single +1 flip: old number tilts back & away, new one rises into place. */
  async _playStepFlip(nextValue) {
    const oldMesh = this.currentMesh;
    const newMesh = this._buildNumberMesh(nextValue);
    newMesh.position.y = -1.1;
    newMesh.rotation.x = Math.PI / 2.1;
    setMeshOpacity(newMesh, 0);
    this.numberAnchor.add(newMesh);

    const exitDuration = this._dur(260);
    const enterDuration = this._dur(480);
    const rotAmt = 1.15 * (0.4 + this.settings.rotationIntensity * 0.6);

    this._burstEffects('+1 FOLLOWER');

    await Promise.all([
      this._tween(exitDuration, (t) => {
        const e = easeOutCubic(t);
        if (oldMesh) {
          oldMesh.position.z = -e * 0.9;
          oldMesh.rotation.x = -e * rotAmt;
          setMeshOpacity(oldMesh, 1 - e);
        }
      }),
      this._tween(enterDuration, (t) => {
        const e = easeOutBack(t);
        newMesh.position.y = -1.1 + e * 1.1;
        newMesh.rotation.x = Math.PI / 2.1 * (1 - Math.min(1, t / 0.85));
        setMeshOpacity(newMesh, Math.min(1, t / 0.5));
      }),
    ]);

    this.numberAnchor.remove(oldMesh);
    disposeMesh(oldMesh);
    newMesh.position.set(0, 0, 0);
    newMesh.rotation.x = 0;
    setMeshOpacity(newMesh, 1);
    this.currentMesh = newMesh;
    this.displayedCount = nextValue;
    this._updateGoalVisual();
  }

  /** Large jump: exit old number once, roll rapidly, settle on the target. */
  async _playAccelerated(target, gain) {
    const oldMesh = this.currentMesh;
    const startValue = this.displayedCount;

    const exitDuration = this._dur(300);
    await this._tween(exitDuration, (t) => {
      const e = easeOutCubic(t);
      if (oldMesh) {
        oldMesh.position.z = -e * 1.1;
        oldMesh.rotation.x = -e * 1.3;
        setMeshOpacity(oldMesh, 1 - e);
      }
    });
    this.numberAnchor.remove(oldMesh);
    disposeMesh(oldMesh);

    const rollMesh = this._buildNumberMesh(startValue);
    this.numberAnchor.add(rollMesh);
    this.currentMesh = rollMesh;

    const rollDuration = this._dur(950);
    let lastRebuild = 0;
    await this._tween(rollDuration, (t) => {
      const e = easeInOutCubic(t);
      const value = Math.round(startValue + (target - startValue) * e);
      const now = performance.now();
      if (value !== this.displayedCount && now - lastRebuild > 55) {
        lastRebuild = now;
        this._rebuildRollMesh(value);
        this.displayedCount = value;
        this._updateGoalVisual();
      }
      this.currentMesh.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.04);
    });

    if (this.displayedCount !== target) {
      this._rebuildRollMesh(target);
      this.displayedCount = target;
      this._updateGoalVisual();
    }

    const settleDuration = this._dur(320);
    await this._tween(settleDuration, (t) => {
      const e = easeOutBack(t);
      this.currentMesh.scale.setScalar(1 + (1 - e) * 0.12);
    });
    this.currentMesh.scale.setScalar(1);

    this._burstEffects(`+${gain} FOLLOWERS`);
  }

  _rebuildRollMesh(value) {
    const old = this.currentMesh;
    const next = this._buildNumberMesh(value);
    this.numberAnchor.add(next);
    this.numberAnchor.remove(old);
    disposeMesh(old);
    this.currentMesh = next;
  }

  // -------------------------------------------------------------- render

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;

    const vertical = h > w;
    if (vertical) {
      this.camera.fov = 40;
      this.camera.position.z = 13.5;
      this.heroGroup.position.y = 1.6;
    } else {
      this.camera.fov = 32;
      this.camera.position.z = 11;
      this.heroGroup.position.y = 0;
    }
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, clock.getDelta());
      const t = clock.getElapsedTime();

      // Idle floating animation.
      const ri = this.settings.rotationIntensity;
      this.numberAnchor.position.y = Math.sin(t * 0.9) * 0.06;
      this.numberAnchor.rotation.y = Math.sin(t * 0.6) * 0.06 * ri;
      this.numberAnchor.rotation.x = Math.cos(t * 0.5) * 0.025 * ri;

      this.particles.update(dt);

      // Drips are real geometry keyed to the currently displayed digits —
      // only rebuild when the theme or the number itself actually changes,
      // never every frame.
      if (this.themeKey === 'horror') {
        const key = `horror:${this.displayedCount}`;
        if (this._dripsBuiltFor !== key) {
          this._dripsBuiltFor = key;
          this._rebuildDrips();
        }
      }

      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }

  // --------------------------------------------------------- slime drips

  _rebuildDrips() {
    this._disposeDrips();
    if (!this.font || !this.dripGroup) return;

    const size = 1.6;
    const text = formatCount(this.displayedCount);
    const shapes = this.font.generateShapes(text, size);
    if (!shapes.length) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const bounds = shapes.map((shape) => {
      let sMinX = Infinity;
      let sMaxX = -Infinity;
      let sMinY = Infinity;
      for (const p of shape.getPoints()) {
        if (p.x < sMinX) sMinX = p.x;
        if (p.x > sMaxX) sMaxX = p.x;
        if (p.y < sMinY) sMinY = p.y;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      if (sMinX < minX) minX = sMinX;
      if (sMaxX > maxX) maxX = sMaxX;
      return { minX: sMinX, maxX: sMaxX, minY: sMinY };
    });

    // Match the centering translate() TextGeometry applies in _buildNumberMesh.
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const overallMinY = minY - centerY;
    const overallHeight = Math.max(0.0001, maxY - minY);
    const z = 0.24;

    if (!this.dripMaterial) {
      this.dripMaterial = new THREE.MeshPhysicalMaterial({
        metalness: 0.05,
        roughness: 0.15,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        transmission: 0.15,
        transparent: true,
        opacity: 0.92,
      });
    }
    this.dripMaterial.color.set(this._dripColor);
    this.dripMaterial.emissive.set(this._dripColor);
    this.dripMaterial.emissiveIntensity = 0.35;

    // Anchor Y exactly where _applyMeltSag pulled the surface down to, so
    // drips read as a continuation of the melted letterform, not decals
    // floating with a gap below it.
    const sagAt = (x, baseY) => {
      const yNorm = (baseY - overallMinY) / overallHeight;
      const zone = Math.max(0, 1 - yNorm / 0.42);
      const falloff = zone * zone * zone;
      return baseY - falloff * meltNoise(x) * this._meltStrength;
    };

    for (const b of bounds) {
      const width = b.maxX - b.minX;
      const bottomY = b.minY - centerY;
      // A few sample points across each glyph's width, not just its center —
      // real melted lettering drips from multiple spots along the base.
      const samples = [0.22, 0.5, 0.78];
      for (const frac of samples) {
        if (Math.random() < 0.4) continue; // skip most — a handful of drips reads better than one per sample
        const x = b.minX - centerX + width * frac + (Math.random() - 0.5) * 0.04;
        this._addDrip(x, sagAt(x, bottomY), z);
      }
    }
  }

  // A tapered cone (the strand of ooze) with a bulbous sphere at the tip —
  // reads as a single hanging drop of slime, like the reference lettering.
  _addDrip(x, topY, z) {
    const length = 0.14 + Math.random() * 0.34;
    const topRadius = 0.045 + Math.random() * 0.025;
    const coneGeo = new THREE.ConeGeometry(topRadius, length, 8, 1, true);
    const cone = new THREE.Mesh(coneGeo, this.dripMaterial);
    cone.position.set(x, topY - length / 2, z);
    this.dripGroup.add(cone);

    const bulbRadius = topRadius * (0.85 + Math.random() * 0.3);
    const bulbGeo = new THREE.SphereGeometry(bulbRadius, 10, 8);
    const bulb = new THREE.Mesh(bulbGeo, this.dripMaterial);
    bulb.position.set(x, topY - length, z);
    this.dripGroup.add(bulb);
  }

  _disposeDrips() {
    if (!this.dripGroup) return;
    this.dripGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
    });
    while (this.dripGroup.children.length) {
      this.dripGroup.remove(this.dripGroup.children[0]);
    }
  }
}
