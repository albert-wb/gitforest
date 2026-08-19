/**
 * GitForest — Gramática de Produção da Árvore
 *
 * Transforma os parâmetros do GitHub, somados a um perfil de espécie, em
 * instruções de crescimento do L-System.
 *
 * Símbolos:
 *   F(len, r0, r1, branchIdx, depth) — Segmento desenhado, com afilamento
 *   f(len)                           — Move sem desenhar (posiciona folhas)
 *   B(len, r0, r1, branchIdx, depth) — Galho a expandir
 *   L(scale, branchIdx)              — Folha
 *   + / -  — Yaw (esquerda/direita)
 *   ^ / v  — Pitch (cima/baixo)
 *   < / >  — Roll (giro em torno do próprio eixo)
 *   [ / ]  — Empilha / desempilha estado
 *
 * ## O que mudou na v1.2.0, e por quê
 *
 * A versão anterior produzia uma árvore rígida e sem graça, por quatro
 * motivos concretos que este arquivo agora corrige:
 *
 * 1. **Tronco reto.** Emitia um único `F` por seção, sem nenhuma rotação
 *    entre eles — um poste. Agora cada seção é subdividida e recebe uma
 *    fração da inclinação da espécie, mais um giro lento, de modo que o
 *    tronco sobe torcendo levemente.
 * 2. **Galhos como varetas.** Também eram segmentos retos. Agora cada galho
 *    é uma sequência de segmentos com `branchCurve` graus acumulando entre
 *    eles — é isso que faz o salgueiro descer em arco e o carvalho levantar.
 * 3. **Raio com degraus.** `F` carregava um raio só e a tartaruga inventava
 *    a ponta como `raio * 0.8`, então cada emenda tinha um degrau visível.
 *    Agora `F` carrega raio inicial e final, e cada trecho começa exatamente
 *    onde o anterior terminou.
 * 4. **Folhas alinhadas.** Todas nasciam no mesmo ponto e apontavam na
 *    direção do galho, virando um feixe de lâminas. Agora são espalhadas em
 *    cacho com `f` (move sem desenhar) depois de rotações aleatórias, o que
 *    dá volume e orientação variada de graça.
 */

import type { BranchParams, LSystemGrammar, TreeParams } from './types';
import type { SpeciesProfile } from './species';
import { sym } from './lsystem';
import { lerp } from '../utils/math';

/** Teto de segurança: ramificação é exponencial na profundidade. */
const MAX_TRUNK_NODES = 30;

/**
 * Giro aleatório, em graus, aplicado entre segmentos de galho.
 * Mantido moderado: o suficiente para o arco torcer em três dimensões, sem
 * tanto a ponto de desmanchar a direção geral da curvatura.
 */
const BRANCH_ROLL_JITTER = 20;

/**
 * Constrói a gramática L-System a partir dos parâmetros normalizados e da
 * espécie escolhida.
 */
export function buildTreeGrammar(
  params: TreeParams,
  species: SpeciesProfile,
): LSystemGrammar {
  const trunkH = lerp(species.trunkHeight[0], species.trunkHeight[1], params.trunkHeight);
  const trunkR = lerp(species.trunkRadius[0], species.trunkRadius[1], params.trunkWidth);

  return {
    axiom: [sym('T', trunkH, trunkR, -1, 0)],
    rules: [
      {
        predecessor: 'T',
        produce: (_p, rng) => buildTrunk(params, species, trunkH, trunkR, rng),
      },
      {
        predecessor: 'B',
        condition: (p) => p[4] < species.maxDepth,
        produce: (p, rng) => {
          const [len, r0, r1, branchIdx, depth] = p;
          return buildBranch(
            species,
            len,
            r0,
            r1,
            branchIdx,
            depth,
            params.branches[branchIdx] ?? null,
            rng,
          );
        },
      },
      {
        predecessor: 'B',
        condition: (p) => p[4] >= species.maxDepth,
        produce: (p, rng) => {
          const [len, r0, r1, branchIdx, depth] = p;
          return buildTip(
            species,
            len,
            r0,
            r1,
            branchIdx,
            depth,
            params.branches[branchIdx],
            rng,
          );
        },
      },
    ],
    // Uma iteração por nível de profundidade, mais uma para os terminais.
    iterations: species.maxDepth + 2,
  };
}

