/**
 * GitForest — Florestas por País
 *
 * Planta a floresta do ranking de contribuidores públicos de um país.
 *
 * É o único modo que não depende de você conhecer alguém no GitHub: em vez de
 * partir de uma conta e seguir as conexões, parte de um lugar. Para quem abre
 * o projeto pela primeira vez, é o caminho mais curto até uma floresta cheia.
 *
 * A lista de países é local (ver `api/topUsers`), então a gaveta abre
 * instantaneamente e sem rede. Só a escolha de um país é que baixa alguma
 * coisa — e o que baixa é um arquivo só.
 */

import { useMemo, useState } from "react";
import { useForestStore } from "../../store/useForestStore";
import { useTreeStore } from "../../store/useTreeStore";
import { listCountries } from "../../api/topUsers";
import "./CountryPanel.css";

export function CountryPanel() {
  const token = useTreeStore((s) => s.githubToken);
  const growCountry = useForestStore((s) => s.growCountry);
  const country = useForestStore((s) => s.country);
  const mode = useForestStore((s) => s.mode);
  const status = useForestStore((s) => s.status);
  const grown = useForestStore((s) => s.grown);
  const discovered = useForestStore((s) => s.discovered);
  const error = useForestStore((s) => s.error);
  const clearForest = useForestStore((s) => s.clearForest);

  const [aberto, setAberto] = useState(false);
  const [filtro, setFiltro] = useState("");

  const paises = useMemo(() => listCountries(), []);

  const visiveis = useMemo(() => {
    const termo = filtro.trim().toLowerCase();
    if (!termo) return paises;
    return paises.filter((p) => p.nome.toLowerCase().includes(termo));
  }, [paises, filtro]);

  const emPais = mode === "pais" && country;

  return (
    <>
      <button
        className="country-button"
        id="country-button"
        onClick={() => setAberto((v) => !v)}
        title="Florestas por país"
        aria-label="Abrir florestas por país"
        aria-expanded={aberto}
      >
        🌍
      </button>

      {emPais && (
        <div className="country-status" id="country-status">
          <strong>{country.nome}</strong>
          <span className="country-status__line">
            {status === "discovering" && "Lendo o ranking…"}
            {status === "growing" && `${grown} árvores por perto`}
            {status === "ready" && `${grown} árvores por perto`}
            {status === "error" && <span className="is-error">{error}</span>}
          </span>
          {status !== "error" && (
            <span className="country-status__hint">
              {discovered} contas no ranking · arraste com o botão direito para
              caminhar pela floresta
            </span>
          )}
          <button className="country-status__clear" onClick={clearForest}>
            Sair do país
          </button>
        </div>
      )}

      {aberto && (
        <div className="country-picker" id="country-picker">
          <header className="country-picker__head">
            <strong>Floresta de um país</strong>
            <button
              className="country-picker__close"
              onClick={() => setAberto(false)}
              aria-label="Fechar"
            >
              ×
            </button>
          </header>

          <p className="country-picker__about">
            Top contribuidores públicos, segundo a lista aberta de{" "}
            <a
              href="https://github.com/gayanvoice/top-github-users"
              target="_blank"
              rel="noopener noreferrer"
            >
              gayanvoice/top-github-users
            </a>
            .
          </p>

          <input
            className="country-picker__search"
            type="text"
            placeholder="Filtrar país…"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            autoComplete="off"
          />

          <ul className="country-picker__list">
            {visiveis.map((p) => (
              <li key={p.slug}>
                <button
                  className={
                    country?.slug === p.slug
                      ? "country-picker__item is-current"
                      : "country-picker__item"
                  }
                  onClick={() => {
                    setAberto(false);
                    void growCountry(p, token || undefined);
                  }}
                >
                  {p.nome}
                </button>
              </li>
            ))}
            {visiveis.length === 0 && (
              <li className="country-picker__empty">Nenhum país encontrado</li>
            )}
          </ul>
        </div>
      )}
    </>
  );
}
