/**
 * GitForest — Espécies de Árvore
 *
 * Princípio central: **a espécie muda a forma, os dados mudam a escala.**
 *
 * O perfil do GitHub continua controlando altura, espessura, comprimento de
 * galho, densidade de folhas e cor — a árvore segue sendo uma leitura honesta
 * da conta. A espécie escolhida controla a *gramática*: ângulos de saída,
 * filotaxia, curvatura, decaimento, silhueta da copa, formato da folha e
 * paleta de casca.
 *
 * Antes disso tudo estava cravado em `grammar.ts` (`lerp(25, 75, rng())` para
 * o yaw, profundidade máxima 3, um losango fixo como folha), o que dava a
 * todos os usuários exatamente a mesma árvore rígida.
 */

import { hashString } from '../utils/math';

export type SpeciesId =
  | 'carvalho'
  | 'pinheiro'
  | 'salgueiro'
  | 'cerejeira'
  | 'bonsai'
  | 'baoba';

/** Como os galhos se distribuem ao redor do tronco. */
export type Phyllotaxis = 'espiral' | 'oposta' | 'verticilada';

export type LeafShape =
  | 'losango'
  | 'oval'
  | 'agulha'
  | 'coracao'
  | 'bordo'
  | 'petala';

export interface SpeciesProfile {
  id: SpeciesId;
  nome: string;
  icone: string;
  descricao: string;

  // ---------- Tronco ----------
  /** Faixa de altura em unidades de mundo, interpolada por `trunkHeight`. */
  trunkHeight: [number, number];
  trunkRadius: [number, number];
  /** Inclinação total acumulada do pé ao topo, em graus. */
  trunkLean: number;
  /**
   * Quantas ondas a inclinação do tronco descreve da base ao topo.
   *
   * ⚠️ Sem este parâmetro, `trunkLean` era **inútil**: a inclinação era
   * distribuída em frações minúsculas por dezenas de subdivisões, e entre
   * cada uma delas havia um giro aleatório de ~27°. Como o giro muda o plano
   * em que a inclinação seguinte é aplicada, as curvinhas se cancelavam umas
   * às outras e o tronco subia reto — um poste com afilamento. O bonsai, cujo
   * tronco serpenteante é a característica que mais o define, saía tão reto
   * quanto o pinheiro.
   *
   * Com a inclinação seguindo uma onda, o tronco tomba para um lado, volta e
   * torna a tombar. Meia onda é uma curva só (carvalho); duas e meia é o
   * serpenteio de um bonsai formado.
   */
  trunkWaves: number;
  /** Subdivisões por nó. Mais subdivisões = curva mais suave, mais geometria. */
  trunkSubdivisions: number;
  /**
   * Expoente do afilamento. Maior = tronco que segura a grossura por mais
   * tempo e afina rápido no topo.
   */
  trunkTaper: number;

  // ---------- Galhos ----------
  phyllotaxis: Phyllotaxis;
  /** Ângulo de saída medido a partir da vertical. >90° já aponta para baixo. */
  branchPitch: [number, number];
  branchYaw: [number, number];
  maxDepth: number;
  lengthDecay: [number, number];
  radiusDecay: [number, number];
  /**
   * Curvatura **total** do galho, em graus, distribuída entre os segmentos.
   * Positivo derruba a ponta (salgueiro), negativo levanta (álamo).
   *
   * O valor é total, e não por segmento, porque a curvatura é aplicada no
   * referencial local da tartaruga e portanto acumula: 20° por segmento em
   * sete segmentos fecham 140° e enrolam o ramo numa argola. Expressar o
   * total torna o parâmetro legível e impede essa classe de erro.
   */
  branchCurve: number;
  /**
   * Multiplicador da curvatura aplicado só aos ramos terminais.
   *
   * É o que distingue um salgueiro de um arco genérico: num salgueiro real
   * quem chora são as varas finas da ponta, não os galhos estruturais. Sem
   * separar os dois, empurrar a curvatura o bastante para as pontas caírem
   * enrolava os galhos principais em argolas concêntricas.
   */
  tipDroop: number;
  branchSegments: number;
  branchLength: [number, number];
  branchRadius: [number, number];
  subBranches: [number, number];
  /**
   * Silhueta da copa: multiplicador do comprimento do galho em função da
   * altura normalizada no tronco (0 = base, 1 = topo). É o que diferencia um
   * cone de pinheiro de uma cúpula de carvalho.
   */
  crown: (t: number) => number;