// ============================================================
// Tronco
// ============================================================

/**
 * Onde cada galho sai ao redor do tronco.
 *
 * A filotaxia é o que mais diferencia as espécies à primeira vista: um
 * pinheiro com galhos em espiral deixa de parecer um pinheiro.
 */
function phyllotaxisRoll(
  species: SpeciesProfile,
  node: number,
  slot: number,
  perNode: number,
): number {
  switch (species.phyllotaxis) {
    case 'verticilada':
      // Verticilos: vários galhos na mesma altura, cada anel girado em
      // relação ao anterior para não empilhar sombra sobre sombra.
      return node * 47 + (360 / perNode) * slot;
    case 'oposta':
      // Decussada: pares opostos, cada par a 90° do anterior.
      return node * 90 + slot * 180;
    case 'espiral':
    default:
      // Ângulo áureo — o mesmo que a botânica encontrou para maximizar a
      // exposição à luz sem que uma folha cubra a de baixo.
      return (node * perNode + slot) * 137.508;
  }
}

function buildTrunk(
  params: TreeParams,
  species: SpeciesProfile,
  trunkH: number,
  trunkR: number,
  rng: () => number,
) {
  const symbols = [];
  const branches = params.branches;

  if (branches.length === 0) {
    // Conta sem repositórios: só o tronco, mas ainda assim curvado
    return straightTrunk(species, trunkH, trunkR, rng);
  }

  const perNode =
    species.phyllotaxis === 'verticilada'
      ? 3
      : species.phyllotaxis === 'oposta'
        ? 2
        : 1;

  const nodeCount = Math.min(
    Math.ceil(branches.length / perNode),
    MAX_TRUNK_NODES,
  );
  const nodeHeight = trunkH / (nodeCount + 0.6);
  const subH = nodeHeight / species.trunkSubdivisions;

  // Inclinação distribuída por todas as subdivisões do tronco
  const leanStep =
    species.trunkLean / (nodeCount * species.trunkSubdivisions);

  /** Raio do tronco a uma altura normalizada, contínuo do pé ao topo. */
  const radiusAt = (t: number) =>
    Math.max(trunkR * (0.1 + 0.9 * Math.pow(1 - t, species.trunkTaper)), 0.02);

  const totalSteps = nodeCount * species.trunkSubdivisions;
  // Fase inicial da onda: dois usuários com o mesmo número de repositórios
  // não devem tombar para o mesmo lado.
  const wavePhase = lerp(0, Math.PI * 2, rng());
  // Giro lento e constante ao longo de todo o tronco. Ele existe para que a
  // serpenteada aconteça em três dimensões em vez de num plano só; se for
  // rápido, volta a cancelar a inclinação (era o defeito antigo).
  const rollStep = 210 / totalSteps;

  for (let node = 0; node < nodeCount; node++) {
    for (let s = 0; s < species.trunkSubdivisions; s++) {
      const step = node * species.trunkSubdivisions + s;
      const t0 = step / totalSteps;
      const t1 = (step + 1) / totalSteps;

      // A onda troca de sinal, então o tronco tomba, volta e torna a tombar.
      // O fator 2.2 compensa o fato de que metade dos passos anda para trás:
      // sem ele, `trunkLean` entregaria muito menos curva que o valor pedido.
      const onda = Math.sin(t0 * Math.PI * 2 * species.trunkWaves + wavePhase);

      symbols.push(sym('<', rollStep));
      symbols.push(sym('^', leanStep * onda * 2.2 * lerp(0.75, 1.25, rng())));
      symbols.push(sym('F', subH, radiusAt(t0), radiusAt(t1), -1, 0));
    }

    const heightT = (node + 1) / nodeCount;
    const nodeRadius = radiusAt(heightT);

    for (let slot = 0; slot < perNode; slot++) {
      const index = node * perNode + slot;
      const branch = branches[index];
      if (!branch) break;

      symbols.push(
        ...emitBranch(species, branch, index, nodeRadius, heightT, node, slot, perNode, rng),
      );
    }
  }

  // Líder terminal: o tronco não deve acabar cortado num nó
  symbols.push(
    sym('F', nodeHeight * 0.7, radiusAt(1), Math.max(trunkR * 0.05, 0.015), -1, 0),
  );

  // Folhagem no ápice.
  //
  // Sem ela o tronco termina numa vara nua espetada acima da copa — o defeito
  // aparecia em todas as espécies, mas só ficou gritante no bonsai, cuja copa
  // encurta em direção ao topo e deixava a ponta exposta. Numa árvore real o
  // líder é folhado como qualquer ramo; num bonsai o ápice é uma almofada, e
  // é ela que fecha a silhueta triangular.
  // O último galho **vivo**, e não o último da lista: repositórios vêm
  // ordenados por estrelas, então o último costuma ser um projeto parado e
  // marcado como morto — e aí o ápice ficava sem folha justamente nas contas
  // com repositórios antigos, que é a maioria.
  let apexIndex = Math.min(nodeCount * perNode, branches.length) - 1;
  while (apexIndex >= 0 && branches[apexIndex].isDead) apexIndex--;

  if (apexIndex >= 0) {
    const count = Math.round(
      lerp(4, 11, branches[apexIndex].leafDensity) * species.leafDensity,
    );
    symbols.push(...emitLeafCluster(species, count, apexIndex, rng));
  }

  return symbols;
}

