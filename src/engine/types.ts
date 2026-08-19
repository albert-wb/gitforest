/**
 * GitForest — Tipos do Engine
 *
 * Define todas as interfaces para o pipeline:
 * GitHub API → Normalizer → L-System → Turtle 3D → Geometria
 */

// ============================================================
// Dados normalizados do GitHub (saída do Normalizer)
// ============================================================

export interface TreeParams {
  /** Dados do perfil do usuário */
  profile: ProfileData;

  /** Altura do tronco normalizada (0-1) */
  trunkHeight: number;

  /** Largura do tronco normalizada (0-1) */
  trunkWidth: number;

  /** Profundidade das raízes (0-1), baseada na idade da conta */
  rootDepth: number;

  /** Galhos (um por repositório, top 30) */
  branches: BranchParams[];

  /**
   * Seed determinística para PRNG, derivada de `hashString(user.login)`.
   * Consequência: renomear a conta no GitHub gera outra árvore.
   */
  seed: number;

  /** Total de contribuições (usado para densidade global de folhas) */
  totalContributions: number;
}

export interface ProfileData {
  login: string;
  name: string | null;
  avatarUrl: string;
  createdAt: string;
  bio: string | null;
  followers: number;
  following: number;
  totalRepos: number;
}

export interface BranchParams {
  /** Nome do repositório */
  name: string;

  /** Espessura do galho normalizada (0-1), f(commits, stars) */
  thickness: number;

  /** Comprimento do galho normalizado (0-1), f(repo_age, total_commits) */
  length: number;

  /** Densidade de folhas (0-1), f(atividade recente) */
  leafDensity: number;

  /** Cor principal das folhas (hex), da linguagem primária */
  leafColor: string;

  /** Nome da linguagem primária */
  languageName: string;

  /** Se o repositório está inativo (sem push há mais de 3 anos) */
  isDead: boolean;

  /** Número de sub-galhos (0-1), f(forks) */
  subBranches: number;

  /** Número de stars */
  stars: number;

  /** Número de commits */
  commits: number;
}

// ============================================================
// L-System
// ============================================================

/** Um símbolo paramétrico do L-System */
export interface LSymbol {
  /** Caractere do símbolo (F, +, -, [, ], etc.) */
  char: string;

  /** Parâmetros numéricos associados */
  params: number[];
}

/** Regra de produção paramétrica */
export interface ProductionRule {
  /** Símbolo predecessor */
  predecessor: string;

  /** Condição para aplicar a regra (recebe params do símbolo) */
  condition?: (params: number[]) => boolean;

  /**
   * Função de produção: recebe params do predecessor e
   * retorna o novo array de símbolos.
   * O segundo argumento é o gerador de números aleatórios seedado.
   */
  produce: (params: number[], rng: () => number) => LSymbol[];
}

/** Gramática completa do L-System */
export interface LSystemGrammar {
  axiom: LSymbol[];
  rules: ProductionRule[];
  iterations: number;
}

// ============================================================
// Turtle 3D (saída geométrica)
// ============================================================

/** Um segmento individual de tronco/galho */
export interface TreeSegment {
  /** Ponto inicial */
  start: [number, number, number];

  /** Ponto final */
  end: [number, number, number];

  /** Raio no ponto inicial */
  startRadius: number;

  /** Raio no ponto final */
  endRadius: number;

  /** Índice do galho (para mapear cores) */
  branchIndex: number;

  /** Profundidade na hierarquia (0 = tronco) */
  depth: number;

  /** Se é um galho "morto" */
  isDead: boolean;
}

/** Posição e dados de uma folha individual */
export interface LeafData {
  /** Posição no espaço 3D */
  position: [number, number, number];

  /** Normal/orientação */
  normal: [number, number, number];

  /** Cor (hex string) */
  color: string;

  /** Escala da folha */
  scale: number;

  /** Índice do galho pai */
  branchIndex: number;
}

/** Geometria completa da árvore (saída final do Turtle) */
export interface TreeGeometry {
  segments: TreeSegment[];
  leaves: LeafData[];
  roots: TreeSegment[];
}

// ============================================================
// GitHub API (dados brutos)
// ============================================================

export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  createdAt: string;
  bio: string | null;
  followers: { totalCount: number };
  following: { totalCount: number };
  repositories: {
    totalCount: number;
    nodes: GitHubRepo[];
  };
  contributionsCollection: {
    totalCommitContributions: number;
    totalPullRequestContributions: number;
    totalIssueContributions: number;
    contributionCalendar: {
      totalContributions: number;
      /**
       * Opcional: a query reduzida usada pelas árvores de fundo omite o
       * calendário dia a dia (~365 nós por usuário, caro no orçamento de
       * pontos do GraphQL). O normalizador só depende de
       * `totalContributions`, então ambas as formas funcionam.
       */
      weeks?: {
        contributionDays: {
          contributionCount: number;
          date: string;
          color: string;
        }[];
      }[];
    };
  };
}

export interface GitHubRepo {
  name: string;
  createdAt: string;
  updatedAt: string;
  pushedAt: string | null;
  stargazerCount: number;
  forkCount: number;
  primaryLanguage: {
    name: string;
    color: string;
  } | null;
  languages: {
    edges: {
      size: number;
      node: {
        name: string;
        color: string;
      };
    }[];
  };
  defaultBranchRef: {
    target: {
      history: {
        totalCount: number;
      };
    };
  } | null;
}
