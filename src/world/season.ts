/**
 * GitForest — Estações
 *
 * Eixo cosmético independente da espécie: a mesma árvore em quatro estados.
 *
 * Decisão de arquitetura importante: **trocar de estação não regenera a
 * árvore.** O matiz é um uniform do shader, e a densidade é aplicada como um
 * corte na contagem de instâncias do `InstancedMesh`. Isso só funciona porque
 * a lista de folhas é embaralhada na geração (ver `shuffleLeaves` em
 * `turtle.ts`) — sem o embaralhamento, cortar a contagem desfolharia galhos
 * inteiros em vez de desbastar a copa por igual.
 *
 * Espécie, por outro lado, muda a gramática e exige regeneração.
 */

export type SeasonId = 'primavera' | 'verao' | 'outono' | 'inverno';

export interface SeasonProfile {
  id: SeasonId;
  nome: string;
  icone: string;
  /** Cor para a qual a folhagem inteira é puxada. */
  tint: string;
  /** Intensidade dessa puxada (0-1). */
  tintAmount: number;
  /** Multiplicador sobre a quantidade de folhas visíveis. */
  density: number;
  /** Multiplicador de brilho da folhagem. */
  brightness: number;
}

export const SEASONS: Record<SeasonId, SeasonProfile> = {
  primavera: {
    id: 'primavera',
    nome: 'Primavera',
    icone: '🌱',
    tint: '#a8d06a',
    tintAmount: 0.22,
    density: 0.85,
    brightness: 1.08,
  },
  verao: {
    id: 'verao',
    nome: 'Verão',
    icone: '☘️',
    tint: '#4e8f3a',
    tintAmount: 0.1,
    density: 1,
    brightness: 1,
  },
  outono: {
    id: 'outono',
    nome: 'Outono',
    icone: '🍂',
    tint: '#d9761f',
    tintAmount: 0.62,
    density: 0.7,
    brightness: 1.02,
  },
  inverno: {
    id: 'inverno',
    nome: 'Inverno',
    icone: '❄️',
    tint: '#cfd8e3',
    tintAmount: 0.42,
    // Quase desfolhada: é o estado em que a estrutura de galhos aparece
    density: 0.12,
    brightness: 0.88,
  },
};

export const SEASON_ORDER: SeasonId[] = [
  'primavera',
  'verao',
  'outono',
  'inverno',
];

export const DEFAULT_SEASON: SeasonId = 'verao';

export function getSeason(id: SeasonId): SeasonProfile {
  return SEASONS[id] ?? SEASONS[DEFAULT_SEASON];
}

export function isSeasonId(value: string): value is SeasonId {
  return value in SEASONS;
}
