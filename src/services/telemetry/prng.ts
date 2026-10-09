// Seeded PRNG so mock feeds are reproducible: same seed and clock → same telemetry,
// on the server, in the browser and in tests.

export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, good enough for simulation. Returns floats in [0, 1). */
export function rng(seed: number | string) {
  let a = typeof seed === "string" ? seedFrom(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample (Box–Muller). */
export function gaussian(next: () => number) {
  const u = Math.max(next(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
}

/** Smooth deterministic noise in [-1, 1] for a key and a continuous position (e.g. hours). */
export function smoothNoise(key: string, x: number) {
  const i = Math.floor(x);
  const f = x - i;
  const a = rng(`${key}:${i}`)() * 2 - 1;
  const b = rng(`${key}:${i + 1}`)() * 2 - 1;
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

export const HOUR_MS = 3_600_000;
export const addHours = (d: Date, h: number) => new Date(d.getTime() + h * HOUR_MS);
export const hoursBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / HOUR_MS;
export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const round = (v: number, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits;
