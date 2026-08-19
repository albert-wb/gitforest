/**
 * GitForest — LoadingScreen
 *
 * Tela de carregamento com animação temática de semente crescendo.
 */

import { useTreeStore } from '../../store/useTreeStore';
import './LoadingScreen.css';

export function LoadingScreen() {
  const { status, username } = useTreeStore();

  if (status !== 'loading') return null;

  return (
    <div className="loading-overlay" id="loading-screen">
      <div className="loading-content">
        <div className="seed-animation">
          <div className="seed" />
          <div className="sprout" />
          <div className="leaf-left" />
          <div className="leaf-right" />
        </div>
        <p className="loading-text">
          Plantando a árvore de <strong>@{username}</strong>...
        </p>
        <p className="loading-subtext">Buscando dados do GitHub</p>
      </div>
    </div>
  );
}
