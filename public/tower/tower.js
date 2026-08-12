import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ReconnectingSocket } from '/overlay/wsClient.js';

const CYAN = '#25F4EE';
const PINK = '#FE2C55';
const GOLD = '#FFD34D';
const PURPLE = '#B15CFF';

const BLOCK_W = 1.7;
const BLOCK_H = 0.5;
const BLOCK_D = 1.15;
const BLOCK_GAP = 0.045;
const STEP = BLOCK_H + BLOCK_GAP;
const GRAVITY = 9.8;

function formatCount(n) {
  return Math.round(n).toLocaleString('en-US');
}

// Deterministic per-block jitter so every render of the same tower looks
// identical (no reshuffling on reconnect/refresh) without storing offsets.
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function seededRand(seed, salt) {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function materialForBlock(kind, index) {
  const shared = { metalness: 0.75, roughness: 0.27, clearcoat: 1, clearcoatRoughness: 0.09 };
  switch (kind) {
    case 'legendary':
      return new THREE.MeshPhysicalMaterial({
        ...shared,
        color: new THREE.Color('#2a1408'),
        envMapIntensity: 2.6,
        emissive: new THREE.Color(GOLD),
        emissiveIntensity: 0.85,
      });
    case 'rare':
      return new THREE.MeshPhysicalMaterial({
        ...shared,
        color: new THREE.Color('#1a0f2e'),
        envMapIntensity: 2.2,
        emissive: new THREE.Color(PURPLE),
        emissiveIntensity: 0.55,
      });
    case 'special':
      return new THREE.MeshPhysicalMaterial({
        ...shared,
        color: new THREE.Color('#241a08'),
        envMapIntensity: 2,
        emissive: new THREE.Color(GOLD),
        emissiveIntensity: 0.35,
      });
    default:
      return new THREE.MeshPhysicalMaterial({
        ...shared,
        color: new THREE.Color('#141a2b'),
        envMapIntensity: 1.8,
        emissive: new THREE.Color(index % 2 === 0 ? CYAN : PINK),
        emissiveIntensity: 0.2,
      });
  }
}

class Tower3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.blocks = [];
    this.blockMeshes = [];
    this.position = 'bottom-right';
    this.scaleSetting = 1;
    this.baseDist = 5.5;
    this._cameraInit = false;

    this._setupRenderer();
    this._setupScene();
    this._setupLights();
    this._setupEnvironment();
    this._animate();

    window.addEventListener('resize', () => this._onResize());
    this._onResize();
  }

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
    this.camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 200);
    this.camera.position.set(0, 1.4, this.baseDist);

    this.towerGroup = new THREE.Group();
    this.scene.add(this.towerGroup);

    this._buildBase();
  }

  _buildBase() {
    const baseGeo = new RoundedBoxGeometry(BLOCK_W + 0.5, 0.16, BLOCK_D + 0.5, 3, 0.06);
    const baseMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#0a0e1a'),
      metalness: 0.8,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      envMapIntensity: 1.6,
      emissive: new THREE.Color(CYAN),
      emissiveIntensity: 0.35,
    });
    const base = new THREE.Mesh(baseGeo, baseMaterial);
    base.position.y = -0.08;
    this.towerGroup.add(base);
  }

  _setupLights() {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.ambientLight);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    this.keyLight.position.set(3, 6, 5);
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this.fillLight.position.set(-4, 2, 4);
    this.scene.add(this.fillLight);

    this.rimLightA = new THREE.PointLight(new THREE.Color(CYAN), 10, 20, 2);
    this.rimLightA.position.set(-2.6, 2, 2.4);
    this.scene.add(this.rimLightA);

    this.rimLightB = new THREE.PointLight(new THREE.Color(PINK), 10, 20, 2);
    this.rimLightB.position.set(2.6, 0, 2.2);
    this.scene.add(this.rimLightB);
  }

  _setupEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = envRT.texture;
    pmrem.dispose();
  }

  // ------------------------------------------------------------- blocks

  buildFromState(blocks) {
    for (const mesh of this.blockMeshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      this.towerGroup.remove(mesh);
    }
    this.blockMeshes = [];
    this.blocks = blocks.slice();
    this.blocks.forEach((block, i) => this._placeBlock(block, i, false));
    this._reframe();
  }

  addBlock(block) {
    this.blocks.push(block);
    this._placeBlock(block, this.blocks.length - 1, true);
    this._reframe();
  }

  _placeBlock(block, index, animate) {
    const geo = new RoundedBoxGeometry(BLOCK_W, BLOCK_H, BLOCK_D, 3, 0.07);
    const material = materialForBlock(block.kind, index);
    const mesh = new THREE.Mesh(geo, material);

    const seed = hashSeed(String(block.id ?? index));
    mesh.position.x = (seededRand(seed, 1) - 0.5) * 0.05;
    mesh.position.z = (seededRand(seed, 2) - 0.5) * 0.05;
    mesh.rotation.y = (seededRand(seed, 3) - 0.5) * 0.09;

    const targetY = index * STEP + BLOCK_H / 2;
    mesh.position.y = animate ? targetY + 3.2 : targetY;

    mesh.userData.fallTarget = targetY;
    mesh.userData.fallVelocity = 0;
    mesh.userData.falling = !!animate;

    this.towerGroup.add(mesh);
    this.blockMeshes.push(mesh);
  }

  // ------------------------------------------------------------- framing

  applySettings(settings) {
    this.position = settings.position || 'bottom-right';
    this.scaleSetting = settings.scale || 1;
    this.towerGroup.scale.setScalar(this.scaleSetting);
    this._reframe();
  }

  _reframe() {
    const count = Math.max(this.blocks.length, 1);
    const towerHeight = count * STEP;
    const margin = STEP * 5;
    const desiredVisible = (towerHeight + margin) / this.scaleSetting;
    const fovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const neededDist = desiredVisible / (2 * Math.tan(fovRad / 2));
    const dist = Math.max(this.baseDist, neededDist);

    // The tower mesh group always stays centered at world x=0. To make it
    // *appear* off to one side of frame, shift where the camera looks
    // (not the camera itself) — pushing the look-at target left makes the
    // subject appear to the right of center, and vice versa. The desired
    // offset is clamped to the frustum's actual visible half-width so it
    // never pushes the tower off-frame on narrow (portrait) aspects, where
    // horizontal FOV is much smaller than on 16:9.
    const sign = this.position === 'bottom-left' ? 1 : this.position === 'bottom-center' ? 0 : -1;
    const hFovRad = 2 * Math.atan(Math.tan(fovRad / 2) * this.camera.aspect);
    const towerHalfWidth = ((BLOCK_W + 0.5) / 2) * this.scaleSetting;
    const maxOffset = Math.max(0, dist * Math.tan(hFovRad / 2) - towerHalfWidth - 0.3);
    const desiredOffset = sign * 1.7 * (dist / this.baseDist);
    const lookXOffset = Math.sign(desiredOffset) * Math.min(Math.abs(desiredOffset), maxOffset);
    // Look at the tower's true vertical center so the reserved margin above
    // and below splits evenly — off-center framing eats headroom on one
    // side and clips the other. Camera sits just slightly above that
    // center for a gentle hero-shot downward angle, scaling with height so
    // the angle stays constant rather than tilting steeper on tall towers.
    const lookY = towerHeight / 2;

    this._targetCamera = {
      x: 0,
      y: lookY + 0.35,
      z: dist,
      lookX: lookXOffset,
      lookY,
    };

    if (!this._cameraInit) {
      this.camera.position.set(this._targetCamera.x, this._targetCamera.y, this._targetCamera.z);
      this._cameraInit = true;
    }
  }

  // ------------------------------------------------------------- render

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this._cameraInit) this._reframe();
  }

  _animate() {
    const clock = new THREE.Clock();
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, clock.getDelta());
      const t = clock.getElapsedTime();

      if (this._targetCamera) {
        const c = this.camera.position;
        const ease = Math.min(1, dt * 2.2);
        c.x += (this._targetCamera.x - c.x) * ease;
        c.y += (this._targetCamera.y - c.y) * ease;
        c.z += (this._targetCamera.z - c.z) * ease;
        this.camera.lookAt(this._targetCamera.lookX, this._targetCamera.lookY, 0);
      }

      for (const mesh of this.blockMeshes) {
        if (!mesh.userData.falling) continue;
        mesh.userData.fallVelocity -= GRAVITY * dt;
        mesh.position.y += mesh.userData.fallVelocity * dt;
        if (mesh.position.y <= mesh.userData.fallTarget) {
          mesh.position.y = mesh.userData.fallTarget;
          mesh.userData.fallVelocity *= -0.28;
          if (Math.abs(mesh.userData.fallVelocity) < 0.6) {
            mesh.userData.falling = false;
            mesh.position.y = mesh.userData.fallTarget;
          }
        }
      }

      // Gentle showcase sway — subtle enough to keep the "stacked and
      // stable" illusion intact.
      this.towerGroup.rotation.y = Math.sin(t * 0.15) * 0.06;

      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }
}