  // ---------- Folhagem ----------
  leafShape: LeafShape;
  leafScale: [number, number];
  /** Multiplicador sobre a densidade que vem dos dados do repositório. */
  leafDensity: number;
  /** Raio do cacho de folhas ao redor do ponto terminal do galho. */
  clusterRadius: number;
  /**
   * Achatamento vertical do cacho de folhas (0 = esfera, 1 = disco).
   *
   * É o parâmetro que cria as **almofadas** do bonsai. Num bonsai formado, a
   * folhagem não envolve o galho: ela se acumula em placas horizontais
   * separadas por vazios, e é justamente esse recorte — massa, vazio, massa —
   * que o olho lê como "bonsai" antes de qualquer outra pista. Um cacho
   * esférico dava um arbusto pequeno, não um bonsai.
   *
   * Zero em todas as outras espécies, que mantêm o cacho esférico de antes.
   */
  padFlatten: number;
  /**
   * Fração do galho a partir da qual a folhagem começa (0-1).
   *
   * Uma folhosa deixa o trecho junto ao tronco limpo e concentra a copa na
   * ponta; uma conífera vem revestida quase da base. Sem este parâmetro, os
   * galhos longos do pinheiro ficavam varas nuas com dois tufos na ponta.
   */
  foliageStart: number;
  /** Cor-base da folhagem da espécie. */
  foliageBase: string;
  /**
   * Quanto a cor da linguagem é puxada para `foliageBase` (0-1).
   * Zero preservaria a cor do GitHub intacta — e faria uma árvore de C
   * (#555555) nascer com folhas cinza-chumbo, parecendo morta.
   */
  foliageTint: number;

  // ---------- Casca ----------
  barkDark: string;
  barkLight: string;
}

// ============================================================
// Silhuetas de copa
// ============================================================

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Cúpula larga, galhos mais longos na metade inferior da copa. */
const copaRedonda = (t: number) =>
  0.55 + 0.8 * Math.sin(Math.PI * clamp01(t * 0.82 + 0.14));

/** Cone: base larga afinando até a ponta. */
const copaConica = (t: number) => 1.25 - 1.0 * clamp01(t);

/** Galhos crescendo em direção ao topo, de onde despencam. */
const copaChorao = (t: number) => 0.6 + 0.7 * clamp01(t);

/** Vaso aberto: pouco embaixo, espalhando em cima. */
const copaVaso = (t: number) => 0.5 + 0.85 * clamp01(t);

/** Guarda-chuva: tronco nu e uma coroa concentrada bem no alto. */
const copaGuardaChuva = (t: number) => {
  const s = clamp01((t - 0.55) / 0.45);
  return 0.18 + 1.35 * (s * s * (3 - 2 * s));
};

/**
 * Bonsai: triângulo assimétrico com o galho mais longo embaixo.
 *
 * Na formação clássica o primeiro galho é o mais baixo **e** o mais comprido,
 * e cada andar acima dele encurta até o ápice. A ondulação sobreposta é o que
 * impede os andares de virarem degraus regulares de bolo de casamento — num
 * exemplar de verdade nenhum par de almofadas tem o mesmo tamanho.
 */
