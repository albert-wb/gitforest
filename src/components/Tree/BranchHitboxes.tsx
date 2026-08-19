/**
 * GitForest — BranchHitboxes
 *
 * Camada invisível de hitboxes para raycasting.
 * Cada hitbox corresponde a um repositório (grupo de segmentos
 * com o mesmo branchIndex). Hover/click dispara tooltip e highlights.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import type { TreeSegment, TreeParams } from '../../engine/types';
import { useInteractionStore } from '../../store/useInteractionStore';
import { BranchTooltip } from './BranchTooltip';

interface BranchHitboxesProps {
  segments: TreeSegment[];
  params: TreeParams;
}

/** Dados agrupados de cada galho (repositório) */
interface BranchGroup {
  branchIndex: number;
  center: [number, number, number];
  tip: [number, number, number];
  totalLength: number;
  avgRadius: number;
}

export function BranchHitboxes({ segments, params }: BranchHitboxesProps) {
  const { hoveredBranchIndex, setHoveredBranch, clearHover } = useInteractionStore();

  // Agrupar segmentos por branchIndex e calcular centro/tip
  const branchGroups = useMemo(() => {
    const groups: Map<number, { points: THREE.Vector3[]; radii: number[] }> = new Map();

    for (const seg of segments) {
      if (seg.branchIndex < 0) continue; // pular tronco

      if (!groups.has(seg.branchIndex)) {
        groups.set(seg.branchIndex, { points: [], radii: [] });
      }
      const g = groups.get(seg.branchIndex)!;
      g.points.push(new THREE.Vector3(seg.start[0], seg.start[1], seg.start[2]));
      g.points.push(new THREE.Vector3(seg.end[0], seg.end[1], seg.end[2]));
      g.radii.push(seg.startRadius, seg.endRadius);
    }

    const result: BranchGroup[] = [];
    for (const [idx, g] of groups) {
      if (g.points.length === 0) continue;

      // Calcular bounding center
      const center = new THREE.Vector3();
      for (const p of g.points) center.add(p);
      center.divideScalar(g.points.length);

      // Ponto mais distante do tronco (tip do galho)
      let maxDist = 0;
      let tip = g.points[0];
      for (const p of g.points) {
        const d = p.distanceTo(new THREE.Vector3(0, p.y, 0));
        if (d > maxDist) {
          maxDist = d;
          tip = p;
        }
      }

      // Comprimento total aproximado
      let totalLen = 0;
      for (let i = 0; i < g.points.length - 1; i += 2) {
        totalLen += g.points[i].distanceTo(g.points[i + 1]);
      }

      const avgRad = g.radii.reduce((a, b) => a + b, 0) / g.radii.length;

      result.push({
        branchIndex: idx,
        center: [center.x, center.y, center.z],
        tip: [tip.x, tip.y, tip.z],
        totalLength: totalLen,
        avgRadius: avgRad,
      });
    }

    return result;
  }, [segments]);

  return (
    <group>
      {branchGroups.map((bg) => {
        const branch = params.branches[bg.branchIndex];
        if (!branch) return null;

        const isHovered = hoveredBranchIndex === bg.branchIndex;

        // Hitbox: esfera invisível no centro do galho
        const hitboxRadius = Math.max(bg.totalLength * 0.3, 0.4);

        return (
          <group key={bg.branchIndex}>
            {/* Hitbox invisível para raycasting */}
            <mesh
              position={bg.center}
              onPointerEnter={(e) => {
                e.stopPropagation();
                setHoveredBranch(bg.branchIndex, branch.name, 'scene');
                document.body.style.cursor = 'pointer';
              }}
              onPointerLeave={() => {
                clearHover();
                document.body.style.cursor = 'default';
              }}
              onClick={(e) => {
                e.stopPropagation();
                // Abrir repositório no GitHub
                const url = `https://github.com/${params.profile.login}/${branch.name}`;
                window.open(url, '_blank', 'noopener');
              }}
            >
              <sphereGeometry args={[hitboxRadius, 6, 6]} />
              <meshBasicMaterial
                transparent
                opacity={0}
                depthWrite={false}
              />
            </mesh>

            {/* Glow highlight quando hover */}
            {isHovered && (
              <pointLight
                position={bg.center}
                color={branch.leafColor}
                intensity={2.0}
                distance={3}
                decay={2}
              />
            )}

            {/* Tooltip sobre a ponta do galho */}
            {isHovered && (
              <BranchTooltip
                branch={branch}
                position={[bg.tip[0], bg.tip[1] + 0.5, bg.tip[2]]}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}
