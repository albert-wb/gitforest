/**
 * GitForest — Sincronia com a URL
 *
 * Um estilo que só o próprio dono enxerga não vale nada. Enquanto não existe
 * backend para guardar a preferência de cada conta (Fase 4), a URL é a única
 * forma de alguém ver *a sua* árvore do jeito que você a montou.
 *
 * Formato: `?u=login&sp=carvalho&season=outono&sky=noite`
 *
 * Na montagem lê os parâmetros e dispara a busca; depois disso reescreve a
 * URL a cada mudança usando `replaceState`, para não encher o histórico do
 * navegador com uma entrada por clique.
 */

import { useEffect, useRef } from 'react';
import { useSceneStore } from '../store/useSceneStore';
import { useTreeStore } from '../store/useTreeStore';
import { isSpeciesId } from '../engine/species';
import { isSeasonId } from '../world/season';
import { ATMOSPHERES, type AtmosphereId } from '../world/atmosphere';

export function useUrlState(): void {
  const username = useTreeStore((s) => s.username);
  const status = useTreeStore((s) => s.status);
  const species = useSceneStore((s) => s.species);
  const season = useSceneStore((s) => s.season);
  const atmosphere = useSceneStore((s) => s.atmosphere);

  const hydrated = useRef(false);

  // Leitura inicial: os parâmetros da URL vencem o que estiver no localStorage
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    const params = new URLSearchParams(window.location.search);

    const sp = params.get('sp');
    if (sp === 'auto' || (sp && isSpeciesId(sp))) {
      useSceneStore.getState().setSpecies(sp);
    }

    const se = params.get('season');
    if (se && isSeasonId(se)) {
      useSceneStore.getState().setSeason(se);
    }

    const sky = params.get('sky');
    if (sky && sky in ATMOSPHERES) {
      useSceneStore.getState().setAtmosphere(sky as AtmosphereId);
    }

    // A busca vai por último: a espécie precisa estar definida antes, senão a
    // árvore nasceria com uma e teria de ser regenerada logo em seguida.
    const user = params.get('u');
    if (user) {
      useTreeStore.getState().fetchAndGenerate(user);
    }
  }, []);

  // Escrita: mantém o endereço em dia sem poluir o histórico
  useEffect(() => {
    if (!hydrated.current) return;

    const params = new URLSearchParams();
    if (username && status === 'ready') params.set('u', username);
    params.set('sp', species);
    params.set('season', season);
    params.set('sky', atmosphere);

    const next = `${window.location.pathname}?${params.toString()}`;
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', next);
    }
  }, [username, status, species, season, atmosphere]);
}
