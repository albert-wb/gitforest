/**
 * GitForest — Store da Cena
 *
 * Estado visual, separado do estado de dados (`useTreeStore`).
 *
 * Os três eixos têm custos bem diferentes, e a store existe em parte para
 * deixar isso explícito:
 *
 * - **Atmosfera** — uniforms e luzes. Instantâneo.
 * - **Estação** — uniform de matiz e corte na contagem de instâncias.
 *   Instantâneo (ver `world/season.ts`).
 * - **Espécie** — muda a gramática do L-System. Exige regenerar a geometria,
 *   e é por isso que `App` observa esta chave para chamar `regenerate()`.
 */

import { create } from 'zustand';
import {
  DEFAULT_ATMOSPHERE,
  nextAtmosphere,
  type AtmosphereId,
} from '../world/atmosphere';
import { DEFAULT_SEASON, isSeasonId, type SeasonId } from '../world/season';
import {
  DEFAULT_SPECIES_CHOICE,
  isSpeciesId,
  type SpeciesChoice,
} from '../engine/species';

const KEY_ATMOSPHERE = 'gitforest_atmosphere';
/**
 * Versionada porque o padrão mudou de `'auto'` para `'bonsai'` na v1.4.0.
 * Sem trocar a chave, todo mundo que já tinha aberto o projeto continuaria
 * preso ao padrão antigo gravado no navegador e nunca veria a mudança —
 * inclusive quem estivesse testando a alteração.
 */
const KEY_SPECIES = 'gitforest_species_v2';
const KEY_SEASON = 'gitforest_season';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Modo privado ou storage cheio — a preferência apenas não persiste
  }
}

function loadSpecies(): SpeciesChoice {
  const saved = read(KEY_SPECIES);
  if (saved === 'auto') return 'auto';
  if (saved && isSpeciesId(saved)) return saved;
  return DEFAULT_SPECIES_CHOICE;
}

function loadSeason(): SeasonId {
  const saved = read(KEY_SEASON);
  return saved && isSeasonId(saved) ? saved : DEFAULT_SEASON;
}

interface SceneStore {
  atmosphere: AtmosphereId;
  species: SpeciesChoice;
  season: SeasonId;

  setAtmosphere: (id: AtmosphereId) => void;
  cycleAtmosphere: () => void;
  setSpecies: (choice: SpeciesChoice) => void;
  setSeason: (id: SeasonId) => void;
}

export const useSceneStore = create<SceneStore>((set, get) => ({
  atmosphere: (read(KEY_ATMOSPHERE) as AtmosphereId) || DEFAULT_ATMOSPHERE,
  species: loadSpecies(),
  season: loadSeason(),

  setAtmosphere: (id) => {
    write(KEY_ATMOSPHERE, id);
    set({ atmosphere: id });
  },

  cycleAtmosphere: () => {
    const id = nextAtmosphere(get().atmosphere);
    write(KEY_ATMOSPHERE, id);
    set({ atmosphere: id });
  },

  setSpecies: (choice) => {
    write(KEY_SPECIES, choice);
    set({ species: choice });
  },

  setSeason: (id) => {
    write(KEY_SEASON, id);
    set({ season: id });
  },
}));
