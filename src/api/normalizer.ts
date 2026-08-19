/**
 * GitForest — Normalizer
 *
 * Transforma dados brutos da API do GitHub em TreeParams
 * normalizados (0-1) que alimentam o motor L-System.
 *
 * Todas as normalizações usam escala logarítmica para lidar
 * com a distribuição assimétrica dos dados (poucos repos com
 * milhares de stars vs. maioria com 0-10).
 */

import type { GitHubUser, GitHubRepo, TreeParams, BranchParams, ProfileData } from '../engine/types';
import { logNormalize, clamp01, hashString } from '../utils/math';
import { getLanguageColor } from '../utils/colors';

/**
 * Transforma dados brutos do GitHub em parâmetros normalizados da árvore.
 */
export function normalizeUserData(user: GitHubUser): TreeParams {
  const accountAge = getAccountAgeYears(user.createdAt);
  const totalRepos = user.repositories.totalCount;
  const totalContributions =
    user.contributionsCollection.contributionCalendar.totalContributions;

  const profile: ProfileData = {
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    bio: user.bio,
    followers: user.followers.totalCount,
    following: user.following.totalCount,
    totalRepos,
  };

  // Normalizar tronco
  const trunkHeight = clamp01(
    logNormalize(totalRepos, 200) * 0.5 +
    logNormalize(accountAge, 15) * 0.5,
  );

  const trunkWidth = clamp01(
    logNormalize(totalContributions, 10000),
  );

  const rootDepth = clamp01(
    logNormalize(accountAge, 15),
  );

  // Normalizar galhos (top 30 repos)
  const branches: BranchParams[] = user.repositories.nodes
    .slice(0, 30)
    .map((repo) => normalizeBranch(repo));

  // Seed determinística baseada no login
  const seed = hashString(user.login);

  return {
    profile,
    trunkHeight,
    trunkWidth,
    rootDepth,
    branches,
    seed,
    totalContributions,
  };
}

/**
 * Normaliza um repositório individual em parâmetros de galho.
 */
function normalizeBranch(repo: GitHubRepo): BranchParams {
  const commits = repo.defaultBranchRef?.target?.history?.totalCount ?? 0;
  const stars = repo.stargazerCount;
  const forks = repo.forkCount;

  // Espessura: baseada em commits + stars
  const thickness = clamp01(
    logNormalize(commits, 5000) * 0.6 +
    logNormalize(stars, 1000) * 0.4,
  );

  // Comprimento: baseado na idade do repo + commits
  const repoAge = getAccountAgeYears(repo.createdAt);
  const length = clamp01(
    logNormalize(repoAge, 10) * 0.4 +
    logNormalize(commits, 2000) * 0.6,
  );

  // Densidade de folhas: baseada na atividade recente
  const daysSinceUpdate = getDaysSince(repo.pushedAt ?? repo.updatedAt);
  const recentActivity = clamp01(1 - daysSinceUpdate / (365 * 3));
  const leafDensity = clamp01(recentActivity * 0.7 + logNormalize(commits, 1000) * 0.3);

  // Cor das folhas
  const languageName = repo.primaryLanguage?.name ?? 'Unknown';
  const leafColor = repo.primaryLanguage?.color ?? getLanguageColor(languageName);

  // Repositório inativo (sem push há mais de 3 anos)
  const isDead = daysSinceUpdate > 365 * 3;

  // Sub-galhos baseados em forks
  const subBranches = clamp01(logNormalize(forks, 500));

  return {
    name: repo.name,
    thickness,
    length,
    leafDensity,
    leafColor,
    languageName,
    isDead,
    subBranches,
    stars,
    commits,
  };
}

/**
 * Calcula a idade em anos de uma data ISO.
 */
function getAccountAgeYears(isoDate: string): number {
  const created = new Date(isoDate);
  const now = new Date();
  return (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
}

/**
 * Calcula dias desde uma data ISO.
 */
function getDaysSince(isoDate: string): number {
  const date = new Date(isoDate);
  const now = new Date();
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
}
