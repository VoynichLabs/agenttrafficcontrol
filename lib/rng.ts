// lib/rng.ts — Minimal seeded RNG for deterministic visual rendering.
// The simulation engine has been removed; this stub is retained because
// RadarCanvas uses it to produce stable agent trajectories from agent IDs.

export interface RNG {
  next(): number;        // [0, 1)
  bool(): boolean;
  float(min: number, max: number): number;
}

/** Mulberry32 — fast, seedable, good enough for visual purposes */
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let z = Math.imul(seed ^ seed >>> 15, 1 | seed);
    z = z + Math.imul(z ^ z >>> 7, 61 | z) ^ z;
    return ((z ^ z >>> 14) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRNG(seed: string): RNG {
  const raw = mulberry32(hashString(seed));
  return {
    next: raw,
    bool: () => raw() >= 0.5,
    float: (min: number, max: number) => min + raw() * (max - min),
  };
}
