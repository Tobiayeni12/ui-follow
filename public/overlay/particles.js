import * as THREE from 'three';

// Cheap, self-contained particle burst: a single THREE.Points cloud reused
// across bursts (no per-burst allocation) so it stays light on the GPU even
// over multi-hour streams.
export class ParticleBurst {
  constructor(scene, { maxParticles = 60 } = {}) {
    this.maxParticles = maxParticles;
    this.positions = new Float32Array(maxParticles * 3);
    this.velocities = new Float32Array(maxParticles * 3);
    this.life = new Float32Array(maxParticles); // remaining life, seconds
    this.maxLife = new Float32Array(maxParticles);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    const material = new THREE.PointsMaterial({
      size: 0.09,
      map: makeSpriteTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: false,
      color: new THREE.Color('#7CFBFF'),
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this._activeUntil = 0;
  }

  burst(origin, count = 24, colorA = '#25F4EE', colorB = '#FE2C55') {
    const n = Math.min(count, this.maxParticles);
    const cA = new THREE.Color(colorA);
    const cB = new THREE.Color(colorB);
    this.points.material.color = cA.lerp(cB, 0.5);
    this.points.material.opacity = 1;

    for (let i = 0; i < n; i++) {
      const idx = i * 3;
      this.positions[idx] = origin.x;
      this.positions[idx + 1] = origin.y;
      this.positions[idx + 2] = origin.z;

      const theta = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 1.6;
      this.velocities[idx] = Math.cos(theta) * speed;
      this.velocities[idx + 1] = Math.random() * 2.2 + 0.4;
      this.velocities[idx + 2] = Math.sin(theta) * speed * 0.6;

      this.maxLife[i] = 0.7 + Math.random() * 0.5;
      this.life[i] = this.maxLife[i];
    }
    // Park any unused particles far away so they don't render.
    for (let i = n; i < this.maxParticles; i++) {
      this.life[i] = 0;
    }
    this._activeCount = n;
  }

  update(dt) {
    let anyAlive = false;
    for (let i = 0; i < this._activeCount || 0; i++) {
      if (this.life[i] <= 0) continue;
      anyAlive = true;
      const idx = i * 3;
      this.velocities[idx + 1] -= 2.4 * dt; // gravity
      this.positions[idx] += this.velocities[idx] * dt;
      this.positions[idx + 1] += this.velocities[idx + 1] * dt;
      this.positions[idx + 2] += this.velocities[idx + 2] * dt;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // move offscreen
        this.positions[idx + 1] = -9999;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.material.opacity = anyAlive ? Math.min(1, this.points.material.opacity) : 0;
    if (!anyAlive) this.points.material.opacity = 0;
  }
}

function makeSpriteTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