/** Tronco solitário, para perfis sem repositórios. */
function straightTrunk(
  species: SpeciesProfile,
  trunkH: number,
  trunkR: number,
  rng: () => number,
) {
  const symbols = [];
  const steps = species.trunkSubdivisions * 4;
  const stepH = trunkH / steps;

  const wavePhase = lerp(0, Math.PI * 2, rng());

  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const onda = Math.sin(t0 * Math.PI * 2 * species.trunkWaves + wavePhase);
    symbols.push(sym('<', 210 / steps));
    symbols.push(
      sym('^', (species.trunkLean / steps) * onda * 2.2 * lerp(0.75, 1.25, rng())),
    );
    symbols.push(
      sym(
        'F',
        stepH,
        trunkR * (0.1 + 0.9 * Math.pow(1 - t0, species.trunkTaper)),
        trunkR * (0.1 + 0.9 * Math.pow(1 - t1, species.trunkTaper)),
        -1,
        0,
      ),
    );
  }

  return symbols;
}

/** Posiciona e dispara um galho principal a partir de um nó do tronco. */
function emitBranch(
  species: SpeciesProfile,
  branch: BranchParams,
  index: number,
  nodeRadius: number,
  heightT: number,
  node: number,
  slot: number,
  perNode: number,
  rng: () => number,
) {
  // A silhueta da copa modula o comprimento pela altura — é o que separa um
  // cone de pinheiro de uma cúpula de carvalho usando os mesmos dados.
  const crown = Math.max(species.crown(heightT), 0.15);
  const length =
    lerp(species.branchLength[0], species.branchLength[1], branch.length) * crown;

  // O galho nunca pode ser mais grosso que o tronco no ponto onde nasce
  const radius = Math.min(
    lerp(species.branchRadius[0], species.branchRadius[1], branch.thickness),
    nodeRadius * 0.82,
  );

  const roll = phyllotaxisRoll(species, node, slot, perNode) + lerp(-9, 9, rng());
  const pitch = lerp(species.branchPitch[0], species.branchPitch[1], rng());
  const yaw = lerp(species.branchYaw[0], species.branchYaw[1], rng()) *
    (rng() > 0.5 ? 1 : -1);

  return [
    sym('['),
    sym('<', roll),
    sym('^', pitch),
    sym('+', yaw),
    sym('B', length, radius, radius * 0.62, index, 1),
    sym(']'),
  ];
}

