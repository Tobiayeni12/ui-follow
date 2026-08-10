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
    };
    this.pendingTarget = null;
    this.busy = false;
    this.font = null;
    this.fontKey = null;
    this._fontCache = new Map();
    this._textureCache = new Map();
    this.themeKey = DEFAULT_THEME;
    this._themeParticleColors = [CYAN, PINK];
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
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.material.clone());
    mesh.material.transparent = true;
    return mesh;
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

    // material.color is a THREE.Color *instance* — assigning a raw number
    // over it (as a plain Object.assign would) breaks the shader uniform,
    // so it needs to go through .set() instead.
    const { color, ...restMaterial } = theme.material;
    Object.assign(this.material, restMaterial);
    if (color !== undefined) this.material.color.set(color);
    this.material.map = theme.texture ? this._getThemeTexture(theme.texture) : null;
    this.material.needsUpdate = true;

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

    if (this.currentMesh) this._swapMeshInstant(this.displayedCount);
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
      oldMesh.geometry.dispose();
      oldMesh.material.dispose();
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
    const worldPos = new THREE.Vector3();
    this.numberAnchor.getWorldPosition(worldPos);

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

  /** Single +1 flip: old number tilts back & away, new one rises into place. */
  async _playStepFlip(nextValue) {
    const oldMesh = this.currentMesh;
    const newMesh = this._buildNumberMesh(nextValue);
    newMesh.position.y = -1.1;
    newMesh.rotation.x = Math.PI / 2.1;
    newMesh.material.opacity = 0;
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
          oldMesh.material.opacity = 1 - e;
        }
      }),
      this._tween(enterDuration, (t) => {
        const e = easeOutBack(t);
        newMesh.position.y = -1.1 + e * 1.1;
        newMesh.rotation.x = Math.PI / 2.1 * (1 - Math.min(1, t / 0.85));
        newMesh.material.opacity = Math.min(1, t / 0.5);
      }),
    ]);

    this.numberAnchor.remove(oldMesh);
    if (oldMesh) {
      oldMesh.geometry.dispose();
      oldMesh.material.dispose();
    }
    newMesh.position.set(0, 0, 0);
    newMesh.rotation.x = 0;
    newMesh.material.opacity = 1;
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
        oldMesh.material.opacity = 1 - e;
      }
    });
    this.numberAnchor.remove(oldMesh);
    if (oldMesh) {
      oldMesh.geometry.dispose();
      oldMesh.material.dispose();
    }

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
      rollMesh.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.04);
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
    old.geometry.dispose();
    old.material.dispose();
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
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }
}