// ------------------------------------------------------------- bootstrap

const initialState = window.__INITIAL_STATE__ || {};

const stage = document.getElementById('stage');
const canvas = document.getElementById('scene');
const followerCountEl = document.getElementById('followerCount');
const nextLevelEl = document.getElementById('nextLevel');
const gainBanner = document.getElementById('gainBanner');
const gainLine1 = document.getElementById('gainLine1');
const gainLine2 = document.getElementById('gainLine2');
const comboBanner = document.getElementById('comboBanner');
const milestoneBanner = document.getElementById('milestoneBanner');
const milestoneCountEl = document.getElementById('milestoneCount');

let settings = initialState.settings || {};
let followerCount = initialState.followerCount || 0;

stage.dataset.position = settings.position || 'bottom-right';

const tower = new Tower3D(canvas);
tower.applySettings(settings);
tower.buildFromState(initialState.blocks || []);

function nextMilestone() {
  const list = Array.isArray(settings.milestones) ? settings.milestones : [];
  const next = list.find((m) => m > followerCount);
  return next ? formatCount(next) : '—';
}

// Rolling count-up for the HUD number — a big jump (batch test-follows,
// reconnect resync) animates a bit longer than a single +1 so it still
// reads as one continuous roll rather than a blur.
let displayedFollowerCount = followerCount;
let countAnim = null;