// ============================================================
// Galhos
// ============================================================

/**
 * Expande um galho em segmentos curvos, com sub-galhos brotando ao longo do
 * caminho — e não todos amontoados na base, como acontecia antes.
 */
function buildBranch(
  species: SpeciesProfile,
  length: number,
  r0: number,
  r1: number,
  branchIndex: number,
  depth: number,
  branch: BranchParams | null,
  rng: () => number,
) {
  const symbols = [];
  const segments = species.branchSegments;
  const segLen = length / segments;
  // `branchCurve` é o arco total do galho; aqui vira a dose por segmento
  const curveStep = species.branchCurve / segments;

  const subCount = branch
    ? Math.round(
        lerp(species.subBranches[0], species.subBranches[1], branch.subBranches),
      )
    : species.subBranches[0];

  // Sub-galhos distribuídos na metade externa: o trecho junto ao tronco fica
  // limpo, como numa árvore de verdade.
  const firstSub = Math.max(1, Math.floor(segments * 0.45));
  const subEvery = Math.max(
    1,
    Math.floor((segments - firstSub) / Math.max(subCount, 1)),
  );

  let emitted = 0;

  // Folhagem distribuída ao longo do galho, não amontoada só na ponta.
  // Uma copa só existe se as folhas cobrirem o ramo; concentrá-las no
  // extremo produzia exatamente o galho seco com confete na ponta.
  const alongCount = branch
    ? Math.round(lerp(1, 3, branch.leafDensity) * species.leafDensity)
    : 0;

  for (let s = 0; s < segments; s++) {
    const t0 = s / segments;
    const t1 = (s + 1) / segments;
    const radiusAt = (t: number) => Math.max(lerp(r0, r1, t), 0.012);

    // O roll gira o referencial local, então o pitch seguinte curva num
    // plano diferente. Sem ele, todos os segmentos dobram no mesmo plano e
    // o galho vira um arco chapado — o salgueiro chegava a parecer uma
    // gaiola de arcos paralelos.
    symbols.push(sym('<', lerp(-BRANCH_ROLL_JITTER, BRANCH_ROLL_JITTER, rng())));
    // A curvatura acumula: cada segmento sai um pouco mais torto que o
    // anterior, o que produz um arco em vez de uma dobra única.
    symbols.push(sym('^', curveStep * lerp(0.6, 1.4, rng())));
    symbols.push(sym('+', lerp(-7, 7, rng())));
    symbols.push(sym('F', segLen, radiusAt(t0), radiusAt(t1), branchIndex, depth));

    // Onde a folhagem começa é característica da espécie: uma folhosa deixa
    // o trecho junto ao tronco limpo, uma conífera vem revestida quase toda.
    if (branch && !branch.isDead && t1 > species.foliageStart && alongCount > 0) {
      symbols.push(...emitLeafCluster(species, alongCount, branchIndex, rng));
    }

    const shouldBranch =
      emitted < subCount && s >= firstSub && (s - firstSub) % subEvery === 0;

    if (shouldBranch) {
      emitted++;
      const subLen = length * lerp(species.lengthDecay[0], species.lengthDecay[1], rng());
      const subR0 = radiusAt(t1) * lerp(species.radiusDecay[0], species.radiusDecay[1], rng());

      symbols.push(sym('['));
      symbols.push(sym('<', lerp(0, 360, rng())));
      symbols.push(
        sym(
          '^',
          lerp(species.branchPitch[0], species.branchPitch[1], rng()) * 0.55,
        ),
      );
      symbols.push(
        sym('+', lerp(species.branchYaw[0], species.branchYaw[1], rng()) *
          (emitted % 2 === 0 ? 1 : -1)),
      );
      symbols.push(sym('B', subLen, subR0, subR0 * 0.6, branchIndex, depth + 1));
      symbols.push(sym(']'));
    }
  }

  // Tufo mais cheio na extremidade do galho
  if (branch && !branch.isDead) {
    const count = Math.round(
      lerp(3, 7, branch.leafDensity) * species.leafDensity,
    );
    symbols.push(...emitLeafCluster(species, count, branchIndex, rng));
  }

  return symbols;
}

