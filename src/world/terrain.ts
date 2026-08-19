/**
 * GitForest — Terreno
 *
 * Fonte única de verdade da altura do solo.
 *
 * Este módulo existe por um motivo bem específico: no momento em que o chão
 * deixa de ser plano, *tudo* precisa concordar sobre onde ele está. A árvore
 * precisa nascer na superfície, cada talo de grama precisa tocar o solo, e a
 * câmera precisa saber que não pode atravessá-lo. Se cada um desses cálculos
 * usar a sua própria versão da altura, a cena desmonta.
 *
 * Por isso `heightAt(x, z)` é uma função pura, determinística e compartilhada
 * por todos os consumidores — CPU apenas, sem contraparte em GLSL (ver a nota
 * de arquitetura em `noise.ts`).
 */

import * as THREE from 'three';
import { createNoise2D, fbm2D, smoothstep, type Noise2D } from './noise';
import { clamp01, lerp } from '../utils/math';

// ============================================================
// Configuração
// ============================================================

/** Uma clareira achata o terreno para que uma árvore possa se apoiar nele. */
export interface ClearingSite {
  x: number;
  z: number;
  /** Raio totalmente plano */
  radius: number;
  /** Largura da transição entre o plano e o relevo natural */
  falloff: number;
}

export interface TerrainConfig {
  seed: number;
  /** Largura total da malha detalhada (unidades de mundo) */
  size: number;
  /** Divisões por eixo — define o tamanho das facetas low-poly */
  segments: number;
  /** Amplitude do relevo em unidades de mundo */
  amplitude: number;
  /** Frequência base do ruído (1/frequência ≈ tamanho das colinas) */
  frequency: number;
  octaves: number;
  lacunarity: number;
  persistence: number;
  /** Elevação suave no centro — o morro onde a árvore principal fica */
  moundHeight: number;
  moundRadius: number;
  clearings: ClearingSite[];
}

export const DEFAULT_TERRAIN_CONFIG: TerrainConfig = {
  seed: 20260817,
  size: 640,
  segments: 176,
  amplitude: 15,
  frequency: 0.011,
  octaves: 4,
  lacunarity: 2.05,
  persistence: 0.48,
  moundHeight: 8,
  moundRadius: 45,
  clearings: [{ x: 0, z: 0, radius: 6.5, falloff: 8 }],
};

// ============================================================
// Paleta
// ============================================================

type RGB = [number, number, number];

const hex = (h: string): RGB => {
  const c = new THREE.Color(h);
  return [c.r, c.g, c.b];
};

/** Fundo de vale: mais úmido, verde saturado */
const C_VALE = hex('#33612f');
/** Encosta suave: verde-oliva */
const C_ENCOSTA = hex('#4f7a3e');
/** Crista exposta: seca, ocre */
const C_CRISTA = hex('#9a8c4e');
/** Declive acentuado: rocha aflorando */
const C_ROCHA = hex('#6d675f');

/** Acima deste declive a grama não se segura e a rocha aparece. */
const SLOPE_ROCK_START = 0.34;
const SLOPE_ROCK_FULL = 0.68;

/**
 * Ganho aplicado à curvatura antes do sombreamento.
 * Concavidades (vales, dobras) escurecem; convexidades (cristas) clareiam.
 * É um oclusão-ambiente de pobre, mas dá muita leitura de volume ao low-poly.
 */
const CURVATURE_GAIN = 4.0;
const CURVATURE_EPS = 4.0;

/** Passo usado nas diferenças finitas que estimam a normal. */
const NORMAL_EPS = 1.0;

// ============================================================
// API
// ============================================================

export interface Terrain {
  readonly config: TerrainConfig;
  /** Altura do solo em (x, z), já com morro central e clareiras aplicados. */
  heightAt(x: number, z: number): number;
  /** Normal da superfície por diferenças finitas. */
  normalAt(x: number, z: number): RGB;
  /** 0 = plano, →1 = vertical. */
  slopeAt(x: number, z: number): number;
  /** Cor do solo em (x, z), por altitude, declive e curvatura. */
  colorAt(x: number, z: number): RGB;
  /** Malha facetada do terreno detalhado. Construída sob demanda e cacheada. */
  buildGeometry(): THREE.BufferGeometry;
}

