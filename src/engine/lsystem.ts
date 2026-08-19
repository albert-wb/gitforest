/**
 * GitForest — Motor L-System Paramétrico Estocástico
 *
 * Implementação de L-System com:
 * - Símbolos paramétricos (cada símbolo carrega dados numéricos)
 * - Componente estocástico (via PRNG seedado)
 * - Regras de produção condicionais
 */

import type { LSymbol, LSystemGrammar, ProductionRule } from './types';

/**
 * Executa o L-System: aplica regras de produção iterativamente
 * sobre o axioma, gerando a string final de símbolos.
 */
export function runLSystem(
  grammar: LSystemGrammar,
  rng: () => number,
): LSymbol[] {
  let current = [...grammar.axiom];

  for (let iter = 0; iter < grammar.iterations; iter++) {
    const next: LSymbol[] = [];

    for (const symbol of current) {
      const rule = findMatchingRule(symbol, grammar.rules);
      if (rule) {
        const produced = rule.produce(symbol.params, rng);
        next.push(...produced);
      } else {
        // Sem regra → mantém o símbolo original
        next.push(symbol);
      }
    }

    current = next;
  }

  return current;
}

/**
 * Encontra a primeira regra que casa com o símbolo dado.
 */
function findMatchingRule(
  symbol: LSymbol,
  rules: ProductionRule[],
): ProductionRule | null {
  for (const rule of rules) {
    if (rule.predecessor === symbol.char) {
      if (!rule.condition || rule.condition(symbol.params)) {
        return rule;
      }
    }
  }
  return null;
}

/**
 * Helper para criar um símbolo paramétrico.
 */
export function sym(char: string, ...params: number[]): LSymbol {
  return { char, params };
}
