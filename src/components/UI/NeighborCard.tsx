/**
 * GitForest — Cartão do Vizinho
 *
 * Abre ao clicar numa árvore da floresta e mostra de quem ela é.
 *
 * Todos os dados aqui já estavam em memória: são o mesmo perfil reduzido que
 * gerou a árvore, guardado no nó pela store. O cartão não faz nenhuma
 * requisição — clicar numa árvore é instantâneo, e continuaria instantâneo
 * mesmo offline depois da floresta montada.
 *
 * O cartão tem duas saídas, e a distinção importa:
 *
 * - **Ver no GitHub** leva para fora do projeto.
 * - **Explorar esta árvore** recentra a aplicação nessa conta — a árvore dela
 *   vira a protagonista e uma floresta nova cresce em volta, com *as*
 *   conexões *dela*. É a navegação pelo grafo social que dá sentido ao
 *   segundo grau existir: dá para caminhar de conta em conta.
 */

import { useForestStore } from '../../store/useForestStore';
import { useTreeStore } from '../../store/useTreeStore';
import { SPECIES, isSpeciesId } from '../../engine/species';
import './NeighborCard.css';

/** Formata contagens grandes sem virar uma parede de dígitos. */
function compact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function NeighborCard() {
  const selected = useForestStore((s) => s.selected);
  const nodes = useForestStore((s) => s.nodes);
  const select = useForestStore((s) => s.select);
  const fetchAndGenerate = useTreeStore((s) => s.fetchAndGenerate);
  const treeStatus = useTreeStore((s) => s.status);

  const node = nodes.find((n) => n.login === selected);
  if (!node) return null;

  const { profile } = node;
  const species = isSpeciesId(node.mesh.speciesId)
    ? SPECIES[node.mesh.speciesId]
    : null;

  const topRepo = profile.repositories.nodes[0] ?? null;
  const language = topRepo?.primaryLanguage ?? null;
  const contributions =
    profile.contributionsCollection.contributionCalendar.totalContributions;

  const explore = () => {
    select(null);
    void fetchAndGenerate(profile.login);
  };

  return (
    <div className="neighbor-card" id="neighbor-card" role="dialog" aria-label={`Conta de ${profile.login}`}>
      <button
        className="neighbor-card__close"
        onClick={() => select(null)}
        aria-label="Fechar"
      >
        ×
      </button>

      <header className="neighbor-card__head">
        <img
          className="neighbor-card__avatar"
          src={profile.avatarUrl}
          alt={`Avatar de ${profile.login}`}
          width={56}
          height={56}
        />
        <div className="neighbor-card__ident">
          <strong className="neighbor-card__name">
            {profile.name || profile.login}
          </strong>
          <span className="neighbor-card__login">@{profile.login}</span>
          {/* O mesmo cartão serve aos dois modos, e o rótulo tem de dizer a
              verdade em cada um: no modo país as árvores vizinhas não são
              conexões suas, são posições num ranking. */}
          <span className="neighbor-card__degree">
            {node.rank !== undefined
              ? `#${node.rank} no ranking do país`
              : node.degree === 1
                ? 'Conexão direta'
                : 'Conexão de segundo grau'}
          </span>
        </div>
      </header>

      {profile.bio && <p className="neighbor-card__bio">{profile.bio}</p>}

      <dl className="neighbor-card__stats">
        <div>
          <dt>Seguidores</dt>
          <dd>{compact(profile.followers.totalCount)}</dd>
        </div>
        <div>
          <dt>Repositórios</dt>
          <dd>{compact(profile.repositories.totalCount)}</dd>
        </div>
        <div>
          <dt>Contribuições</dt>
          <dd>{compact(contributions)}</dd>
        </div>
      </dl>

      {/* Fecha o laço entre o dado e o que se vê na cena: a árvore não é uma
          ilustração genérica, ela é esta conta. */}
      <p className="neighbor-card__tree">
        {species && (
          <>
            <span aria-hidden="true">{species.icone}</span> {species.nome}
          </>
        )}
        {language && (
          <>
            {' · '}
            <span
              className="neighbor-card__lang-dot"
              style={{ background: language.color ?? '#8b949e' }}
            />
            {language.name}
          </>
        )}
      </p>

      <div className="neighbor-card__actions">
        <button
          className="neighbor-card__explore"
          onClick={explore}
          disabled={treeStatus === 'loading'}
        >
          🌱 Explorar esta árvore
        </button>
        <a
          className="neighbor-card__link"
          href={`https://github.com/${profile.login}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Ver no GitHub ↗
        </a>
      </div>
    </div>
  );
}
