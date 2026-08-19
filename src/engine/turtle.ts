/**
 * GitForest — Turtle 3D
 *
 * Interpreta a sequência de símbolos do L-System e gera
 * a geometria 3D da árvore (segmentos + posições de folhas).
 *
 * Funciona como uma "tartaruga" que se move no espaço 3D,
 * empilhando/desempilhando estados para criar ramificações.
 */

import type { LSymbol, TreeGeometry, TreeSegment, LeafData, TreeParams } from './types';
import { createRNG, degToRad, lerp } from '../utils/math';
import { getLanguageColor } from '../utils/colors';

interface TurtleState {
  position: [number, number, number];
  // Eixos locais da tartaruga (heading, left, up)
  heading: [number, number, number]; // Direção para frente
  left: [number, number, number]; // Direção à esquerda
  up: [number, number, number]; // Direção para cima
}

/**
 * Interpreta os símbolos do L-System e gera a geometria da árvore.
 */
export function interpretSymbols(
  symbols: LSymbol[],
  params: TreeParams,
): TreeGeometry {
  const segments: TreeSegment[] = [];
  const leaves: LeafData[] = [];
  const roots: TreeSegment[] = [];

  // Estado inicial: posição na origem, apontando para cima
  let state: TurtleState = {
    position: [0, 0, 0],
    heading: [0, 1, 0], // Y-up
    left: [-1, 0, 0],
    up: [0, 0, 1],
  };

  const stateStack: TurtleState[] = [];

  for (const symbol of symbols) {
    switch (symbol.char) {
      // Segmento desenhado. O raio final é explícito (não mais `raio * 0.8`
      // inventado aqui), de modo que a ponta de um trecho case exatamente
      // com a base do próximo e a emenda deixe de ter degrau.
      //
      // `B` cai no mesmo tratamento: ele só chega até aqui se as iterações
      // acabarem antes da expansão total, e desenhá-lo evita que o galho
      // simplesmente desapareça.
      case 'F':
      case 'T':
      case 'B': {
        const [length, startRadius, endRadius, branchIdx, depth] = symbol.params;
        const branch = branchIdx >= 0 ? params.branches[branchIdx] : null;

        const start: [number, number, number] = [...state.position];
        const end: [number, number, number] = [
          state.position[0] + state.heading[0] * length,
          state.position[1] + state.heading[1] * length,
          state.position[2] + state.heading[2] * length,
        ];

        segments.push({
          start,
          end,
          startRadius,
          endRadius,
          branchIndex: branchIdx,
          depth,
          isDead: branch?.isDead ?? false,
        });

        state.position = end;
        break;
      }

      // Move sem desenhar. É o que permite espalhar folhas em cacho ao redor
      // da ponta do galho sem gerar geometria de suporte invisível.
      //
      // O segundo parâmetro achata o deslocamento contra o plano do chão. O
      // achatamento é aplicado em **espaço de mundo**, e não no referencial
      // local da tartaruga, de propósito: uma almofada de bonsai é horizontal
      // em relação ao chão, não em relação ao galho que a sustenta. Achatar
      // no referencial local faria cada placa inclinar junto com o seu ramo e
      // o efeito de andares se perderia.
      //
      // Só a posição é afetada — a normal da folha continua vindo variada da
      // gramática. Deitar todas as folhas no mesmo plano transformaria a
      // almofada numa chapa sólida, e é a variação de ângulo que faz a massa
      // capturar luz e ler como folhagem.
      case 'f': {
        const length = symbol.params[0] ?? 0;
        const flatten = symbol.params[1] ?? 0;
        // O que se tira na vertical volta na horizontal: sem isso, achatar
        // também encolheria o cacho e a almofada nasceria pequena.
        const spread = 1 + flatten * 0.9;
        state.position = [
          state.position[0] + state.heading[0] * length * spread,
          state.position[1] + state.heading[1] * length * (1 - flatten),
          state.position[2] + state.heading[2] * length * spread,
        ];
        break;
      }

      case '+': // Rotação em Y (yaw) positiva
      {
        const angle = degToRad(symbol.params[0] ?? 30);
        rotateAroundAxis(state, state.up, angle);
        break;
      }

      case '-': // Rotação em Y (yaw) negativa
      {
        const angle = degToRad(symbol.params[0] ?? 30);
        rotateAroundAxis(state, state.up, -angle);
        break;
      }

      case '^': // Pitch up
      {
        const angle = degToRad(symbol.params[0] ?? 30);
        rotateAroundAxis(state, state.left, angle);
        break;
      }

      case 'v': // Pitch down
      {
        const angle = degToRad(symbol.params[0] ?? 30);
        rotateAroundAxis(state, state.left, -angle);
        break;
      }

      case '<': // Roll positivo
      {
        const angle = degToRad(symbol.params[0] ?? 30);
        rotateAroundAxis(state, state.heading, angle);
        break;
      }

      case '>': // Roll negativo
      {
        const angle = degToRad(symbol.params[0] ?? 30);
        rotateAroundAxis(state, state.heading, -angle);
        break;
      }

      case '[': // Push state
        stateStack.push(cloneState(state));
        break;

      case ']': // Pop state
      {
        const popped = stateStack.pop();
        if (popped) state = popped;
        break;
      }

      case 'L': // Folha
      {
        const [scale, branchIdx] = symbol.params;
        const branch = branchIdx >= 0 ? params.branches[branchIdx] : null;
        const color = branch
          ? (branch.leafColor || getLanguageColor(branch.languageName))
          : getLanguageColor(null);

        leaves.push({
          position: [...state.position],
          normal: [...state.heading],
          color,
          scale: scale ?? 0.5,
          branchIndex: branchIdx,
        });
        break;
      }
    }
  }

  // Gerar raízes procedurais
  generateRoots(roots, params);

  shuffleLeaves(leaves, params.seed);

  return { segments, leaves, roots };
}

