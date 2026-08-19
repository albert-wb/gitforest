/**
 * GitForest — Controle da Floresta
 *
 * Acompanha o crescimento da floresta em volta do usuário em foco.
 *
 * A floresta **não** é mais disparada daqui: ela cresce junto com a busca
 * (ver `useTreeStore.fetchAndGenerate`). Este painel deixou de ser o gatilho
 * e virou o relatório — quantas árvores nasceram, por qual critério de
 * amizade, e o que o GitHub deixou de entregar. O botão só reaparece depois
 * de "Limpar floresta", para quem quiser a árvore sozinha e depois mudar de
 * ideia.
 *
 * Este é o modo que funciona **sem login**: ele lê conexões públicas do perfil
 * pesquisado. A floresta pessoal ("a minha floresta") depende de OAuth e fica
 * para a Fase 4 — mas toda a arquitetura de N árvores é a mesma, e é
 * justamente isso que este modo existe para provar antes de investir num
 * backend.
 */

import { useTreeStore } from '../../store/useTreeStore';
import { useForestStore } from '../../store/useForestStore';
import './ForestPanel.css';

export function ForestPanel() {
  const username = useTreeStore((s) => s.username);
  const treeStatus = useTreeStore((s) => s.status);
  const token = useTreeStore((s) => s.githubToken);

  const status = useForestStore((s) => s.status);
  const mode = useForestStore((s) => s.mode);
  const root = useForestStore((s) => s.root);
  const discovered = useForestStore((s) => s.discovered);
  const grown = useForestStore((s) => s.grown);
  const failedBatches = useForestStore((s) => s.failedBatches);
  const error = useForestStore((s) => s.error);
  const growForest = useForestStore((s) => s.growForest);
  const clearForest = useForestStore((s) => s.clearForest);

  // Só faz sentido depois que existe uma árvore central
  if (treeStatus !== 'ready' || !username) return null;
  // No modo país quem informa é o `CountryPanel`; os dois juntos brigariam
  // pelo mesmo canto da tela dizendo coisas diferentes.
  if (mode === 'pais') return null;

  const isThisForest = root === username;
  const busy = status === 'discovering' || status === 'growing';

  return (
    <div className="forest-panel" id="forest-panel">
      {!isThisForest && (
        <button
          className="forest-panel__action"
          onClick={() => growForest(username, token || undefined)}
          disabled={busy}
        >
          🌲 Replantar a floresta de {username}
        </button>
      )}

      {isThisForest && (
        <div className="forest-panel__status">
          <div className="forest-panel__line">
            {status === 'discovering' && 'Procurando conexões…'}
            {status === 'growing' &&
              `Plantando ${grown} de ${discovered} árvores…`}
            {status === 'ready' && (
              <>
                <strong>{grown}</strong> árvores ao redor de {root}
                {failedBatches > 0 && (
                  <span className="forest-panel__warn">
                    {' '}
                    · {failedBatches} lote{failedBatches > 1 ? 's' : ''} não
                    respondeu
                  </span>
                )}
              </>
            )}
            {status === 'error' && <span className="is-error">{error}</span>}
          </div>

          {mode && status !== 'error' && (
            <p className="forest-panel__hint">
              {mode === 'mutuos'
                ? 'Conexões por follow mútuo — a definição honesta de amizade no GitHub.'
                : 'Poucos mútuos detectáveis sem login; usando quem esta conta segue.'}
            </p>
          )}

          <button className="forest-panel__clear" onClick={clearForest}>
            Limpar floresta
          </button>
        </div>
      )}
    </div>
  );
}
