/**
 * GitForest — Worker de Geração de Árvore
 *
 * Roda o pipeline inteiro fora da thread principal: L-System → tartaruga →
 * typed arrays de malha.
 *
 * Isso não é otimização prematura. Gerar uma árvore leva dezenas de
 * milissegundos, e uma floresta de duzentas travaria a aba por vários
 * segundos — justamente durante a animação em que as árvores deveriam estar
 * brotando. Com o worker, a cena continua a 60fps enquanto a floresta chega.
 *
 * O módulo importado aqui não pode tocar em Three.js nem no DOM. Ver a nota
 * em `engine/meshBuilder.ts`.
 */

import type { TreeParams } from '../engine/types';
import type { SpeciesChoice } from '../engine/species';
import { generateTree } from '../engine';
import { resolveSpecies } from '../engine/species';
import { buildTreeMesh } from '../engine/meshBuilder';

export interface TreeJobRequest {
  id: string;
  login: string;
  params: TreeParams;
  speciesChoice: SpeciesChoice;
  /** Nível de detalhe: 1 = anel interno, 2 = anel externo. */
  lod: 1 | 2;
}

export interface TreeJobResponse {
  id: string;
  login: string;
  branchPositions: Float32Array;
  branchNormals: Float32Array;
  branchColors: Float32Array;
  leafMatrices: Float32Array;
  leafColors: Float32Array;
  leafCount: number;
  height: number;
  radius: number;
  speciesId: string;
}

/**
 * Orçamentos por nível de detalhe.
 *
 * O corte acontece na *geração*, reduzindo a profundidade da gramática, e não
 * só no desenho: é o único jeito de o custo cair de verdade, já que uma
 * profundidade a menos elimina um nível inteiro de ramificação exponencial.
 *
 * ⚠️ `leafBudget`, porém, é um corte **absoluto**, não uma fração.
 *
 * Uma espécie que gera dez mil folhas com orçamento de 320 fica com 3% delas
 * e nasce pelada — foi exatamente o que aconteceu quando o bonsai entrou com
 * densidade alta. O orçamento existe para segurar o pior caso, então precisa
 * ficar acima do que uma espécie bem calibrada produz, e não abaixo. As
 * espécies é que devem gerar pouca folha; o orçamento é a rede de segurança.
 *
 * O corte é uniforme pela copa porque as folhas saem embaralhadas da
 * `turtle` (ver `shuffleLeaves`) — sem isso, truncar o array apagaria galhos
 * inteiros em vez de desbastar.
 */
const LOD_BUDGET = {
  // Nenhum dos dois níveis corta profundidade.
  //
  // Cortar um nível parecia a economia óbvia, e é a mais destrutiva que
  // existe aqui: as árvores de fundo já vêm da query enxuta, com uma dúzia de
  // repositórios em vez de trinta, ou seja, com um terço dos galhos
  // principais. Tirar ainda um nível de ramificação em cima disso deixava
  // pouco mais que o tronco e algumas varas — um bosque de árvores mortas.
  //
  // A economia fica em `segmentScale` e `radialSegments`, que são lineares e
  // mexem na resolução, não na silhueta.
  1: { depthPenalty: 0, segmentScale: 0.7, radialSegments: 4, leafBudget: 3600 },
  2: { depthPenalty: 0, segmentScale: 0.45, radialSegments: 3, leafBudget: 1400 },
} as const;

/**
 * O `tsconfig` da aplicação usa a lib do DOM, então `self` é tipado como
 * `Window` e não conhece a assinatura de `postMessage` com transferência.
 * Declarar o escopo mínimo aqui é mais barato que manter um tsconfig
 * separado só para este arquivo.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<TreeJobRequest>) => void) | null;
  postMessage(message: TreeJobResponse, transfer: Transferable[]): void;
}

const ctx = self as unknown as WorkerScope;

ctx.onmessage = (event: MessageEvent<TreeJobRequest>) => {
  const { id, login, params, speciesChoice, lod } = event.data;
  const budget = LOD_BUDGET[lod];

  const base = resolveSpecies(speciesChoice, params.seed);
  const species = {
    ...base,
    maxDepth: Math.max(1, base.maxDepth - budget.depthPenalty),
    branchSegments: Math.max(
      2,
      Math.round(base.branchSegments * budget.segmentScale),
    ),
  };

  const geometry = generateTree(params, speciesChoice, species);
  const mesh = buildTreeMesh(geometry, species, {
    radialSegments: budget.radialSegments,
    leafBudget: budget.leafBudget,
  });

  const response: TreeJobResponse = {
    id,
    login,
    branchPositions: mesh.branchPositions,
    branchNormals: mesh.branchNormals,
    branchColors: mesh.branchColors,
    leafMatrices: mesh.leafMatrices,
    leafColors: mesh.leafColors,
    leafCount: mesh.leafCount,
    height: mesh.height,
    radius: mesh.radius,
    speciesId: species.id,
  };

  // Transferir, não copiar: os buffers de uma árvore passam de megabytes
  ctx.postMessage(response, [
    mesh.branchPositions.buffer as ArrayBuffer,
    mesh.branchNormals.buffer as ArrayBuffer,
    mesh.branchColors.buffer as ArrayBuffer,
    mesh.leafMatrices.buffer as ArrayBuffer,
    mesh.leafColors.buffer as ArrayBuffer,
  ]);
};
