/* =========================================================================
   Solenne: world constants. Altitudes are metres above the meadow datum
   (the prototype's y = 0); the cloud sea top sits just below it.
   ========================================================================= */
export const PLANET_R = 81920;               // face width 2R / 2^11 / 32 quads = 2.5 m at the finest LOD
export const G0 = 9.81;
export const GM = G0 * PLANET_R * PLANET_R;
export const DAY_SECONDS = 86400;
export const LATITUDE = 48 * Math.PI / 180;  // spawn latitude (rotation axis tilted toward -Z)

// spawn region: the prototype plateau, centred on the +Y cube face
export const WORLD = 1400;                   // region heightfield extent in metres
export const GRID = 561;                     // samples per side
export const DX = WORLD / (GRID - 1);        // 2.5 m spacing
export const HALF = WORLD / 2;
export const REGION_BLEND: [number, number] = [600, 690];

export const SEA_TOP = -32;                  // nominal top of the cloud sea
export const SEA_BASE = -250;               // lumpy underside of the cloud-sea deck
export const LOWLAND = -640;                 // floor of the world under the clouds
export const WATER = -690;                   // sea level of Solenne's oceans, lakes and rivers
export const EYE = 1.68;

// the Seren system (space/system.ts): distances and sizes are compressed so the sky reads well
export const ORBIT_A = 2.0e9;                // Solenne's mean distance from its sun (m)
export const YEAR_DAYS = 32;                 // a year of 32 days: four seasons of eight
export const OBLIQUITY = 16 * Math.PI / 180; // axial tilt: noon sun at home 26°–58° through the year
export const SUN_ANG = 1.4 * Math.PI / 180;  // apparent radius of the sun's disc (matches the sky shader)
export const MAP_W = 1024, MAP_H = 512;      // baked surface maps of the far bodies (equirectangular)
export const RING_W = 512;                   // ring profiles, inner to outer edge

// atmosphere
export const ATMO_H = 2500;                  // density scale height
export const ATMO_TOP = 26000;

// quadtree
export const CHUNK_SEG = 32;
export const MAX_LEVEL = 11;
export const SPLIT_K = 2.3;

export type Quality = { pr: number; cloud: number; steps: number; stepK: number; near: [number, number]; far: [number, number]; msaa: number; flowersR: number; bloom: number; drops: number };
export const QUALITY: Record<string, Quality> = {
  low:    { pr: 0.85, cloud: 0.34, steps: 70,  stepK: 0.030, near: [17, 0.15], far: [60, 0.44],  msaa: 2, flowersR: 26, bloom: 0.5, drops: 3500 },
  medium: { pr: 1.25, cloud: 0.5,  steps: 100, stepK: 0.022, near: [25, 0.12], far: [85, 0.34],  msaa: 4, flowersR: 40, bloom: 0.6, drops: 7000 },
  high:   { pr: 2.0,  cloud: 0.62, steps: 130, stepK: 0.016, near: [32, 0.10], far: [110, 0.30], msaa: 4, flowersR: 52, bloom: 0.6, drops: 12000 },
};

export const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
export const LAND_RES = 128;                 // land-mask atlas texels per cube face
