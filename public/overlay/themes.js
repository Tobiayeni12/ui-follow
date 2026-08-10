// Shared theme presets — imported by scene.js (3D material/lighting),
// overlay.js (HTML label colors), and dashboard.js (theme picker options).
// Plain data only; no THREE.js dependency here so it can be reused everywhere.
export const THEMES = {
  classic: {
    label: 'Classic (Cyan/Pink)',
    material: { color: 0x1c2740, metalness: 0.85, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 2.6 },
    lightIntensityScale: 1,
    texture: null,
    rimColorA: '#25F4EE',
    rimColorB: '#FE2C55',
    glowColor: '#25F4EE',
    particleColorA: '#25F4EE',
    particleColorB: '#FE2C55',
    html: {
      titleColor: '#eafffe',
      titleGlow: '0 0 12px rgba(37,244,238,0.85), 0 0 28px rgba(37,244,238,0.35)',
      goalColor: '#ffd7e6',
      goalGlow: '0 0 10px rgba(254,44,85,0.75)',
      gainGlow: '0 0 10px rgba(254,44,85,0.9), 0 0 26px rgba(37,244,238,0.55)',
    },
  },
  spiderman: {
    label: 'Spider-Man (Red & Webs)',
    material: { color: 0xffffff, metalness: 0.08, roughness: 0.6, clearcoat: 0.2, clearcoatRoughness: 0.45, reflectivity: 0.25, envMapIntensity: 0.5 },
    lightIntensityScale: 0.6,
    texture: 'web-red',
    rimColorA: '#2b3ea8',
    rimColorB: '#ffffff',
    glowColor: '#ff1e2d',
    particleColorA: '#ff1e2d',
    particleColorB: '#ffffff',
    html: {
      titleColor: '#ffffff',
      titleGlow: '0 0 12px rgba(255,30,45,0.9), 0 0 28px rgba(43,62,168,0.5)',
      goalColor: '#ffffff',
      goalGlow: '0 0 10px rgba(255,30,45,0.85)',
      gainGlow: '0 0 10px rgba(255,30,45,0.9), 0 0 26px rgba(43,62,168,0.6)',
    },
  },
  inferno: {
    label: 'Inferno (Orange/Gold)',
    material: { color: 0x2a1408, metalness: 0.8, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.8 },
    lightIntensityScale: 0.85,
    texture: null,
    rimColorA: '#FF8A00',
    rimColorB: '#FFD34D',
    glowColor: '#FF8A00',
    particleColorA: '#FF8A00',
    particleColorB: '#FFD34D',
    html: {
      titleColor: '#fff4e0',
      titleGlow: '0 0 12px rgba(255,138,0,0.85), 0 0 28px rgba(255,211,77,0.4)',
      goalColor: '#ffe3b0',
      goalGlow: '0 0 10px rgba(255,138,0,0.75)',
      gainGlow: '0 0 10px rgba(255,138,0,0.9), 0 0 26px rgba(255,211,77,0.55)',
    },
  },
  cyberpunk: {
    label: 'Cyberpunk (Purple/Green)',
    material: { color: 0x1a0f2e, metalness: 0.85, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 2.2 },
    lightIntensityScale: 1,
    texture: null,
    rimColorA: '#B15CFF',
    rimColorB: '#39FF88',
    glowColor: '#B15CFF',
    particleColorA: '#B15CFF',
    particleColorB: '#39FF88',
    html: {
      titleColor: '#f1e6ff',
      titleGlow: '0 0 12px rgba(177,92,255,0.85), 0 0 28px rgba(57,255,136,0.35)',
      goalColor: '#d9ffe9',
      goalGlow: '0 0 10px rgba(57,255,136,0.75)',
      gainGlow: '0 0 10px rgba(177,92,255,0.9), 0 0 26px rgba(57,255,136,0.55)',
    },
  },
};

export const DEFAULT_THEME = 'classic';

export function resolveTheme(key) {
  return THEMES[key] || THEMES[DEFAULT_THEME];
}
