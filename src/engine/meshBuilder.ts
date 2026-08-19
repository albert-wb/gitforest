/**
 * GitForest — Construtor de Malha
 *
 * Converte uma `TreeGeometry` (segmentos e folhas abstratos) direto em typed
 * arrays prontos para virar `BufferGeometry`.
 *
 * Duas restrições moldaram este arquivo:
 *
 * 1. **Nada de Three.js aqui.** Este código roda dentro de um Web Worker, e
 *    importar o Three duplicaria umas centenas de kilobytes no bundle do
 *    worker para usar meia dúzia de operações de matriz. A matemática de base
 *    ortonormal e composição de matriz cabe em algumas dezenas de linhas.
 * 2. **Saída transferível.** Tudo sai como `Float32Array`, cujo `ArrayBuffer`
 *    é transferido de volta para a thread principal em vez de copiado.
 *
 * O caminho da árvore em foco (`components/Tree/*`) continua construindo a
 * geometria na thread principal com o shader de casca completo. Este módulo
 * atende as árvores de fundo, onde o que importa é volume, não detalhe.
 */

import type { TreeGeometry, TreeSegment } from './types';
import type { SpeciesProfile } from './species';
import { toFoliageColor } from '../utils/colors';

export interface TreeMeshBuffers {
  /** Vértices dos cilindros de tronco, galhos e raízes. */
  branchPositions: Float32Array;
  branchNormals: Float32Array;
  branchColors: Float32Array;
  /** Matriz 4×4 por folha, em ordem de coluna (16 floats cada). */
  leafMatrices: Float32Array;
  leafColors: Float32Array;
  leafCount: number;
  /** Altura e raio da árvore, para bounding e para posicionar a rede. */
  height: number;
  radius: number;
}

export interface MeshOptions {
  /** Lados do cilindro. 3 já é suficiente para uma árvore distante. */
  radialSegments: number;
  /** Teto de folhas. A lista já vem embaralhada, então cortar é desbaste. */
  leafBudget: number;
}

type Vec3 = [number, number, number];

const DEAD_BARK: Vec3 = [0.28, 0.27, 0.24];

// ============================================================
// Matemática vetorial mínima
// ============================================================

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-8) return [0, 1, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Constrói dois vetores perpendiculares ao eixo dado.
 *
 * O vetor de referência precisa mudar quando o eixo é quase vertical, senão
 * o produto vetorial degenera e o anel do cilindro colapsa — o que aparece
 * como galhos sumindo justamente nos trechos verticais.
 */
function perpendicularBasis(axis: Vec3): [Vec3, Vec3] {
  const reference: Vec3 = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(reference, axis));
  const v = normalize(cross(axis, u));
  return [u, v];
}

function hexToRgbTriple(hex: string): Vec3 {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [0.5, 0.5, 0.5];
  return [
    parseInt(m[1], 16) / 255,
    parseInt(m[2], 16) / 255,
    parseInt(m[3], 16) / 255,
  ];
}

// ============================================================
// Construção
// ============================================================

/**
 * Gera os buffers de malha de uma árvore inteira.
 *
 * Os cilindros saem sem tampa (`open ended`): numa árvore de fundo as tampas
 * ficam ocultas dentro das emendas e custam cerca de 40% dos vértices.
 */
export function buildTreeMesh(
  geometry: TreeGeometry,
  species: SpeciesProfile,
  options: MeshOptions,
): TreeMeshBuffers {
  const segments = [...geometry.segments, ...geometry.roots];
  const radial = Math.max(3, options.radialSegments);

  // Cada segmento vira `radial` quads = radial * 6 vértices (não indexado,
  // porque o facetado exige normais por face)
  const vertsPerSegment = radial * 6;
  const totalVerts = segments.length * vertsPerSegment;

  const branchPositions = new Float32Array(totalVerts * 3);
  const branchNormals = new Float32Array(totalVerts * 3);
  const branchColors = new Float32Array(totalVerts * 3);

  const barkDark = hexToRgbTriple(species.barkDark);
  const barkLight = hexToRgbTriple(species.barkLight);
  const trunkDark: Vec3 = [
    barkDark[0] * 0.78,
    barkDark[1] * 0.78,
    barkDark[2] * 0.78,
  ];

  let cursor = 0;
  let maxHeight = 0;
  let maxRadius = 0;

  for (const seg of segments) {
    cursor = writeSegment(
      seg,
      radial,
      { barkDark, barkLight, trunkDark },
      branchPositions,
      branchNormals,
      branchColors,
      cursor,
    );

    maxHeight = Math.max(maxHeight, seg.start[1], seg.end[1]);
    maxRadius = Math.max(
      maxRadius,
      Math.hypot(seg.end[0], seg.end[2]),
      Math.hypot(seg.start[0], seg.start[2]),
    );
  }

  // ---------- Folhas ----------

  const leafCount = Math.min(geometry.leaves.length, options.leafBudget);
  const leafMatrices = new Float32Array(leafCount * 16);
  const leafColors = new Float32Array(leafCount * 3);

  // A conversão de cor é cara e uma copa tem meia dúzia de linguagens
  const foliageCache = new Map<string, Vec3>();

  for (let i = 0; i < leafCount; i++) {
    const leaf = geometry.leaves[i];

    const forward = normalize(leaf.normal as Vec3);
    const [u, v] = perpendicularBasis(forward);

    // Giro próprio pelo ângulo áureo: folhas vizinhas nunca ficam paralelas
    const spin = (i * 2.39996) % (Math.PI * 2);
    const cos = Math.cos(spin);
    const sin = Math.sin(spin);
    const right: Vec3 = [
      u[0] * cos + v[0] * sin,
      u[1] * cos + v[1] * sin,
      u[2] * cos + v[2] * sin,
    ];
    const up = cross(forward, right);

    const variation = 0.75 + (Math.sin(i * 1.618) * 0.5 + 0.5) * 0.5;
    const s = leaf.scale * variation;

    const o = i * 16;
    leafMatrices[o] = right[0] * s;
    leafMatrices[o + 1] = right[1] * s;
    leafMatrices[o + 2] = right[2] * s;
    leafMatrices[o + 3] = 0;
    leafMatrices[o + 4] = up[0] * s;
    leafMatrices[o + 5] = up[1] * s;
    leafMatrices[o + 6] = up[2] * s;
    leafMatrices[o + 7] = 0;
    leafMatrices[o + 8] = forward[0] * s;
    leafMatrices[o + 9] = forward[1] * s;
    leafMatrices[o + 10] = forward[2] * s;
    leafMatrices[o + 11] = 0;
    leafMatrices[o + 12] = leaf.position[0];
    leafMatrices[o + 13] = leaf.position[1];
    leafMatrices[o + 14] = leaf.position[2];
    leafMatrices[o + 15] = 1;

    let foliage = foliageCache.get(leaf.color);
    if (!foliage) {
      foliage = toFoliageColor(
        leaf.color,
        species.foliageBase,
        species.foliageTint,
      ) as Vec3;
      foliageCache.set(leaf.color, foliage);
    }

    const brightness = 0.86 + (Math.sin(i * 2.236) * 0.5 + 0.5) * 0.28;
    leafColors[i * 3] = Math.min(1, foliage[0] * brightness);
    leafColors[i * 3 + 1] = Math.min(1, foliage[1] * brightness);
    leafColors[i * 3 + 2] = Math.min(1, foliage[2] * brightness);
  }

  return {
    branchPositions,
    branchNormals,
    branchColors,
    leafMatrices,
    leafColors,
    leafCount,
    height: maxHeight,
    radius: maxRadius,
  };
}

