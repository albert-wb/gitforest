/**
 * GitForest — Descoberta do Grafo Social
 *
 * ## O que conta como "amigo"
 *
 * O GitHub não tem amizade — tem `followers` e `following`, unidirecionais e
 * bastante poluídos por follow de celebridade. A definição honesta é o
 * **follow mútuo**: quem você segue e também te segue.
 *
 * ⚠️ **Limitação conhecida.** Sem estar autenticado como o próprio usuário
 * não há como perguntar ao GitHub "esta pessoa me segue de volta?"; o campo
 * `viewerIsFollowing` é relativo ao dono do token, não ao perfil consultado.
 * Então a mutualidade aqui é calculada interseccionando as duas listas
 * paginadas. Para contas com muitos seguidores a lista é truncada e alguns
 * mútuos escapam — por isso existe o modo de fallback. A Fase 4, com OAuth,
 * resolve isso de vez.
 *
 * ## Orçamento de requisições
 *
 * A query completa de perfil (30 repos, histórico de commits, calendário de
 * contribuições inteiro) é cara demais para dezenas de usuários. As árvores
 * de fundo usam uma query reduzida — 8 repos, sem o calendário dia a dia —
 * e vão em lotes por aliases GraphQL, de forma que dez perfis cabem numa
 * requisição só.
 */

import type { GitHubUser } from '../engine/types';

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

/**
 * Logins por requisição ao buscar conexões. Listas de seguidores são baratas.
 */
const CONNECTION_BATCH_SIZE = 10;

/**
 * Perfis por requisição ao buscar dados de árvore.
 *
 * ⚠️ **Quatro não é um número escolhido no chute.** `contributionsCollection`
 * é caro do lado do GitHub, e um lote de dez perfis leva a API a estourar em
 * **504 Gateway Timeout** depois de uns onze segundos. Pior: a página de erro
 * do edge deles vem com um cabeçalho `Access-Control-Allow-Origin` malformado
 * (`*;`), então o navegador reporta o problema como falha de CORS e esconde o
 * 504 — o que manda quem estiver depurando para o caminho errado.
 *
 * Medições diretas: 10 perfis → 504 em 11s; 5 perfis → 200 em 5,0s;
 * 3 perfis → 200 em 3,1s.
 */
const PROFILE_BATCH_SIZE = 4;

/**
 * Lotes de perfis em voo ao mesmo tempo.
 *
 * Em série, setenta árvores levariam mais de um minuto. Com três lotes
 * simultâneos a floresta fecha em torno de vinte segundos — e como cada lote
 * planta as suas árvores assim que chega, a espera vira a própria animação.
 */
const PROFILE_CONCURRENCY = 3;

/**
 * Concorrência do modo país.
 *
 * Mais agressiva porque ali a floresta se enche continuamente enquanto a
 * câmera anda, e não numa carga única: a três lotes por vez, encher o raio de
 * carga levava mais de um minuto e a pessoa via a floresta se formando em
 * câmera lenta. O limite dos 504 é o **tamanho** do lote, não quantos deles
 * estão em voo — por isso é este número que sobe, e não `PROFILE_BATCH_SIZE`.
 */
export const STREAM_CONCURRENCY = 5;

/** Quantos perfis buscar em cada grau. */
export const FIRST_DEGREE_LIMIT = 24;
export const SECOND_DEGREE_LIMIT = 48;

/** Abaixo disto a interseção não é confiável e vale mais usar `following`. */
const MIN_MUTUALS = 3;

export type ConnectionMode = 'mutuos' | 'seguindo';

export interface ForestGraph {
  root: string;
  mode: ConnectionMode;
  /** Logins de primeiro grau, já ordenados por força do laço. */
  firstDegree: string[];
  /** Logins de segundo grau. */
  secondDegree: string[];
  /** Quantos mútuos em comum cada login de segundo grau tem com a raiz. */
  sharedCount: Map<string, number>;
}

interface Connections {
  following: string[];
  followers: string[];
}

