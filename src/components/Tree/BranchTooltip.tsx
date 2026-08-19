/**
 * GitForest — BranchTooltip
 *
 * Tooltip HTML overlay (via drei <Html>) que aparece ao hover
 * sobre um galho, exibindo informações do repositório.
 */

import { Html } from '@react-three/drei';
import type { BranchParams } from '../../engine/types';
import { useInteractionStore } from '../../store/useInteractionStore';

interface BranchTooltipProps {
  branch: BranchParams;
  position: [number, number, number];
}

export function BranchTooltip({ branch, position }: BranchTooltipProps) {
  const hoveredBranchIndex = useInteractionStore((s) => s.hoveredBranchIndex);

  // Só renderiza se o galho está em hover
  if (hoveredBranchIndex < 0) return null;

  return (
    <Html
      position={position}
      center
      distanceFactor={10}
      style={{
        pointerEvents: 'none',
        transition: 'opacity 0.2s ease',
      }}
    >
      <div style={{
        background: 'rgba(10, 10, 25, 0.85)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '10px',
        padding: '10px 14px',
        color: '#e0e0e0',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        fontSize: '12px',
        lineHeight: '1.5',
        minWidth: '160px',
        maxWidth: '220px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        whiteSpace: 'nowrap',
      }}>
        {/* Nome do repo */}
        <div style={{
          fontWeight: 700,
          fontSize: '13px',
          marginBottom: '6px',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: branch.leafColor,
            display: 'inline-block',
            flexShrink: 0,
          }} />
          {branch.name}
        </div>

        {/* Stats */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '3px 12px',
          fontSize: '11px',
          color: '#b0b0b0',
        }}>
          <span>⭐ {branch.stars.toLocaleString()}</span>
          <span>📝 {branch.commits.toLocaleString()}</span>
          <span style={{ gridColumn: '1 / -1', color: branch.leafColor }}>
            {branch.languageName}
          </span>
        </div>

        {/* Indicador de status */}
        {branch.isDead && (
          <div style={{
            marginTop: '4px',
            fontSize: '10px',
            color: '#888',
            fontStyle: 'italic',
          }}>
            💤 Inativo
          </div>
        )}
      </div>
    </Html>
  );
}