/**
 * Embaralha a ordem das folhas (Fisher-Yates seedado).
 *
 * As folhas nascem agrupadas por galho, e a renderização revela um prefixo do
 * array — tanto na animação de crescimento quanto na densidade sazonal. Sem
 * embaralhar, cortar o array significa apagar galhos inteiros: a árvore
 * cresceria repositório a repositório e o inverno desfolharia só um lado.
 * Com a ordem embaralhada, qualquer corte é um desbaste uniforme pela copa.
 */
function shuffleLeaves(leaves: LeafData[], seed: number): void {
  const rng = createRNG(seed ^ 0x5f37_1a3d);
  for (let i = leaves.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = leaves[i];
    leaves[i] = leaves[j];
    leaves[j] = tmp;
  }
}

/**
 * Gera raízes procedurais baseadas na idade da conta.
 *
 * Antes as raízes saíam de y = 0 direto para baixo — e como o chão é opaco,
 * a feature inteira (engine, turtle e o componente `Roots`) renderizava
 * enterrada e nunca era vista. Agora elas nascem no colo do tronco, *acima*
 * do solo, arqueiam para fora e só então mergulham: são sapopemas, a forma
 * que raiz de árvore grande realmente tem. A parte submersa continua ali
 * porque será a ancoragem da rede micorrízica na Fase 3.
 */
function generateRoots(roots: TreeSegment[], params: TreeParams) {
  const rootCount = Math.round(3 + params.rootDepth * 4); // 3 a 7 raízes
  // Seed derivada da mesma do usuário: as raízes variam, mas de forma estável
  const rng = createRNG(params.seed ^ 0x9e37_79b9);

  /**
   * Altura em que a raiz se destaca do tronco.
   *
   * Baixa de propósito. Com o colo alto as raízes viravam pernas de aranha
   * erguendo a árvore do chão — o efeito ficou evidente no bonsai, cujo
   * tronco é curto e cujas raízes de superfície (o *nebari*) devem se espalhar
   * rentes ao solo, não arquear no ar.
   */
  const collarHeight = lerp(0.12, 0.3, params.rootDepth);
  /**
   * Alcance horizontal a partir do centro.
   *
   * Modesto: raízes longas e escuras irradiando pelo gramado liso leem como
   * pernas de aranha, e numa floresta inteira o efeito se multiplica. O que
   * se quer é o alargamento do pé do tronco, não um aracnídeo.
   */
  const reach = lerp(0.6, 1.4, params.rootDepth);
  const baseRadius = 0.07 + params.trunkWidth * 0.11;

  for (let i = 0; i < rootCount; i++) {
    // Distribuição radial regular com um desvio para não ficar mecânica
    const angle =
      ((Math.PI * 2) / rootCount) * i + lerp(-0.35, 0.35, rng());
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);

    const spread = reach * lerp(0.75, 1.25, rng());
    const collar = collarHeight * lerp(0.8, 1.2, rng());

    // Arco de quatro pontos: colo → descida → contato com o solo → mergulho
    const points: [number, number, number][] = [
      [dirX * baseRadius * 0.9, collar, dirZ * baseRadius * 0.9],
      [dirX * spread * 0.45, collar * 0.45, dirZ * spread * 0.45],
      [dirX * spread * 0.85, 0.04, dirZ * spread * 0.85],
      [dirX * spread * 1.2, -0.45 - params.rootDepth * 0.6, dirZ * spread * 1.2],
    ];

    const radii = [
      baseRadius,
      baseRadius * 0.72,
      baseRadius * 0.45,
      baseRadius * 0.16,
    ];

    for (let s = 0; s < points.length - 1; s++) {
      roots.push({
        start: points[s],
        end: points[s + 1],
        startRadius: radii[s],
        endRadius: radii[s + 1],
        branchIndex: -1,
        depth: 0,
        isDead: false,
      });
    }
  }
}

/**
 * Rotaciona os eixos da tartaruga ao redor de um eixo arbitrário.
 */
function rotateAroundAxis(
  state: TurtleState,
  axis: [number, number, number],
  angle: number,
) {
  state.heading = rotateVector(state.heading, axis, angle);
  state.left = rotateVector(state.left, axis, angle);
  state.up = rotateVector(state.up, axis, angle);
}

/**
 * Rotaciona um vetor ao redor de um eixo usando a fórmula de Rodrigues.
 */
function rotateVector(
  v: [number, number, number],
  axis: [number, number, number],
  angle: number,
): [number, number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [ax, ay, az] = axis;

  // Normalizar eixo
  const mag = Math.sqrt(ax * ax + ay * ay + az * az);
  if (mag < 0.0001) return v;
  const nx = ax / mag;
  const ny = ay / mag;
  const nz = az / mag;

  // Rodrigues' rotation formula
  const dot = v[0] * nx + v[1] * ny + v[2] * nz;
  const crossX = ny * v[2] - nz * v[1];
  const crossY = nz * v[0] - nx * v[2];
  const crossZ = nx * v[1] - ny * v[0];

  return [
    v[0] * cos + crossX * sin + nx * dot * (1 - cos),
    v[1] * cos + crossY * sin + ny * dot * (1 - cos),
    v[2] * cos + crossZ * sin + nz * dot * (1 - cos),
  ];
}

/**
 * Clona o estado da tartaruga (deep copy).
 */
function cloneState(state: TurtleState): TurtleState {
  return {
    position: [...state.position],
    heading: [...state.heading],
    left: [...state.left],
    up: [...state.up],
  };
}