const copaBonsai = (t: number) => {
  const c = clamp01(t);
  // Nada de galho comprido no pé: o oitavo inferior do tronco fica limpo.
  // Sem isso, os galhos mais longos saíam rente ao chão e a árvore virava
  // uma aranha de pernas compridas — chegavam a atravessar o terreno.
  const sobe = clamp01((c - 0.12) / 0.18);
  /*
   * Platô, e não pico.
   *
   * A primeira versão concentrava o comprimento num andar só, lá pelos 34%
   * da altura, e decaía forte dali para cima. O resultado era uma árvore
   * pernalta: tronco nu embaixo, um punhado de almofadas no meio e uma vara
   * exposta acima. A copa de um bonsai formado ocupa a maior parte do tronco
   * — só o ápice é que fecha em ponta.
   */
  const desce = 1 - 0.3 * clamp01((c - 0.4) / 0.6);
  /*
   * O piso é 0.45, e não perto de zero.
   *
   * Com o piso muito baixo os primeiros nós do tronco viravam tocos: galhos
   * de meia unidade que ainda assim recebiam o seu cacho de folhas, e o cacho
   * ia parar no colo da árvore, rente ao chão. Ficava uma bolota de folhagem
   * abraçando a base, visível em todas as árvores da floresta.
   *
   * Zerar não era opção: cada nó do tronco é um repositório, e os primeiros
   * são os mais estrelados. Suprimir o galho suprimiria justamente o
   * repositório mais importante da conta.
   */
  return 0.45 + 0.8 * sobe * desce + 0.1 * Math.sin(c * 7.7 + 1.1);
};

// ============================================================
// Catálogo
// ============================================================

