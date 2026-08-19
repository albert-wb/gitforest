/**
 * GitForest — Store (Zustand)
 *
 * Estado global da aplicação: dados do GitHub,
 * parâmetros da árvore, e geometria gerada.
 */

import { create } from 'zustand';
import type { TreeParams, TreeGeometry } from '../engine/types';
import { fetchGitHubUser } from '../api/github';
import { normalizeUserData } from '../api/normalizer';
import { generateTree } from '../engine';
import { useSceneStore } from './useSceneStore';
import { useForestStore } from './useForestStore';

export type AppStatus = 'idle' | 'loading' | 'ready' | 'error';

interface TreeStore {
  /** Status atual da aplicação */
  status: AppStatus;

  /** Mensagem de erro (se houver) */
  error: string | null;

  /** Username buscado */
  username: string;

  /** Parâmetros normalizados da árvore */
  treeParams: TreeParams | null;

  /** Geometria gerada pelo L-System */
  treeGeometry: TreeGeometry | null;

  /** Token GitHub (opcional, para aumentar rate limit) */
  githubToken: string;

  /** Buscar dados de um usuário e gerar a árvore */
  fetchAndGenerate: (username: string) => Promise<void>;

  /**
   * Regenerar a geometria com os mesmos dados já em memória.
   * Usado ao trocar de espécie, que muda a gramática do L-System — sem
   * refazer a chamada ao GitHub.
   */
  regenerate: () => void;

  /** Definir token GitHub */
  setGithubToken: (token: string) => void;

  /** Resetar para o estado inicial */
  reset: () => void;
}

export const useTreeStore = create<TreeStore>((set, get) => ({
  status: 'idle',
  error: null,
  username: '',
  treeParams: null,
  treeGeometry: null,
  githubToken: localStorage.getItem('gitforest_token') || (import.meta.env.VITE_GITHUB_TOKEN as string) || '',

  fetchAndGenerate: async (username: string) => {
    set({ status: 'loading', error: null, username });

    try {
      const token = get().githubToken || undefined;

      // 1. Buscar dados do GitHub
      const userData = await fetchGitHubUser(username, token);

      // 2. Normalizar dados → TreeParams
      const treeParams = normalizeUserData(userData);

      // 3. Gerar geometria via L-System + Turtle, com a espécie escolhida
      //    (ou `'auto'`, que a deriva da seed do próprio usuário)
      const treeGeometry = generateTree(
        treeParams,
        useSceneStore.getState().species,
      );

      set({
        status: 'ready',
        treeParams,
        treeGeometry,
        error: null,
      });

      // A floresta cresce junto, sem depender de mais nenhum clique.
      //
      // Ela era disparada por um botão, e o resultado é que quase ninguém
      // chegava a ver a feature: o projeto se chama GitForest e o que
      // aparecia era uma árvore sozinha. Agora buscar um usuário significa
      // ver o usuário **e** as pessoas em volta dele.
      //
      // Deliberadamente não usa `await`: a árvore em foco já está pronta e
      // deve aparecer agora. A floresta chega em lotes por cima disso, e cada
      // lote planta as suas árvores assim que responde — a latência da API
      // vira a animação de crescimento em vez de virar espera. Um erro aqui
      // fica contido na store da floresta e não derruba a árvore que já
      // nasceu, que é justamente o motivo de as duas stores serem separadas.
      void useForestStore.getState().growForest(username, token);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro desconhecido';
      set({ status: 'error', error: message });
    }
  },

  regenerate: () => {
    const { treeParams } = get();
    if (!treeParams) return;

    set({
      treeGeometry: generateTree(
        treeParams,
        useSceneStore.getState().species,
      ),
    });
  },

  setGithubToken: (token: string) => {
    localStorage.setItem('gitforest_token', token);
    set({ githubToken: token });
  },

  reset: () => {
    set({
      status: 'idle',
      error: null,
      username: '',
      treeParams: null,
      treeGeometry: null,
    });
  },
}));
