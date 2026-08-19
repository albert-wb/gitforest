/**
 * GitForest — Distribuição das Árvores no Terreno
 *
 * Posiciona a floresta em anéis ao redor da árvore raiz, com a distância
 * radial representando a **força do laço**: quanto mais forte a conexão, mais
 * perto da sua árvore o amigo cresce.
 *
 * A colocação usa espiral de ângulo áureo em vez de um anel regular. Um anel
 * regular com N árvores lê como cerca; o ângulo áureo distribui sem nunca
 * repetir alinhamento, que é a mesma razão pela qual a botânica o usa para
 * dispor folhas ao redor de um caule.
 */

import { getTerrain } from './terrain';
import { createRNG, hashString, lerp } from '../utils/math';

export interface TreePlacement {
  login: string;
  degree: 1 | 2;
  position: [number, number, number];
  /** Escala relativa: árvores de segundo grau são menores, para dar profundidade. */
  scale: number;
}

const GOLDEN_ANGLE = 137.508 * (Math.PI / 180);

/** Raio livre ao redor da árvore raiz, para não invadir a clareira principal. */
const INNER_KEEPOUT = 7.5;

/*
 * Anéis apertados de propósito.
 *
 * A primeira calibragem espalhava as árvores entre 13 e 62 unidades, e o
 * resultado lia como pomar: exemplares isolados, cada um com o seu vazio em
 * volta, o olho contando um por um. Floresta é o contrário disso — as copas
 * se tocam, o fundo vira massa e só as primeiras árvores se distinguem.
 * Aproximar também traz o segundo grau para dentro do enquadramento inicial,
 * onde antes ele só aparecia se a pessoa afastasse a câmera.
 */
const FIRST_RING: [number, number] = [9, 20];
const SECOND_RING: [number, number] = [22, 41];

/** Acima deste declive a árvore ficaria pendurada na encosta. */
const MAX_SLOPE = 0.34;

/**
 * Distância mínima entre duas árvores.
 *
 * É o piso que impede duas árvores de ocuparem o mesmo tronco. Encostar as
 * copas é desejável; encostar os troncos não, porque aí a floresta perde a
 * legibilidade e os alvos de clique de `ForestPicking` passam a se sobrepor.
 */
const MIN_SPACING = 3.4;

/**
 * Distribui os logins pelo terreno.
 *
 * `firstDegree` deve vir ordenado por força do laço (o mais próximo primeiro),
 * e `sharedCount` dá a mesma noção para o segundo grau.
 */
export function layoutForest(
  root: string,
  firstDegree: string[],
  secondDegree: string[],
  sharedCount: Map<string, number>,
): TreePlacement[] {
  const terrain = getTerrain();
  const rng = createRNG(hashString(root) ^ 0x2f19_c7b1);
  const placements: TreePlacement[] = [];
  const taken: [number, number][] = [[0, 0]];

  const maxShared = Math.max(1, ...sharedCount.values());

  const place = (
    login: string,
    degree: 1 | 2,
    strength: number,
    index: number,
    ring: [number, number],
  ): void => {
    // Laço forte = perto. `strength` chega normalizado em 0..1.
    const targetRadius = lerp(ring[1], ring[0], strength);

    // Até algumas tentativas: gira pelo ângulo áureo e afasta um pouco a
    // cada colisão, em vez de simplesmente descartar a árvore.
    for (let attempt = 0; attempt < 14; attempt++) {
      const angle = index * GOLDEN_ANGLE + attempt * 0.41 + rng() * 0.25;
      const radius = targetRadius + attempt * 1.3 + lerp(-1.4, 1.4, rng());

      if (radius < INNER_KEEPOUT) continue;

      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      if (terrain.slopeAt(x, z) > MAX_SLOPE) continue;

      const tooClose = taken.some(
        ([tx, tz]) => Math.hypot(tx - x, tz - z) < MIN_SPACING,
      );
      if (tooClose) continue;

      taken.push([x, z]);
      placements.push({
        login,
        degree,
        position: [x, terrain.heightAt(x, z), z],
        // Escalas abaixo de 1 por decisão de composição, não por performance:
        // a árvore em foco é a protagonista da cena, e árvores de fundo no
        // mesmo tamanho competiam com ela e a faziam sumir no meio da mata.
        scale:
          degree === 1
            ? lerp(0.58, 0.76, rng())
            : lerp(0.42, 0.6, rng()),
      });
      return;
    }
    // Sem lugar bom: a árvore simplesmente não entra. Melhor uma floresta
    // com um claro do que uma árvore afundada numa encosta.
  };

  firstDegree.forEach((login, i) => {
    // A ordem já reflete a força do laço; o primeiro da lista fica mais perto
    const strength = 1 - i / Math.max(1, firstDegree.length - 1);
    place(login, 1, strength, i, FIRST_RING);
  });

  secondDegree.forEach((login, i) => {
    const strength = (sharedCount.get(login) ?? 1) / maxShared;
    place(login, 2, strength, i + firstDegree.length, SECOND_RING);
  });

  return placements;
}