async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Token do GitHub inválido ou expirado.');
    }
    if (response.status === 403) {
      throw new Error(
        'Limite de requisições do GitHub atingido. Tente novamente mais tarde.',
      );
    }
    throw new Error(`Erro na API do GitHub: ${response.status}`);
  }

  const json = await response.json();
  if (json.errors) {
    const first = json.errors[0];
    if (first?.type === 'NOT_FOUND') {
      throw new Error('Usuário não encontrado no GitHub.');
    }
    throw new Error(`Erro GraphQL: ${first?.message ?? 'desconhecido'}`);
  }

  return json.data as T;
}

// ============================================================
// Conexões
// ============================================================

const CONNECTIONS_QUERY = `
  query Connections($login: String!) {
    user(login: $login) {
      following(first: 100) { nodes { login } }
      followers(first: 100) { nodes { login } }
    }
  }
`;

async function fetchConnections(
  login: string,
  token?: string,
): Promise<Connections> {
  const data = await graphql<{
    user: {
      following: { nodes: { login: string }[] };
      followers: { nodes: { login: string }[] };
    } | null;
  }>(CONNECTIONS_QUERY, { login }, token);

  if (!data.user) throw new Error(`Usuário "${login}" não encontrado.`);

  return {
    following: data.user.following.nodes.map((n) => n.login),
    followers: data.user.followers.nodes.map((n) => n.login),
  };
}

/** Busca as conexões de vários usuários numa requisição só. */
async function fetchConnectionsBatch(
  logins: string[],
  token?: string,
): Promise<Map<string, Connections>> {
  const result = new Map<string, Connections>();

  for (let i = 0; i < logins.length; i += CONNECTION_BATCH_SIZE) {
    const slice = logins.slice(i, i + CONNECTION_BATCH_SIZE);

    // Aliases numerados: os logins entram como variáveis, nunca interpolados
    // direto na query.
    const fields = slice
      .map(
        (_, k) => `
        u${k}: user(login: $login${k}) {
          login
          following(first: 60) { nodes { login } }
          followers(first: 60) { nodes { login } }
        }`,
      )
      .join('\n');

    const declarations = slice
      .map((_, k) => `$login${k}: String!`)
      .join(', ');

    const variables: Record<string, string> = {};
    slice.forEach((login, k) => {
      variables[`login${k}`] = login;
    });

    try {
      const data = await graphql<Record<string, unknown>>(
        `query BatchConnections(${declarations}) { ${fields} }`,
        variables,
        token,
      );

      slice.forEach((login, k) => {
        const node = data[`u${k}`] as {
          following: { nodes: { login: string }[] };
          followers: { nodes: { login: string }[] };
        } | null;
        if (!node) return;
        result.set(login, {
          following: node.following.nodes.map((n) => n.login),
          followers: node.followers.nodes.map((n) => n.login),
        });
      });
    } catch {
      // Um lote que falha não pode derrubar a floresta inteira: os graus
      // seguintes simplesmente ficam menores.
    }
  }

  return result;
}

function mutualsOf(conn: Connections): string[] {
  const followerSet = new Set(conn.followers);
  return conn.following.filter((login) => followerSet.has(login));
}

/**
 * Monta o grafo da floresta em torno de um usuário.
 *
 * Primeiro grau são os mútuos; segundo grau são os mútuos deles, ordenados
 * por quantidade de conexões em comum com a raiz — o mesmo critério que o
 * LinkedIn usa para "conexões em comum", e que aqui vira a distância radial
 * da árvore no terreno.
 */
export async function fetchForestGraph(
  root: string,
  token?: string,
): Promise<ForestGraph> {
  const rootConn = await fetchConnections(root, token);

  let mode: ConnectionMode = 'mutuos';
  let firstDegree = mutualsOf(rootConn);

  if (firstDegree.length < MIN_MUTUALS) {
    // Conta muito seguida (lista de seguidores truncada) ou muito nova.
    // Cair para `following` entrega uma floresta em vez de um vazio.
    mode = 'seguindo';
    firstDegree = rootConn.following;
  }

  firstDegree = firstDegree
    .filter((login) => login !== root)
    .slice(0, FIRST_DEGREE_LIMIT);

  const firstSet = new Set(firstDegree);
  const sharedCount = new Map<string, number>();

  const friendConnections = await fetchConnectionsBatch(firstDegree, token);

  for (const conn of friendConnections.values()) {
    const candidates = mode === 'mutuos' ? mutualsOf(conn) : conn.following;
    for (const login of candidates) {
      if (login === root || firstSet.has(login)) continue;
      sharedCount.set(login, (sharedCount.get(login) ?? 0) + 1);
    }
  }

  const secondDegree = [...sharedCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, SECOND_DEGREE_LIMIT)
    .map(([login]) => login);

  return { root, mode, firstDegree, secondDegree, sharedCount };
}