/** Escreve um tronco de cone (sem tampas) e devolve o novo cursor. */
function writeSegment(
  seg: TreeSegment,
  radial: number,
  palette: { barkDark: Vec3; barkLight: Vec3; trunkDark: Vec3 },
  positions: Float32Array,
  normals: Float32Array,
  colors: Float32Array,
  startCursor: number,
): number {
  let cursor = startCursor;

  const axis: Vec3 = [
    seg.end[0] - seg.start[0],
    seg.end[1] - seg.start[1],
    seg.end[2] - seg.start[2],
  ];
  const length = Math.hypot(axis[0], axis[1], axis[2]);

  // Segmento degenerado: avança o cursor deixando os vértices zerados, para
  // que os offsets continuem batendo com o tamanho pré-alocado.
  if (length < 1e-4) return cursor + radial * 6;

  const dir = normalize(axis);
  const [u, v] = perpendicularBasis(dir);

  let color: Vec3;
  if (seg.isDead) {
    color = DEAD_BARK;
  } else if (seg.branchIndex < 0) {
    // Tronco e raízes: escurecidos, com um leve clareamento na altura
    const t = Math.max(0, Math.min(1, (seg.start[1] + 2) / 10));
    color = [
      palette.trunkDark[0] + (palette.barkLight[0] - palette.trunkDark[0]) * t,
      palette.trunkDark[1] + (palette.barkLight[1] - palette.trunkDark[1]) * t,
      palette.trunkDark[2] + (palette.barkLight[2] - palette.trunkDark[2]) * t,
    ];
  } else {
    const jitter = (seg.branchIndex * 0.037) % 0.1;
    color = [
      (palette.barkDark[0] + palette.barkLight[0]) * 0.5 + jitter,
      (palette.barkDark[1] + palette.barkLight[1]) * 0.5 + jitter * 0.5,
      (palette.barkDark[2] + palette.barkLight[2]) * 0.5,
    ];
  }

  const ringPoint = (
    center: readonly [number, number, number],
    radius: number,
    angle: number,
  ): Vec3 => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
      center[0] + (u[0] * c + v[0] * s) * radius,
      center[1] + (u[1] * c + v[1] * s) * radius,
      center[2] + (u[2] * c + v[2] * s) * radius,
    ];
  };

  for (let i = 0; i < radial; i++) {
    const a0 = (i / radial) * Math.PI * 2;
    const a1 = ((i + 1) / radial) * Math.PI * 2;

    const p00 = ringPoint(seg.start, seg.startRadius, a0);
    const p01 = ringPoint(seg.start, seg.startRadius, a1);
    const p10 = ringPoint(seg.end, seg.endRadius, a0);
    const p11 = ringPoint(seg.end, seg.endRadius, a1);

    // Normal plana da face — é o que dá o facetado low-poly do projeto
    const e1: Vec3 = [p10[0] - p00[0], p10[1] - p00[1], p10[2] - p00[2]];
    const e2: Vec3 = [p01[0] - p00[0], p01[1] - p00[1], p01[2] - p00[2]];
    const n = normalize(cross(e1, e2));

    const tri = [p00, p10, p01, p01, p10, p11];
    for (const p of tri) {
      const o = cursor * 3;
      positions[o] = p[0];
      positions[o + 1] = p[1];
      positions[o + 2] = p[2];
      normals[o] = n[0];
      normals[o + 1] = n[1];
      normals[o + 2] = n[2];
      colors[o] = color[0];
      colors[o + 1] = color[1];
      colors[o + 2] = color[2];
      cursor++;
    }
  }

  return cursor;
}
