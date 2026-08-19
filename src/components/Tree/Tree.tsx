/**
 * GitForest — Componente Tree (Árvore Completa) v3.0
 *
 * Renderiza a árvore 3D a partir da geometria gerada pelo motor L-System.
 *
 * A animação de crescimento passou a viver aqui dentro, num `useRef` dirigido
 * por `useFrame`. Antes ela era um `useState` no App atualizado a cada quadro,
 * o que disparava cerca de 180 re-renderizações do React em três segundos —
 * cada uma propagando por tronco, galhos, folhas, raízes e hitboxes. Com uma
 * árvore isso passava despercebido; com uma floresta seria fatal, e a correção
 * precisa estar de pé antes da Fase 3.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TreeGeometry, TreeParams } from '../../engine/types';
import type { SpeciesProfile } from '../../engine/species';
import type { SeasonProfile } from '../../world/season';
import { easeOutBack } from '../../utils/easing';
import { Branches } from './Branches';
import { Leaves } from './Leaves';
import { Roots } from './Roots';
import { BranchHitboxes } from './BranchHitboxes';

interface TreeProps {
  geometry: TreeGeometry;
  params: TreeParams;
  species: SpeciesProfile;
  season: SeasonProfile;
}

/** Duração da animação de crescimento, em segundos. */
const GROWTH_DURATION = 3;

export function Tree({ geometry, params, species, season }: TreeProps) {
  const groupRef = useRef<THREE.Group>(null);

  /**
   * Progresso 0→1 do crescimento. É um ref, não estado: os componentes filhos
   * leem o valor dentro dos próprios `useFrame`, sem passar pelo React.
   */
  const growthRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);

  // Nova geometria (outro usuário) = a árvore cresce de novo do zero
  useEffect(() => {
    growthRef.current = 0;
    startedAtRef.current = null;
  }, [geometry]);

  useFrame((state) => {
    const now = state.clock.getElapsedTime();
    if (startedAtRef.current === null) startedAtRef.current = now;

    const t = Math.min((now - startedAtRef.current) / GROWTH_DURATION, 1);
    // Ease-out back ultrapassa 1 e volta — o "pop" cinematográfico do brotar
    growthRef.current = Math.max(0, easeOutBack(t));

    const group = groupRef.current;
    if (!group) return;

    group.scale.setScalar(growthRef.current);

    // Balanço lento e contínuo, independente do crescimento
    group.rotation.z = Math.sin(now * 0.3) * 0.005;
    group.rotation.x = Math.cos(now * 0.2) * 0.003;
  });

  const { trunkSegments, branchSegments } = useMemo(() => {
    const trunk = geometry.segments.filter((s) => s.branchIndex === -1);
    const branches = geometry.segments.filter((s) => s.branchIndex >= 0);
    return { trunkSegments: trunk, branchSegments: branches };
  }, [geometry.segments]);

  return (
    <group ref={groupRef}>
      <Branches segments={trunkSegments} isTrunk species={species} />
      <Branches segments={branchSegments} isTrunk={false} species={species} />
      <Leaves
        leaves={geometry.leaves}
        species={species}
        season={season}
        growthRef={growthRef}
      />
      <Roots segments={geometry.roots} />
      <BranchHitboxes segments={geometry.segments} params={params} />
    </group>
  );
}
