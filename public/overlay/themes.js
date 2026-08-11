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
    label: 'Spider-Man (Red & Blue)',
    // Two-tone: red front face + blue extruded bevel/sides — a color-only
    // homage to the classic red/blue hero costume palette. Not a font/logo
    // reproduction (see counterFont: pick a bold option like Optimer Bold
    // in the dashboard for the most geometric, angular look available).
    material: { color: '#A80F1F', metalness: 0.15, roughness: 0.4, clearcoat: 0.25, clearcoatRoughness: 0.3, reflectivity: 0.3, envMapIntensity: 0.6 },
    material2: { color: '#1B3FA0', metalness: 0.3, roughness: 0.4, clearcoat: 0.4, clearcoatRoughness: 0.25, reflectivity: 0.4, envMapIntensity: 1 },
    lightIntensityScale: 0.65,
    toneMapping: 'none',
    texture: null,
    rimColorA: '#1B3FA0',
    rimColorB: '#ffffff',
    glowColor: '#E11A2B',
    particleColorA: '#E11A2B',
    particleColorB: '#1B3FA0',
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
  horror: {
    label: 'Horror (Spooky Cobwebs)',
    // No texture — cobwebs for this theme are real 3D geometry (see
    // scene.js _rebuildCobwebs), strands hanging between the digits rather
    // than a pattern painted onto their surface.
    material: { color: '#150a19', metalness: 0.15, roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.4, reflectivity: 0.3, envMapIntensity: 1 },
    material2: { color: '#7c8a6c', metalness: 0.1, roughness: 0.65, clearcoat: 0.15, clearcoatRoughness: 0.5, reflectivity: 0.2, envMapIntensity: 0.8 },
    lightIntensityScale: 0.8,
    texture: null,
    cobwebColor: '#cfd8cc',
    rimColorA: '#57FF7A',
    rimColorB: '#9FC6FF',
    glowColor: '#57FF7A',
    particleColorA: '#57FF7A',
    particleColorB: '#cfd6d2',
    html: {
      titleColor: '#d8f5e2',
      titleGlow: '0 0 12px rgba(87,255,122,0.85), 0 0 28px rgba(159,198,255,0.35)',
      goalColor: '#c9d6c9',
      goalGlow: '0 0 10px rgba(87,255,122,0.7)',
      gainGlow: '0 0 10px rgba(87,255,122,0.9), 0 0 26px rgba(159,198,255,0.6)',
    },
  },
};

export const DEFAULT_THEME = 'classic';

export function resolveTheme(key) {
  return THEMES[key] || THEMES[DEFAULT_THEME];
}
