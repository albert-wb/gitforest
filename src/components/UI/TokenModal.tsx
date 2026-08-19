/**
 * GitForest — TokenModal
 *
 * Modal para configurar o token do GitHub.
 * Necessário para a GraphQL API funcionar.
 */

import { useState } from 'react';
import { useTreeStore } from '../../store/useTreeStore';
import './TokenModal.css';

interface TokenModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TokenModal({ isOpen, onClose }: TokenModalProps) {
  const { githubToken, setGithubToken } = useTreeStore();
  const [input, setInput] = useState(githubToken);

  if (!isOpen) return null;

  const handleSave = () => {
    setGithubToken(input.trim());
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} id="token-modal">
        <h2 className="modal-title">🔑 Token do GitHub</h2>
        <p className="modal-description">
          A API GraphQL do GitHub requer autenticação.
          Crie um{' '}
          <a
            href="https://github.com/settings/tokens/new?scopes=read:user,repo&description=GitForest"
            target="_blank"
            rel="noopener noreferrer"
          >
            Personal Access Token
          </a>{' '}
          com permissões <code>read:user</code> e <code>repo</code>.
        </p>

        <input
          className="modal-input"
          id="github-token-input"
          type="password"
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoComplete="off"
        />

        <p className="modal-note">
          O token é armazenado apenas no seu navegador (localStorage).
        </p>

        <div className="modal-actions">
          <button className="modal-btn modal-btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="modal-btn modal-btn-primary"
            id="save-token-button"
            onClick={handleSave}
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
