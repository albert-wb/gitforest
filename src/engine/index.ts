/**
 * GitForest — Pipeline completo de geração da árvore
 *
 * Orquestra: TreeParams + Espécie → L-System → Turtle 3D → TreeGeometry
 */

import type { TreeParams, TreeGeometry } from './types';
import type { SpeciesChoice, SpeciesProfile } from './species';
import { runLSystem } from './lsystem';
import { buildTreeGrammar } from './grammar';
import { interpretSymbols } from './turtle';
import { resolveSpecies } from './species';
import { createRNG } from '../utils/math';

/**
 * Gera a geometria completa da árvore a partir dos parâmetros normalizados.
 *
 * Pipeline:
 * 1. Resolve a espécie (a escolha do usuário, ou uma derivada da seed)
 * 2. Constrói a gramática L-System a partir dos TreeParams + espécie
 * 3. Executa o L-System (aplica regras de produção)
 * 4. Interpreta os símbolos com o Turtle 3D
 *
 * Continua determinístico: mesma seed + mesma espécie = mesma árvore.
 */
export function generateTree(
  params: TreeParams,
  speciesChoice: SpeciesChoice = 'auto',
  /**
   * Perfil já resolvido, para quando o chamador precisa modificá-lo antes de
   * gerar — é assim que o worker aplica o corte de nível de detalhe, baixando
   * `maxDepth` e `branchSegments` sem tocar no catálogo de espécies.
   */
  speciesOverride?: SpeciesProfile,
): TreeGeometry {
  const species = speciesOverride ?? resolveSpecies(speciesChoice, params.seed);

  // PRNG seedado pelo login — mesma seed = mesma árvore
  const rng = createRNG(params.seed);

  const grammar = buildTreeGrammar(params, species);
  const symbols = runLSystem(grammar, rng);

  return interpretSymbols(symbols, params);
}

export type { TreeParams, TreeGeometry };