function currentDisplayedValue(now) {
  if (!countAnim) return displayedFollowerCount;
  const t = Math.min(1, (now - countAnim.start) / countAnim.duration);
  const eased = 1 - Math.pow(1 - t, 3);
  return countAnim.from + (countAnim.to - countAnim.from) * eased;
}

function animateFollowerCountTo(target) {
  const now = performance.now();
  const from = currentDisplayedValue(now);
  const duration = Math.min(900, Math.max(280, Math.abs(target - from) * 40));
  countAnim = { from, to: target, start: now, duration };
}

function tickCounter() {
  requestAnimationFrame(tickCounter);
  if (!countAnim) return;
  const now = performance.now();
  displayedFollowerCount = currentDisplayedValue(now);
  followerCountEl.textContent = formatCount(displayedFollowerCount);
  if (now >= countAnim.start + countAnim.duration) {
    displayedFollowerCount = countAnim.to;
    followerCountEl.textContent = formatCount(displayedFollowerCount);
    countAnim = null;
  }
}
requestAnimationFrame(tickCounter);

function updateHud({ animateCount = true } = {}) {
  if (animateCount) {
    animateFollowerCountTo(followerCount);
  } else {
    displayedFollowerCount = followerCount;
    followerCountEl.textContent = formatCount(displayedFollowerCount);
  }
  nextLevelEl.textContent = nextMilestone();
}
updateHud({ animateCount: false });

let gainTimer = null;
function showGain(username) {
  gainLine1.textContent = '+1 FOLLOWER';
  if (username && settings.usernamesEnabled !== false) {
    gainLine2.textContent = `@${username}`;
    gainLine2.style.display = 'block';
  } else {
    gainLine2.style.display = 'none';
  }
  gainBanner.classList.add('show');
  clearTimeout(gainTimer);
  gainTimer = setTimeout(() => gainBanner.classList.remove('show'), 3000);
}

const COMBO_MESSAGES = {
  2: 'DOUBLE FOLLOW!',
  5: 'FOLLOW STREAK x5',
  10: 'ON FIRE x10',
  25: 'UNSTOPPABLE x25',
  50: 'LEGENDARY STREAK x50',
};
let comboTimer = null;
function showCombo(n) {
  comboBanner.textContent = COMBO_MESSAGES[n] || `COMBO x${n}!`;
  comboBanner.classList.add('show');
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => comboBanner.classList.remove('show'), 1800);
}

let milestoneTimer = null;
function showMilestone(value) {
  milestoneCountEl.textContent = `${formatCount(value)} FOLLOWERS`;
  milestoneBanner.classList.add('show');
  clearTimeout(milestoneTimer);
  milestoneTimer = setTimeout(() => milestoneBanner.classList.remove('show'), 4000);
}

new ReconnectingSocket({
  channel: initialState.channel || 'tower',
  onMessage(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'tower:block_added':
        followerCount = msg.followerCount ?? followerCount + 1;
        if (msg.block) tower.addBlock(msg.block);
        showGain(msg.block?.username || null);
        updateHud();
        if (msg.combo) showCombo(msg.combo);
        if (msg.milestone) showMilestone(msg.milestone);
        break;
      case 'tower:reset':
        followerCount = 0;
        tower.buildFromState([]);
        updateHud({ animateCount: false });
        break;
      case 'tower:settings':
        settings = msg.settings || settings;
        stage.dataset.position = settings.position || 'bottom-right';
        tower.applySettings(settings);
        updateHud({ animateCount: false });
        break;
      case 'tower:state':
        followerCount = msg.followerCount ?? followerCount;
        tower.buildFromState(msg.blocks || []);
        updateHud({ animateCount: false });
        break;
      default:
        break;
    }
  },
});