export const SPECIES: Record<SpeciesId, SpeciesProfile> = {
  carvalho: {
    id: 'carvalho',
    nome: 'Carvalho',
    icone: '🌳',
    descricao: 'Copa larga e tronco pesado. A escolha segura.',
    trunkHeight: [4.5, 9.5],
    trunkRadius: [0.24, 0.62],
    trunkLean: 8,
    trunkWaves: 0.6,
    trunkSubdivisions: 3,
    trunkTaper: 1.35,
    phyllotaxis: 'espiral',
    branchPitch: [52, 78],
    branchYaw: [12, 34],
    maxDepth: 3,
    lengthDecay: [0.56, 0.74],
    radiusDecay: [0.58, 0.7],
    branchCurve: -22,
    tipDroop: 1.3,
    branchSegments: 5,
    branchLength: [1.4, 4.6],
    branchRadius: [0.05, 0.2],
    subBranches: [2, 4],
    crown: copaRedonda,
    leafShape: 'oval',
    leafScale: [0.95, 1.95],
    leafDensity: 1.2,
    clusterRadius: 0.5,
    padFlatten: 0,
    foliageStart: 0.42,
    foliageBase: '#4e8f3a',
    foliageTint: 0.44,
    barkDark: '#2b1d12',
    barkLight: '#5c4029',
  },

  pinheiro: {
    id: 'pinheiro',
    nome: 'Pinheiro',
    icone: '🌲',
    descricao: 'Monopodial, galhos em verticilos e agulhas escuras.',
    trunkHeight: [5.5, 11],
    trunkRadius: [0.16, 0.42],
    trunkLean: 3,
    trunkWaves: 0.3,
    trunkSubdivisions: 2,
    trunkTaper: 1.05,
    phyllotaxis: 'verticilada',
    branchPitch: [72, 96],
    branchYaw: [6, 18],
    maxDepth: 2,
    lengthDecay: [0.42, 0.58],
    radiusDecay: [0.45, 0.6],
    branchCurve: 42,
    tipDroop: 1.4,
    branchSegments: 6,
    branchLength: [1.7, 4.6],
    branchRadius: [0.035, 0.12],
    subBranches: [2, 3],
    crown: copaConica,
    leafShape: 'agulha',
    leafScale: [0.75, 1.45],
    leafDensity: 2.6,
    clusterRadius: 0.32,
    padFlatten: 0,
    // Conífera vem revestida quase desde o tronco
    foliageStart: 0.1,
    foliageBase: '#2f5d3a',
    // Bem alto: uma conífera é verde-escura antes de ser qualquer outra
    // coisa. A linguagem entra como acento, não como cor dominante.
    foliageTint: 0.72,
    barkDark: '#2a1c14',
    barkLight: '#4d3524',
  },

  salgueiro: {
    id: 'salgueiro',
    nome: 'Salgueiro',
    icone: '🌾',
    descricao: 'Ramos longos que despencam. Melancólico de propósito.',
    trunkHeight: [4, 8],
    trunkRadius: [0.2, 0.5],
    trunkLean: 12,
    trunkWaves: 0.8,
    trunkSubdivisions: 3,
    trunkTaper: 1.2,
    phyllotaxis: 'espiral',
    // Sai mais erguido que as outras: é a curvatura, e não o ângulo de
    // saída, que leva o ramo para baixo — daí o arco em vez da queda reta.
    branchPitch: [44, 70],
    branchYaw: [8, 22],
    maxDepth: 2,
    lengthDecay: [0.6, 0.8],
    radiusDecay: [0.5, 0.62],
    // Galho estrutural arqueia com moderação; quem despenca é a ponta
    branchCurve: 52,
    tipDroop: 2.9,
    branchSegments: 6,
    branchLength: [1.5, 3.9],
    branchRadius: [0.04, 0.14],
    subBranches: [2, 3],
    crown: copaChorao,
    leafShape: 'agulha',
    leafScale: [0.7, 1.4],
    leafDensity: 2.4,
    // Cacho estreito: as folhas descem coladas ao ramo, formando cortina
    clusterRadius: 0.34,
    padFlatten: 0,
    foliageStart: 0.18,
    foliageBase: '#7ba24a',
    foliageTint: 0.46,
    barkDark: '#2f2717',
    barkLight: '#5b4f30',
  },

  cerejeira: {
    id: 'cerejeira',
    nome: 'Cerejeira',
    icone: '🌸',
    descricao: 'Ramificação esparsa e pétalas. Deixa contas pequenas bonitas.',
    trunkHeight: [3.2, 7],
    trunkRadius: [0.16, 0.42],
    trunkLean: 14,
    trunkWaves: 1.0,
    trunkSubdivisions: 3,
    trunkTaper: 1.3,
    phyllotaxis: 'espiral',
    branchPitch: [48, 76],
    branchYaw: [16, 40],
    maxDepth: 3,
    lengthDecay: [0.5, 0.68],
    radiusDecay: [0.5, 0.64],
    branchCurve: -18,
    tipDroop: 1.2,
    branchSegments: 4,
    branchLength: [1.2, 3.6],
    branchRadius: [0.04, 0.15],
    subBranches: [2, 4],
    crown: copaVaso,
    leafShape: 'petala',
    leafScale: [0.8, 1.6],
    leafDensity: 1.7,
    clusterRadius: 0.54,
    padFlatten: 0,
    foliageStart: 0.38,
    foliageBase: '#f2a8c4',
    foliageTint: 0.5,
    barkDark: '#3a2320',
    barkLight: '#6b4a45',
  },

  /**
   * Bonsai — a espécie padrão do projeto.
   *
   * Um bonsai não é "uma árvore pequena": é uma árvore com **proporções de
   * árvore velha** num corpo curto. Três coisas fazem a ilusão, e são elas
   * que os números abaixo perseguem:
   *
   * 1. **Tronco grosso e curto**, torcendo de verdade (`trunkLean` alto
   *    distribuído por muitas subdivisões) e afilando rápido (`trunkTaper`).
   *    Um tronco reto e fino lê como muda, por menor que seja.
   * 2. **Galhos quase horizontais**, saindo em andares. Daí o `branchPitch`
   *    passando de 90° — abaixo disso o galho aponta para cima e a árvore
   *    vira arbusto.
   * 3. **Folha pequena com ramificação densa.** É a razão de escala: folha
   *    miúda sobre galho grosso é o que convence o olho de que a árvore é
   *    grande e está longe. Por isso `leafScale` é o menor do catálogo e
   *    `subBranches`/`leafDensity` os maiores.
   *
   * A altura em unidades de mundo, por outro lado, **não** é miniatura. A
   * câmera, o enquadramento e os anéis da floresta estão calibrados para
   * árvores de 4 a 10 unidades; um bonsai literal de 2 unidades sumiria da
   * cena e viraria um ponto no horizonte quando plantado no anel externo.
   * O que carrega a leitura é a proporção, e não a escala absoluta — não há
   * régua na cena para contradizer.
   */
  bonsai: {
    id: 'bonsai',
    nome: 'Bonsai',
    icone: '🪴',
    descricao: 'Tronco torcido e almofadas de folhagem em andares.',
    trunkHeight: [3.0, 5.6],
    trunkRadius: [0.3, 0.72],
    // Muito acima de qualquer outra espécie: o tronco precisa serpentear,
    // não apenas tombar. As subdivisões são o que transformam essa
    // inclinação total em curva contínua em vez de um joelho só.
    trunkLean: 52,
    // O maior do catálogo: são as curvas do tronco, e não o tamanho, que
    // fazem alguém reconhecer um bonsai numa silhueta.
    trunkWaves: 2.4,
    trunkSubdivisions: 7,
    trunkTaper: 1.95,
    phyllotaxis: 'espiral',
    // Perto da horizontal, mas sem passar dela. A primeira tentativa chegava
    // a 104° — o galho apontava para baixo, e somado ao comprimento acabava
    // enfiado no chão. Quem levanta a ponta aqui é a curvatura negativa, não
    // o ângulo de saída.
    branchPitch: [66, 88],
    branchYaw: [28, 58],
    maxDepth: 3,
    lengthDecay: [0.5, 0.68],
    radiusDecay: [0.54, 0.7],
    // Negativo: o galho desce ao sair e ergue a ponta de volta. É a curva em
    // "S" deitado que separa um galho de bonsai de uma vara pendurada.
    branchCurve: -30,
    // Abaixo de 1 de propósito. A ponta do ramo terminal precisa ficar
    // **plana** para formar a almofada; qualquer queda a mais desmancharia a
    // placa horizontal que a espécie inteira existe para produzir.
    tipDroop: 0.45,
    branchSegments: 6,
    // Curtos em relação ao tronco: um bonsai é compacto, e galho comprido é
    // justamente o que faz uma árvore parecer jovem e esticada. Ainda assim
    // precisam de alcance suficiente para as almofadas se tocarem de um andar
    // para o outro — abaixo disto a copa não fecha.
    branchLength: [0.9, 3.0],
    // Mais fino que na primeira calibragem: galho grosso e comprido virava um
    // cano cinza cruzando a copa e roubava a leitura das almofadas.
    branchRadius: [0.04, 0.15],
    // Ramificação fina e abundante é o que distingue um bonsai maduro de um
    // pré-bonsai: muitos ramos curtos sustentando pouca folha cada. Dois a
    // três, e não mais: a ramificação é exponencial na profundidade, e com
    // quatro a copa fechava numa massa sólida onde nenhuma almofada se via.
    subBranches: [2, 3],
    crown: copaBonsai,
    // Bordo japonês é o bonsai de folhagem por excelência, e a silhueta
    // recortada da folha se lê mesmo em escala pequena.
    leafShape: 'bordo',
    // Menor que a do carvalho ([0.95, 1.95]) porque folha miúda sobre galho
    // grosso é a razão de escala que convence o olho de que a árvore é velha.
    // Mas não miúda a ponto de não formar massa: a folha do bonsai chegou a
    // ter um quinto da área da do carvalho e a copa nunca fechava.
    leafScale: [0.6, 1.05],
    /*
     * Contagem alta com **raio de cacho pequeno**. As duas coisas juntas, e
     * não uma sem a outra — foi o que custou duas tentativas erradas:
     *
     * - Densidade 3.2 com cacho de 0.85 encheu tudo: a árvore virou uma bola
     *   verde sem tronco nem galho visível.
     * - Densidade 1.15 foi para o extremo oposto. Como a folha do bonsai tem
     *   um quinto da área da folha do carvalho, contagem parecida com a dele
     *   dava massa nenhuma, e as árvores nasciam com cara de galho seco.
     *
     * A almofada precisa ser densa por dentro *e* pequena por fora; o que a
     * faz ser lida é o vazio **entre** as almofadas, não a falta de folha
     * dentro de cada uma.
     */
    leafDensity: 2.6,
    clusterRadius: 0.45,
    padFlatten: 0.8,
    // O trecho junto ao tronco fica limpo — é ele que deixa a estrutura à
    // mostra e separa uma almofada da seguinte. Chegou a 0.6 numa tentativa
    // e virou galho nu com um tufo na ponta; com galhos curtos, 0.5 basta.
    foliageStart: 0.5,
    foliageBase: '#4c8340',
    foliageTint: 0.5,
    // Pardo-acinzentado, e **não** o cinza claro da primeira tentativa.
    // Bonsai velho de fato tem tronco lavado pelo tempo, mas madeira clara
    // contra encosta verde lê como galho seco: as árvores de fundo pareciam
    // um bosque morto. O cinza fica na matiz, não no brilho.
    barkDark: '#2a231d',
    barkLight: '#5f5346',
  },

  baoba: {
    id: 'baoba',
    nome: 'Baobá',
    icone: '🪵',
    descricao: 'Tronco imenso, copa rala no alto. Para muito commit, poucos repos.',
    trunkHeight: [3.6, 7.5],
    trunkRadius: [0.5, 1.35],
    trunkLean: 5,
    trunkWaves: 0.4,
    trunkSubdivisions: 3,
    trunkTaper: 2.2,
    phyllotaxis: 'espiral',
    branchPitch: [28, 58],
    branchYaw: [14, 38],
    maxDepth: 2,
    lengthDecay: [0.45, 0.6],
    radiusDecay: [0.45, 0.6],
    branchCurve: -48,
    tipDroop: 1.1,
    branchSegments: 4,
    branchLength: [1, 3],
    branchRadius: [0.06, 0.24],
    subBranches: [2, 3],
    crown: copaGuardaChuva,
    leafShape: 'coracao',
    leafScale: [0.85, 1.7],
    leafDensity: 1,
    clusterRadius: 0.48,
    padFlatten: 0,
    foliageStart: 0.45,
    foliageBase: '#6d9440',
    foliageTint: 0.44,
    barkDark: '#3a3128',
    barkLight: '#7a6a55',
  },
};

