/**
 * GitForest — Ruído Procedural Seedado
 *
 * Simplex 2D com tabela de permutação embaralhada por Mulberry32,
 * mais os agregadores fBm e ridged usados pelo terreno e pelos morros.
 *
 * Regra do projeto: nada aqui pode usar `Math.random()`. Toda a paisagem
 * precisa ser reproduzível a partir de uma seed — mesma seed, mesma cena.
 *
 * Nota de arquitetura: o deslocamento do terreno é calculado inteiramente
 * na CPU (ver `terrain.ts`). Não existe uma versão GLSL destas funções, e
 * isso é intencional — replicar hash de ponto flutuante entre JS e GLSL é
 * frágil, e o terreno é uma malha estática que só precisa ser gerada uma vez.
 * Os shaders usam ruído próprio apenas para efeitos temporais (vento).
 */

import { createRNG } from '../utils/math';

/** Gradientes 2D (as 12 direções canônicas do simplex 3D, projetadas). */
const GRAD3 = new Int8Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

export type Noise2D = (x: number, y: number) => number;

/**
 * Cria uma função de ruído simplex 2D determinística.
 * Retorna valores aproximadamente em [-1, 1].
 */
export function createNoise2D(seed: number): Noise2D {
  const rng = createRNG(seed);

  // Permutação embaralhada (Fisher-Yates com o PRNG seedado)
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }

  // Tabelas duplicadas evitam o `& 255` dentro do laço quente
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }

  const dot = (gi: number, x: number, y: number) =>
    GRAD3[gi * 3] * x + GRAD3[gi * 3 + 1] * y;

  return function noise2D(xin: number, yin: number): number {
    // Distorce o espaço para a grade simplex
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);

    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    // Em qual dos dois triângulos da célula caímos?
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = permMod12[ii + perm[jj]];
    const gi1 = permMod12[ii + i1 + perm[jj + j1]];
    const gi2 = permMod12[ii + 1 + perm[jj + 1]];

    let n0 = 0;
    let n1 = 0;
    let n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      t0 *= t0;
      n0 = t0 * t0 * dot(gi0, x0, y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      t1 *= t1;
      n1 = t1 * t1 * dot(gi1, x1, y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      t2 *= t2;
      n2 = t2 * t2 * dot(gi2, x2, y2);
    }

    // 70 é o fator que normaliza a soma para ~[-1, 1]
    return 70 * (n0 + n1 + n2);
  };
}

export interface FbmOptions {
  octaves: number;
  lacunarity: number;
  persistence: number;
}

/**
 * Soma fracionária de oitavas (fBm). Resultado normalizado para ~[-1, 1].
 *
 * `lacunarity` multiplica a frequência a cada oitava (detalhe mais fino),
 * `persistence` multiplica a amplitude (contribuição menor).
 */
export function fbm2D(
  noise: Noise2D,
  x: number,
  y: number,
  { octaves, lacunarity, persistence }: FbmOptions,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;

  for (let o = 0; o < octaves; o++) {
    sum += noise(x * frequency, y * frequency) * amplitude;
    norm += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return norm > 0 ? sum / norm : 0;
}

/**
 * fBm "ridged": inverte o valor absoluto para produzir cristas afiadas
 * em vez de colinas arredondadas. Usado nas silhuetas de montanha ao fundo.
 * Retorna valores em [0, 1].
 */
export function ridged2D(
  noise: Noise2D,
  x: number,
  y: number,
  { octaves, lacunarity, persistence }: FbmOptions,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;

  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise(x * frequency, y * frequency));
    sum += n * n * amplitude;
    norm += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return norm > 0 ? sum / norm : 0;
}

/**
 * Interpolação suave de Hermite entre duas bordas, equivalente ao
 * `smoothstep` do GLSL.
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
