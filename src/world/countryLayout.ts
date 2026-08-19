/**
 * GitForest — Distribuição da Floresta de um País
 *
 * Diferente de `forestLayout`, que arruma dezenas de amigos em dois anéis ao
 * redor de você, aqui são **centenas** de contas sem relação entre si — a
 * lista do Brasil sozinha tem mais de novecentas.
 *
 * Duas consequências disso moldam este arquivo:
 *
 * 1. **A posição é calculada para todo mundo, de uma vez.** É matemática pura
 *    e custa fração de milissegundo por conta; o que não dá para fazer de uma
 *    vez é *baixar e gerar* as árvores. Ter o mapa completo desde o início é
 *    o que permite ao carregamento sob demanda perguntar "quem está perto
 *    daqui?" sem nenhuma ida à rede.
 * 2. **A densidade tem de ser uniforme.** Num anel, dobrar o raio dobra o
 *    perímetro; distribuir as contas linearmente deixaria o centro apinhado e
 *    a borda vazia. Daí o raio crescer com a **raiz** do índice, que é a
 *    forma de espalhar pontos uniformemente por uma área — a mesma razão pela
 *    qual sementes numa flor seguem esse arranjo.
 */

import { getTerrain } from './terrain';
import { createRNG, hashString, lerp } from '../utils/math';
import type { RankedUser } from '../api/topUsers';

export interface CountryPlacement {
  login: string;
  rank: number;
  position: [number, number, number];
  scale: number;
  /** Distância ao centro, pré-calculada para o carregamento sob demanda. */
  radius: number;
}

const GOLDEN_ANGLE = 137.508 * (Math.PI / 180);

/** Raio livre no centro, onde fica a árvore em foco. */
const INNER = 9;

/**
 * Espaçamento entre árvores consecutivas na espiral.
 *
 * Com raiz quadrada, este número é o lado aproximado da célula que cada
 * árvore ocupa. Novecentas contas a 4,4 unidades ocupam um círculo de ~140
 * de raio — dentro do terreno (que vai a 320) e dentro do alcance da neblina,
 * de modo que a floresta some no horizonte em vez de terminar num corte.
 */
const SPACING = 4.4;

/** Acima deste declive a árvore ficaria pendurada na encosta. */
const MAX_SLOPE = 0.4;

/**
 * Monta o mapa completo de posições de um país.
 *
 * A ordem do array é a ordem do ranking, e o raio cresce junto: quem
 * contribuiu mais fica no coração da floresta. Não é só estética — é o que
 * garante que as primeiras árvores a carregar, na abertura, sejam as mais
 * reconhecíveis.
 */
export function layoutCountry(
  slug: string,
  users: RankedUser[],
): CountryPlacement[] {
  const terrain = getTerrain();
  const rng = createRNG(hashString(slug) ^ 0x7a3f_11c5);
  const placements: CountryPlacement[] = [];

  users.forEach((user, i) => {
    // Raio pela raiz do índice: densidade constante por área
    const base = INNER + SPACING * Math.sqrt(i);

    // Até algumas tentativas para escapar de uma encosta íngreme. Ao
    // contrário de `forestLayout`, aqui não há teste de colisão entre
    // árvores: com centenas de posições, comparar cada uma com todas as
    // anteriores seria quadrático, e a espiral de ângulo áureo já garante
    // separação por construção.
    for (let attempt = 0; attempt < 6; attempt++) {
      const angle = i * GOLDEN_ANGLE + attempt * 0.7;
      const radius = base + attempt * 1.8 + lerp(-1.1, 1.1, rng());

      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      if (attempt < 5 && terrain.slopeAt(x, z) > MAX_SLOPE) continue;

      // Ranking também define o porte: os primeiros da lista são as árvores
      // grandes que dão escala ao resto.
      const rankT = Math.min(i / Math.max(users.length - 1, 1), 1);

      placements.push({
        login: user.login,
        rank: user.rank,
        position: [x, terrain.heightAt(x, z), z],
        scale: lerp(0.9, 0.5, rankT) * lerp(0.9, 1.1, rng()),
        radius,
      });
      return;
    }
  });

  return placements;
}
