/**
 * GitForest — Utilitários Matemáticos
 *
 * PRNG seedado (mulberry32), funções de interpolação,
 * e helpers para transformações 3D.
 */

/**
 * Gerador de números pseudo-aleatórios seedado (Mulberry32).
 * Garante que a mesma seed sempre gera a mesma sequência.
 */
export function createRNG(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Interpola linearmente entre min e max com t ∈ [0, 1].
 */
export function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * clamp01(t);
}

/**
 * Limita um valor entre 0 e 1.
 */
export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Limita um valor entre min e max.
 */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Mapeia um valor de um range para outro.
 */
export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const t = clamp01((value - inMin) / (inMax - inMin));
  return lerp(outMin, outMax, t);
}

/**
 * Converte graus para radianos.
 */
export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Gera um hash numérico a partir de uma string (para seeds).
 */
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Normaliza um valor usando uma escala logarítmica.
 * Útil para dados com distribuição muito desigual (ex: stars, commits).
 */
export function logNormalize(
  value: number,
  maxExpected: number,
): number {
  if (value <= 0) return 0;
  return clamp01(Math.log(value + 1) / Math.log(maxExpected + 1));
}