// ============================================================
// Perfis reduzidos
// ============================================================

/**
 * Query enxuta para árvores de fundo.
 *
 * Perde-se o calendário dia a dia e ficam 12 repositórios em vez de 30. O
 * `normalizeUserData` continua funcionando sem alteração porque ele só lê
 * `contributionCalendar.totalContributions`, que segue aqui.
 *
 * ⚠️ **O número de repositórios é o número de galhos.** Com oito, as árvores
 * de fundo nasciam com meia dúzia de varas e clareiras entre elas — pareciam
 * mortas, e por um tempo a culpa foi atribuída à espécie e ao orçamento de
 * folhas. Doze é o ponto onde a copa fecha sem que o custo do lote volte a
 * flertar com o 504 (ver `PROFILE_BATCH_SIZE`); o caro nesta query é o
 * `contributionsCollection`, não a lista de repositórios.
 */
const LITE_USER_FIELDS = `
  login
  name
  avatarUrl
  createdAt
  bio
  followers { totalCount }
  following { totalCount }
  repositories(
    first: 12
    orderBy: { field: STARGAZERS, direction: DESC }
    ownerAffiliations: OWNER
    isFork: false
  ) {
    totalCount
    nodes {
      name
      createdAt
      updatedAt
      pushedAt
      stargazerCount
      forkCount
      primaryLanguage { name color }
      languages(first: 3) { edges { size node { name color } } }
      defaultBranchRef {
        target { ... on Commit { history { totalCount } } }
      }
    }
  }
  contributionsCollection {
    totalCommitContributions
    totalPullRequestContributions
    totalIssueContributions
    contributionCalendar { totalContributions }
  }
`;

/**
 * Busca perfis reduzidos em lotes, entregando cada lote assim que chega.
 *
 * O callback é o que transforma a latência em narrativa: em vez de um spinner
 * de vinte segundos, as árvores vão brotando conforme os dados aparecem.
 */
export async function fetchLiteProfiles(
  logins: string[],
  token: string | undefined,
  onBatch: (users: GitHubUser[]) => void,
  concurrency: number = PROFILE_CONCURRENCY,
): Promise<{ failedBatches: number }> {
  const slices: string[][] = [];
  for (let i = 0; i < logins.length; i += PROFILE_BATCH_SIZE) {
    slices.push(logins.slice(i, i + PROFILE_BATCH_SIZE));
  }

  let failedBatches = 0;
  let next = 0;

  const runOne = async (slice: string[]): Promise<void> => {
    const declarations = slice.map((_, k) => `$login${k}: String!`).join(', ');
    const fields = slice
      .map((_, k) => `u${k}: user(login: $login${k}) { ${LITE_USER_FIELDS} }`)
      .join('\n');

    const variables: Record<string, string> = {};
    slice.forEach((login, k) => {
      variables[`login${k}`] = login;
    });

    try {
      const data = await graphql<Record<string, unknown>>(
        `query BatchProfiles(${declarations}) { ${fields} }`,
        variables,
        token,
      );

      const users: GitHubUser[] = [];
      slice.forEach((_, k) => {
        const node = data[`u${k}`] as GitHubUser | null;
        if (node) users.push(node);
      });

      if (users.length > 0) onBatch(users);
    } catch {
      // Lote perdido: a floresta nasce com alguns claros, e segue de pé
      failedBatches++;
    }
  };

  // Trabalhadores puxando de uma fila comum: mantém sempre
  // `PROFILE_CONCURRENCY` requisições em voo, sem esperar a mais lenta de
  // cada rodada como faria um `Promise.all` por blocos.
  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), slices.length) },
    async () => {
      while (next < slices.length) {
        const slice = slices[next++];
        await runOne(slice);
      }
    },
  );

  await Promise.all(workers);

  return { failedBatches };
}