export function createTerrain(
  config: TerrainConfig = DEFAULT_TERRAIN_CONFIG,
): Terrain {
  const noise: Noise2D = createNoise2D(config.seed);
  const fbmOpts = {
    octaves: config.octaves,
    lacunarity: config.lacunarity,
    persistence: config.persistence,
  };

  const invMound2 = 1 / (2 * config.moundRadius * config.moundRadius);

  /**
   * Relevo bruto, antes das clareiras.
   * Precisa ficar separado de `heightAt` para evitar recursão: a clareira
   * interpola em direção ao relevo *bruto* do seu próprio centro.
   */
  function rawHeight(x: number, z: number): number {
    const n = fbm2D(noise, x * config.frequency, z * config.frequency, fbmOpts);
    const mound =
      config.moundHeight * Math.exp(-(x * x + z * z) * invMound2);
    return n * config.amplitude + mound;
  }

  // A altura do centro de cada clareira é constante — vale pré-calcular
  const clearingLevels = config.clearings.map((c) => rawHeight(c.x, c.z));

  function heightAt(x: number, z: number): number {
    let h = rawHeight(x, z);

    for (let i = 0; i < config.clearings.length; i++) {
      const c = config.clearings[i];
      const dx = x - c.x;
      const dz = z - c.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // 1 dentro do raio plano, decaindo suavemente até 0 na borda externa
      const mask = 1 - smoothstep(c.radius, c.radius + c.falloff, dist);
      if (mask > 0) h = lerp(h, clearingLevels[i], mask);
    }

    return h;
  }

  function normalAt(x: number, z: number): RGB {
    const e = NORMAL_EPS;
    const hL = heightAt(x - e, z);
    const hR = heightAt(x + e, z);
    const hD = heightAt(x, z - e);
    const hU = heightAt(x, z + e);

    let nx = hL - hR;
    const ny = 2 * e;
    let nz = hD - hU;

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx /= len;
    nz /= len;
    return [nx, ny / len, nz];
  }

  function slopeAt(x: number, z: number): number {
    return clamp01(1 - normalAt(x, z)[1]);
  }

  /** Laplaciano discreto: > 0 em concavidades, < 0 em cristas. */
  function curvatureAt(x: number, z: number, h: number): number {
    const e = CURVATURE_EPS;
    const avg =
      (heightAt(x - e, z) +
        heightAt(x + e, z) +
        heightAt(x, z - e) +
        heightAt(x, z + e)) /
      4;
    return avg - h;
  }

  function mixRGB(a: RGB, b: RGB, t: number): RGB {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
  }

  /**
   * Combina altitude, declive e curvatura numa cor de solo.
   * Exportada via `colorAt` porque a grama sampleia a mesma função — é assim
   * que talo e chão acabam concordando de cor em vez de brigarem.
   */
  function shade(
    height: number,
    slope: number,
    curvature: number,
  ): RGB {
    // Altitude normalizada: 0 no fundo do vale, 1 no topo alcançável.
    //
    // O teto vai bem além da amplitude do ruído de propósito. Com um teto
    // justo, o morro central (que soma `moundHeight` por cima do relevo)
    // saturava a escala e pintava de ocre justamente a encosta onde a árvore
    // fica — uma paisagem inteira parecendo seca.
    const altitude = smoothstep(
      -config.amplitude * 0.5,
      config.amplitude + config.moundHeight * 1.4,
      height,
    );

    let c = mixRGB(C_VALE, C_ENCOSTA, smoothstep(0.1, 0.55, altitude));
    // Ocre é exceção, não regra: só o alto das cristas seca de verdade
    c = mixRGB(c, C_CRISTA, smoothstep(0.84, 1.0, altitude));
    c = mixRGB(c, C_ROCHA, smoothstep(SLOPE_ROCK_START, SLOPE_ROCK_FULL, slope));

    // Dobras escurecem, lombadas clareiam
    const ao = lerp(
      1.12,
      0.78,
      smoothstep(-1, 1, curvature * CURVATURE_GAIN),
    );

    return [c[0] * ao, c[1] * ao, c[2] * ao];
  }

  function colorAt(x: number, z: number): RGB {
    const h = heightAt(x, z);
    return shade(h, slopeAt(x, z), curvatureAt(x, z, h));
  }

  let cachedGeometry: THREE.BufferGeometry | null = null;

  function buildGeometry(): THREE.BufferGeometry {
    if (cachedGeometry) return cachedGeometry;

    const { size, segments } = config;
    const geom = new THREE.PlaneGeometry(size, size, segments, segments);
    geom.rotateX(-Math.PI / 2); // plano XY → plano XZ

    const pos = geom.attributes.position;
    const vertexCount = pos.count;

    // 1. Deslocamento vertical
    for (let i = 0; i < vertexCount; i++) {
      pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    }

    // 2. Cor por vértice (indexado — muito mais barato que por face)
    const colors = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      const [r, g, b] = colorAt(pos.getX(i), pos.getZ(i));
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // 3. Desindexar: cada triângulo passa a ter vértices próprios, o que
    //    permite normais e cores planas — o visual facetado do projeto.
    const flat = geom.toNonIndexed();
    geom.dispose();

    // 4. Achatar a cor por face (média dos 3 cantos)
    const fc = flat.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < fc.count; i += 3) {
      const r = (fc.getX(i) + fc.getX(i + 1) + fc.getX(i + 2)) / 3;
      const g = (fc.getY(i) + fc.getY(i + 1) + fc.getY(i + 2)) / 3;
      const b = (fc.getZ(i) + fc.getZ(i + 1) + fc.getZ(i + 2)) / 3;
      for (let k = 0; k < 3; k++) fc.setXYZ(i + k, r, g, b);
    }
    fc.needsUpdate = true;

    // 5. Em geometria desindexada, `computeVertexNormals` produz a normal da
    //    face repetida nos 3 vértices — ou seja, flat shading de graça.
    flat.computeVertexNormals();
    flat.computeBoundingSphere();

    cachedGeometry = flat;
    return flat;
  }

  return {
    config,
    heightAt,
    normalAt,
    slopeAt,
    colorAt,
    buildGeometry,
  };
}

// ============================================================
// Instância compartilhada
// ============================================================

let shared: Terrain | null = null;

/**
 * Terreno global da cena.
 *
 * É um singleton de propósito: a malha, a grama, a árvore e a câmera precisam
 * consultar exatamente o mesmo relevo, e recriá-lo por componente custaria
 * centenas de milissegundos além de abrir espaço para divergência.
 */
export function getTerrain(): Terrain {
  if (!shared) shared = createTerrain(DEFAULT_TERRAIN_CONFIG);
  return shared;
}
