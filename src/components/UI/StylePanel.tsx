/**
 * GitForest — Painel de Estilo
 *
 * Fica à direita para equilibrar o `InfoPanel`, que ocupa a esquerda.
 *
 * A opção **Automático** é a primeira de propósito: ela deriva a espécie da
 * seed do usuário, o que garante variedade entre perfis sem exigir escolha de
 * ninguém — e é o comportamento que fará a floresta da Fase 3 nascer diversa
 * mesmo antes de existir login para guardar a preferência de cada dono.
 */

import { useState } from 'react';
import { useSceneStore } from '../../store/useSceneStore';
import { useTreeStore } from '../../store/useTreeStore';
import {
  SPECIES,
  SPECIES_ORDER,
  speciesForSeed,
  type SpeciesChoice,
} from '../../engine/species';
import { SEASONS, SEASON_ORDER } from '../../world/season';
import { ATMOSPHERES, ATMOSPHERE_ORDER } from '../../world/atmosphere';
import './StylePanel.css';

export function StylePanel() {
  const [open, setOpen] = useState(false);

  const species = useSceneStore((s) => s.species);
  const season = useSceneStore((s) => s.season);
  const atmosphere = useSceneStore((s) => s.atmosphere);
  const setSpecies = useSceneStore((s) => s.setSpecies);
  const setSeason = useSceneStore((s) => s.setSeason);
  const setAtmosphere = useSceneStore((s) => s.setAtmosphere);

  const treeParams = useTreeStore((s) => s.treeParams);

  // Qual espécie o "Automático" resolveria para este usuário
  const autoSpecies = treeParams ? SPECIES[speciesForSeed(treeParams.seed)] : null;

  const choose = (choice: SpeciesChoice) => setSpecies(choice);

  return (
    <>
      <button
        className={`style-toggle ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Estilo da árvore"
        aria-label="Abrir painel de estilo da árvore"
        aria-expanded={open}
      >
        🌿
      </button>

      <aside className={`style-panel ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        <header className="style-panel__header">
          <h2 className="style-panel__title">Estilo</h2>
          <button
            className="style-panel__close"
            onClick={() => setOpen(false)}
            aria-label="Fechar painel de estilo"
          >
            ×
          </button>
        </header>

        <section className="style-section">
          <h3 className="style-section__title">Espécie</h3>
          <p className="style-section__hint">
            Os dados do GitHub continuam definindo tamanho e cor. A espécie
            muda a forma.
          </p>

          <div className="style-grid">
            <button
              className={`style-card ${species === 'auto' ? 'is-active' : ''}`}
              onClick={() => choose('auto')}
            >
              <span className="style-card__icon">🎲</span>
              <span className="style-card__name">Automático</span>
              <span className="style-card__desc">
                {autoSpecies
                  ? `Derivada do perfil: ${autoSpecies.nome}`
                  : 'Derivada do perfil'}
              </span>
            </button>

            {SPECIES_ORDER.map((id) => {
              const s = SPECIES[id];
              return (
                <button
                  key={id}
                  className={`style-card ${species === id ? 'is-active' : ''}`}
                  onClick={() => choose(id)}
                >
                  <span className="style-card__icon">{s.icone}</span>
                  <span className="style-card__name">{s.nome}</span>
                  <span className="style-card__desc">{s.descricao}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="style-section">
          <h3 className="style-section__title">Estação</h3>
          <div className="style-chips">
            {SEASON_ORDER.map((id) => (
              <button
                key={id}
                className={`style-chip ${season === id ? 'is-active' : ''}`}
                onClick={() => setSeason(id)}
              >
                <span aria-hidden="true">{SEASONS[id].icone}</span>
                {SEASONS[id].nome}
              </button>
            ))}
          </div>
        </section>

        <section className="style-section">
          <h3 className="style-section__title">Hora do dia</h3>
          <div className="style-chips">
            {ATMOSPHERE_ORDER.map((id) => (
              <button
                key={id}
                className={`style-chip ${atmosphere === id ? 'is-active' : ''}`}
                onClick={() => setAtmosphere(id)}
              >
                <span aria-hidden="true">{ATMOSPHERES[id].icone}</span>
                {ATMOSPHERES[id].nome}
              </button>
            ))}
          </div>
        </section>

        <p className="style-panel__footer">
          Suas escolhas ficam no endereço da página — copie a URL para
          compartilhar exatamente esta árvore.
        </p>
      </aside>
    </>
  );
}
