/**
 * GitForest — Roots (Raízes)
 *
 * Renderiza as raízes da árvore como segmentos low-poly
 * que se espalham pela base. Similares aos galhos mas
 * com visual mais escuro e terroso.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import type { TreeSegment } from '../../engine/types';

interface RootsProps {
  segments: TreeSegment[];
}

const ROOT_COLOR = new THREE.Color('#3a2515');
const RADIAL_SEGMENTS = 4; // Ainda mais low-poly que os galhos

export function Roots({ segments }: RootsProps) {
  const mergedGeometry = useMemo(() => {
    if (segments.length === 0) return null;

    const geometries: THREE.BufferGeometry[] = [];

    for (const seg of segments) {
      const dx = seg.end[0] - seg.start[0];
      const dy = seg.end[1] - seg.start[1];
      const dz = seg.end[2] - seg.start[2];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (length < 0.001) continue;

      const geom = new THREE.CylinderGeometry(
        seg.endRadius,
        seg.startRadius,
        length,
        RADIAL_SEGMENTS,
        1,
        false,
      );

      const midpoint = new THREE.Vector3(
        (seg.start[0] + seg.end[0]) / 2,
        (seg.start[1] + seg.end[1]) / 2,
        (seg.start[2] + seg.end[2]) / 2,
      );

      const direction = new THREE.Vector3(dx, dy, dz).normalize();
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);

      const matrix = new THREE.Matrix4();
      matrix.compose(midpoint, quaternion, new THREE.Vector3(1, 1, 1));
      geom.applyMatrix4(matrix);

      geometries.push(geom);
    }

    if (geometries.length === 0) return null;

    // Merge manual
    let totalVerts = 0;
    for (const g of geometries) {
      totalVerts += g.attributes.position.count;
    }

    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const indices: number[] = [];
    let posOff = 0;
    let vertOff = 0;

    for (const g of geometries) {
      const p = g.attributes.position;
      const n = g.attributes.normal;

      for (let i = 0; i < p.count * 3; i++) {
        positions[posOff + i] = p.array[i];
        if (n) normals[posOff + i] = n.array[i];
      }

      if (g.index) {
        for (let i = 0; i < g.index.count; i++) {
          indices.push(g.index.array[i] + vertOff);
        }
      }

      vertOff += p.count;
      posOff += p.count * 3;
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    if (indices.length > 0) merged.setIndex(indices);

    geometries.forEach((g) => g.dispose());

    return merged;
  }, [segments]);

  if (!mergedGeometry) return null;

  return (
    <mesh geometry={mergedGeometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={ROOT_COLOR}
        flatShading
        roughness={0.9}
        metalness={0.0}
      />
    </mesh>
  );
}