/** Ponta do galho: um segmento curto e o grosso da folhagem. */
function buildTip(
  species: SpeciesProfile,
  length: number,
  r0: number,
  r1: number,
  branchIndex: number,
  depth: number,
  branch: BranchParams | undefined,
  rng: () => number,
) {
  const symbols = [];
  const segments = Math.max(2, Math.round(species.branchSegments * 0.6));
  const segLen = (length * 0.75) / segments;
  // Ramos terminais fecham o arco bem mais que os galhos estruturais
  const curveStep = (species.branchCurve * species.tipDroop) / segments;
  const alive = Boolean(branch) && !branch?.isDead;

  const alongCount = branch
    ? Math.round(lerp(2, 5, branch.leafDensity) * species.leafDensity)
    : 0;

  for (let s = 0; s < segments; s++) {
    const t0 = s / segments;
    const t1 = (s + 1) / segments;
    symbols.push(sym('<', lerp(-BRANCH_ROLL_JITTER, BRANCH_ROLL_JITTER, rng())));
    symbols.push(sym('^', curveStep * lerp(0.8, 1.4, rng())));
    symbols.push(sym('+', lerp(-9, 9, rng())));
    symbols.push(
      sym(
        'F',
        segLen,
        Math.max(lerp(r0, r1, t0), 0.01),
        Math.max(lerp(r0, r1, t1), 0.01),
        branchIndex,
        depth,
      ),
    );

    // Ramo terminal é coberto de folha do começo ao fim
    if (alive && alongCount > 0) {
      symbols.push(...emitLeafCluster(species, alongCount, branchIndex, rng));
    }
  }

  if (branch && alive) {
    const count = Math.round(
      lerp(6, 16, branch.leafDensity) * species.leafDensity,
    );
    symbols.push(...emitLeafCluster(species, count, branchIndex, rng));
  }

  return symbols;
}

// ============================================================
// Folhagem
// ============================================================

/**
 * Espalha folhas num cacho ao redor da posição atual da tartaruga.
 *
 * O símbolo `f` (mover sem desenhar) é o que torna isso barato: rotaciona-se
 * em uma direção aleatória, anda-se um pouco e planta-se a folha ali. A folha
 * herda a direção corrente como normal, então cada uma aponta para um lado —
 * sem isso, todas ficavam paralelas e a copa virava um feixe de lâminas.
 */
function emitLeafCluster(
  species: SpeciesProfile,
  count: number,
  branchIndex: number,
  rng: () => number,
) {
  const symbols = [];
  const total = Math.max(0, Math.min(count, 22));

  for (let i = 0; i < total; i++) {
    symbols.push(sym('['));
    symbols.push(sym('<', lerp(0, 360, rng())));
    symbols.push(sym('^', lerp(-75, 75, rng())));
    // O segundo parâmetro achata o deslocamento no eixo vertical: com ele em
    // zero o cacho é uma bola (o comportamento de todas as espécies até
    // aqui); perto de um, vira a placa horizontal do bonsai.
    symbols.push(
      sym('f', lerp(0.04, species.clusterRadius, rng()), species.padFlatten),
    );
    // Giro próprio: duas folhas na mesma direção não ficam idênticas
    symbols.push(sym('<', lerp(0, 360, rng())));
    symbols.push(sym('^', lerp(-35, 35, rng())));
    symbols.push(
      sym('L', lerp(species.leafScale[0], species.leafScale[1], rng()), branchIndex),
    );
    symbols.push(sym(']'));
  }

  return symbols;
}
