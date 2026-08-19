/**
 * GitForest — SearchBar
 *
 * Barra de busca central para inserir o username do GitHub.
 * Estilo glassmorphism com animações suaves.
 */

import { useState, type FormEvent } from 'react';
import { useTreeStore } from '../../store/useTreeStore';
import './SearchBar.css';

export function SearchBar() {
  const [input, setInput] = useState('');
  const { fetchAndGenerate, status } = useTreeStore();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (trimmed && status !== 'loading') {
      fetchAndGenerate(trimmed);
    }
  };

  return (
    <div className="search-container" id="search-container">
      <form className="search-form" onSubmit={handleSubmit}>
        <div className="search-input-wrapper">
          <svg
            className="search-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            id="github-username-input"
            className="search-input"
            type="text"
            placeholder="Digite um username do GitHub..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={status === 'loading'}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            id="search-button"
            className="search-button"
            type="submit"
            disabled={status === 'loading' || !input.trim()}
          >
            {status === 'loading' ? (
              <span className="spinner" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
