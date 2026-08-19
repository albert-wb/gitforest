/**
 * GitForest — ErrorToast
 *
 * Toast de erro exibido quando a busca falha.
 */

import { useTreeStore } from '../../store/useTreeStore';
import './ErrorToast.css';

export function ErrorToast() {
  const { status, error, reset } = useTreeStore();

  if (status !== 'error' || !error) return null;

  return (
    <div className="error-toast" id="error-toast">
      <div className="error-toast-icon">⚠️</div>
      <div className="error-toast-content">
        <p className="error-toast-message">{error}</p>
      </div>
      <button
        className="error-toast-close"
        onClick={reset}
        aria-label="Fechar erro"
      >
        ✕
      </button>
    </div>
  );
}
