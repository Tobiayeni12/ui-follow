import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ParticleBurst } from './particles.js';

const CYAN = '#25F4EE';
const PINK = '#FE2C55';
const FONT_URL = '/vendor/three/examples/fonts/helvetiker_bold.typeface.json';

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

function formatGoalShort(n) {
  if (n >= 1000000) return `${trimZero(n / 1000000)}M`;
  if (n >= 1000) return `${trimZero(n / 1000)}K`;
  return `${n}`;
}
function trimZero(n) {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
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
    };
    this.pendingTarget = null;
    this.busy = false;
    this.font = null;
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
    this._setupGoalBar();

    this.font = await new Promise((resolve, reject) => {
      new FontLoader().load(FONT_URL, resolve, undefined, reject);
    });

    this.material = new THREE.MeshPhysicalMaterial({
      color: 0x1c2740,
      metalness: 0.85,
      roughness: 0.26,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      reflectivity: 1,
      envMapIntensity: 2.6,
    });

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
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 3.6);
    key.position.set(3, 5, 6);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 1.1);
    fill.position.set(-4, -2, 4);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 1.4);
    rim.position.set(0, -4, -3);
    this.scene.add(rim);

    // TikTok-inspired cyan/pink rim lights for that premium accent glow.
    const cyanLight = new THREE.PointLight(new THREE.Color(CYAN), 14, 22, 2);
    cyanLight.position.set(-3.4, 1.6, 3);
    this.scene.add(cyanLight);

    const pinkLight = new THREE.PointLight(new THREE.Color(PINK), 14, 22, 2);
    pinkLight.position.set(3.4, -1.4, 2.6);
    this.scene.add(pinkLight);
  }

  _setupEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = envRT.texture;
    pmrem.dispose();
  }

  _setupGoalBar() {
    const group = new THREE.Group();
    group.position.set(0, -1.55, 0);

    const BAR_WIDTH = 4.6;
    const trackGeo = new THREE.BoxGeometry(BAR_WIDTH, 0.16, 0.16);
    const trackMat = new THREE.MeshPhysicalMaterial({
      color: 0x11151f,
      metalness: 0.6,
      roughness: 0.4,
      transparent: true,
      opacity: 0.85,
    });
    const track = new THREE.Mesh(trackGeo, trackMat);
    group.add(track);

    // Width matches the track so scale.x can go directly from 0 to 1 (the
    // raw goal percentage) and still span the full track at 100%.
    const fillGeo = new THREE.BoxGeometry(BAR_WIDTH, 0.16, 0.17);
    fillGeo.translate(BAR_WIDTH / 2, 0, 0); // pivot at the left edge, grows rightward
    const fillMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(CYAN),
      emissive: new THREE.Color(CYAN),
      emissiveIntensity: 0.9,
      metalness: 0.3,
      roughness: 0.3,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.x = -BAR_WIDTH / 2;
    group.add(fill);

    this.goalBarFill = fill;
    this.heroGroup.add(group);
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
    Object.assign(this.settings, settings);
    this._applyCounterScale();
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
    const pct = this.goal > 0 ? Math.min(1, this.displayedCount / this.goal) : 0;
    if (this.goalBarFill) {
      this.goalBarFill.scale.x = Math.max(0.001, pct);
    }
    this.onLabel({
      type: 'progress',
      count: formatCount(this.displayedCount),
      goal: formatCount(this.goal),
      goalShort: formatGoalShort(this.goal),
      percent: Math.round(pct * 1000) / 10,
    });
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
      this.particles.burst(new THREE.Vector3(0, 0, 0.3), 24, CYAN, PINK);
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