export const SPECIES_ORDER: SpeciesId[] = [
  'carvalho',
  'pinheiro',
  'salgueiro',
  'cerejeira',
  'bonsai',
  'baoba',
];

/**
 * `'auto'` deixa a espécie ser derivada da seed do usuário.
 * É o padrão porque garante variedade entre perfis sem exigir que ninguém
 * escolha nada — e é o que fará a floresta da Fase 3 nascer diversa mesmo
 * antes de existir login para guardar a preferência de cada dono.
 */
export type SpeciesChoice = SpeciesId | 'auto';

/**
 * Bonsai é o padrão, e não `'auto'`.
 *
 * `'auto'` continua sendo o modo mais interessante a longo prazo — sorteia a
 * espécie pela seed e faz a floresta nascer diversa sem ninguém escolher nada
 * — mas ele também significa que o primeiro contato com o projeto é uma
 * espécie aleatória, e a variação de qualidade entre elas ainda é grande.
 * Fixar o bonsai garante que quem chega vê a árvore mais trabalhada do
 * catálogo. Quem quiser a variedade de volta escolhe "Automático" no painel
 * de estilo, e a escolha persiste.
 */
export const DEFAULT_SPECIES_CHOICE: SpeciesChoice = 'bonsai';

/** Espécie determinística de um usuário, quando ele não escolheu nenhuma. */
export function speciesForSeed(seed: number): SpeciesId {
  const i = hashString(String(seed)) % SPECIES_ORDER.length;
  return SPECIES_ORDER[i];
}

export function resolveSpecies(
  choice: SpeciesChoice,
  seed: number,
): SpeciesProfile {
  if (choice === 'auto') return SPECIES[speciesForSeed(seed)];
  return SPECIES[choice] ?? SPECIES[speciesForSeed(seed)];
}

export function isSpeciesId(value: string): value is SpeciesId {
  return value in SPECIES;
}
