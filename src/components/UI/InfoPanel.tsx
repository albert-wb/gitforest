/**
 * GitForest — InfoPanel
 *
 * Painel lateral com informações do perfil do GitHub
 * e legenda de cores das linguagens de programação.
 */

import { useState } from 'react';
import { useTreeStore } from '../../store/useTreeStore';
import './InfoPanel.css';

export function InfoPanel() {
  const { treeParams, status } = useTreeStore();
  const [isExpanded, setIsExpanded] = useState(true);

  if (status !== 'ready' || !treeParams) return null;

  const { profile, branches } = treeParams;

  // Agrupar linguagens únicas com suas cores
  const languageMap = new Map<string, { color: string; count: number }>();
  for (const branch of branches) {
    const lang = branch.languageName;
    if (lang && lang !== 'Unknown') {
      const existing = languageMap.get(lang);
      if (existing) {
        existing.count++;
      } else {
        languageMap.set(lang, { color: branch.leafColor, count: 1 });
      }
    }
  }

  const languages = Array.from(languageMap.entries())
    .sort((a, b) => b[1].count - a[1].count);

  return (
    <div className={`info-panel ${isExpanded ? 'expanded' : 'collapsed'}`} id="info-panel">
      <button
        className="info-toggle"
        id="info-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-label={isExpanded ? 'Recolher painel' : 'Expandir painel'}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      {isExpanded && (
        <div className="info-content">
          {/* Avatar e nome */}
          <div className="info-header">
            <img
              src={profile.avatarUrl}
              alt={`Avatar de ${profile.login}`}
              className="info-avatar"
            />
            <div className="info-name-block">
              <h2 className="info-name">{profile.name ?? profile.login}</h2>
              <span className="info-login">@{profile.login}</span>
            </div>
          </div>

          {profile.bio && (
            <p className="info-bio">{profile.bio}</p>
          )}

          {/* Estatísticas */}
          <div className="info-stats">
            <div className="stat-item">
              <span className="stat-value">{profile.totalRepos}</span>
              <span className="stat-label">Repos</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{profile.followers}</span>
              <span className="stat-label">Seguidores</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{profile.following}</span>
              <span className="stat-label">Seguindo</span>
            </div>
          </div>

          {/* Conta criada */}
          <div className="info-meta">
            <span className="meta-icon">🌱</span>
            <span>
              Semente plantada em{' '}
              {new Date(profile.createdAt).toLocaleDateString('pt-BR', {
                year: 'numeric',
                month: 'long',
              })}
            </span>
          </div>

          {/* Legenda de linguagens */}
          {languages.length > 0 && (
            <div className="info-languages">
              <h3 className="info-section-title">Linguagens</h3>
              <div className="language-list">
                {languages.map(([name, { color, count }]) => (
                  <div key={name} className="language-item">
                    <span
                      className="language-dot"
                      style={{ backgroundColor: color }}
                    />
                    <span className="language-name">{name}</span>
                    <span className="language-count">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top repos */}
          <div className="info-repos">
            <h3 className="info-section-title">Galhos Principais</h3>
            <div className="repo-list">
              {branches.slice(0, 8).map((branch) => (
                <div
                  key={branch.name}
                  className={`repo-item ${branch.isDead ? 'dead' : ''}`}
                  id={`repo-${branch.name}`}
                >
                  <span
                    className="repo-color-indicator"
                    style={{ backgroundColor: branch.leafColor }}
                  />
                  <div className="repo-info">
                    <span className="repo-name">{branch.name}</span>
                    <span className="repo-stats-mini">
                      ⭐ {branch.stars} · {branch.commits} commits
                    </span>
                  </div>
                  {branch.isDead && <span className="repo-dead-badge">🍂</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
