/**
 * GitForest — Interaction Store (Zustand)
 *
 * Estado global para interação 3D: hover, seleção de galhos,
 * e sincronização entre UI e cena.
 */

import { create } from 'zustand';

interface InteractionStore {
  /** Índice do galho em hover (-1 = nenhum) */
  hoveredBranchIndex: number;

  /** Índice do galho selecionado (-1 = nenhum) */
  selectedBranchIndex: number;

  /** Nome do repositório em hover */
  hoveredRepoName: string | null;

  /** Se a interação veio da UI (painel) ou da cena 3D */
  interactionSource: 'scene' | 'panel' | null;

  /** Ações */
  setHoveredBranch: (index: number, name?: string | null, source?: 'scene' | 'panel') => void;
  setSelectedBranch: (index: number) => void;
  clearHover: () => void;
  clearSelection: () => void;
}

export const useInteractionStore = create<InteractionStore>((set) => ({
  hoveredBranchIndex: -1,
  selectedBranchIndex: -1,
  hoveredRepoName: null,
  interactionSource: null,

  setHoveredBranch: (index, name = null, source = 'scene') => {
    set({
      hoveredBranchIndex: index,
      hoveredRepoName: name,
      interactionSource: source,
    });
  },

  setSelectedBranch: (index) => {
    set({ selectedBranchIndex: index });
  },

  clearHover: () => {
    set({
      hoveredBranchIndex: -1,
      hoveredRepoName: null,
      interactionSource: null,
    });
  },

  clearSelection: () => {
    set({ selectedBranchIndex: -1 });
  },
}));
