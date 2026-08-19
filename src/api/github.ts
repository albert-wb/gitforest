/**
 * GitForest — Client GitHub GraphQL API
 *
 * Busca dados do perfil, repositórios, linguagens e contribuições.
 * Inclui cache em localStorage com TTL configurável.
 */

import type { GitHubUser } from '../engine/types';

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

/**
 * Versão do formato retornado por `USER_QUERY`.
 *
 * **Incremente sempre que a query ganhar, perder ou renomear campos.** Sem
 * isso, quem tem cache quente recebe por até uma hora um objeto no formato
 * antigo, e os campos novos chegam como `undefined` — uma falha silenciosa
 * que só aparece bem longe daqui, no normalizer ou no engine.
 */
const QUERY_VERSION = 'v1';
const CACHE_PREFIX = `gitforest_cache_${QUERY_VERSION}_`;
const LEGACY_CACHE_PREFIX = 'gitforest_cache_';

/**
 * Query GraphQL para buscar todos os dados necessários de um usuário.
 */
const USER_QUERY = `
  query UserTree($username: String!) {
    user(login: $username) {
      login
      name
      avatarUrl
      createdAt
      bio
      followers { totalCount }
      following { totalCount }
      repositories(
        first: 30
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
          primaryLanguage {
            name
            color
          }
          languages(first: 5) {
            edges {
              size
              node {
                name
                color
              }
            }
          }
          defaultBranchRef {
            target {
              ... on Commit {
                history {
                  totalCount
                }
              }
            }
          }
        }
      }
      contributionsCollection {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              contributionCount
              date
              color
            }
          }
        }
      }
    }
  }
`;

/**
 * Busca dados de um usuário do GitHub via GraphQL API.
 * Usa cache local para evitar rate limiting.
 */
export async function fetchGitHubUser(
  username: string,
  token?: string,
): Promise<GitHubUser> {
  // Verificar cache
  const cached = getFromCache(username);
  if (cached) return cached;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: USER_QUERY,
      variables: { username },
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Token do GitHub inválido ou expirado.');
    }
    if (response.status === 403) {
      throw new Error(
        'Rate limit atingido. Tente novamente mais tarde ou adicione um token do GitHub.',
      );
    }
    throw new Error(`Erro na API do GitHub: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();

  if (json.errors) {
    const firstError = json.errors[0];
    if (firstError?.type === 'NOT_FOUND') {
      throw new Error(`Usuário "${username}" não encontrado no GitHub.`);
    }
    throw new Error(`Erro GraphQL: ${firstError?.message ?? 'Erro desconhecido'}`);
  }

  const user: GitHubUser = json.data.user;

  if (!user) {
    throw new Error(`Usuário "${username}" não encontrado no GitHub.`);
  }

  // Salvar no cache
  saveToCache(username, user);

  return user;
}

// ============================================================
// Cache em localStorage
// ============================================================

interface CacheEntry {
  data: GitHubUser;
  timestamp: number;
}

/**
 * Remove entradas de versões anteriores da query.
 *
 * O `localStorage` tem cerca de 5 MB e cada perfil cacheado ocupa dezenas de
 * kilobytes; deixar formatos obsoletos acumulando levaria a quota a estourar
 * — e `saveToCache` engole esse erro em silêncio.
 */
function purgeLegacyCache(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        key.startsWith(LEGACY_CACHE_PREFIX) &&
        !key.startsWith(CACHE_PREFIX)
      ) {
        stale.push(key);
      }
    }
    stale.forEach((key) => localStorage.removeItem(key));
  } catch {
    // localStorage indisponível — nada a limpar
  }
}

purgeLegacyCache();

function getFromCache(username: string): GitHubUser | null {
  try {
    const key = CACHE_PREFIX + username.toLowerCase();
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const entry: CacheEntry = JSON.parse(raw);
    const age = Date.now() - entry.timestamp;

    if (age > CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }

    return entry.data;
  } catch {
    return null;
  }
}

function saveToCache(username: string, data: GitHubUser): void {
  try {
    const key = CACHE_PREFIX + username.toLowerCase();
    const entry: CacheEntry = { data, timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // localStorage cheio ou indisponível — ignora silenciosamente
  }
}
