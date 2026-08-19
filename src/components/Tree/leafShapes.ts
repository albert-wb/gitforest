/**
 * GitForest — Contornos de Folha
 *
 * Um contorno low-poly por espécie, compartilhado entre a árvore em foco e o
 * renderizador da floresta.
 *
 * Vive num módulo próprio, e não dentro de `Leaves.tsx`, porque o Fast
 * Refresh do React só funciona em arquivos que exportam exclusivamente
 * componentes — misturar uma fábrica de geometria ali quebraria o hot reload
 * de toda a árvore de componentes.
 */

import * as THREE from 'three';
import type { LeafShape } from '../../engine/species';

/**
 * Todos os contornos cabem aproximadamente numa caixa de 0.3 × 0.3, para que
 * `leafScale` signifique a mesma coisa entre espécies.
 */
function createLeafShape(shape: LeafShape): THREE.Shape {
  const s = new THREE.Shape();

  switch (shape) {
    case 'agulha':
      // Fina e comprida: conífera e salgueiro
      s.moveTo(0, 0.2);
      s.lineTo(0.022, 0.02);
      s.lineTo(0.014, -0.18);
      s.lineTo(-0.014, -0.18);
      s.lineTo(-0.022, 0.02);
      s.closePath();
      break;

    case 'oval':
      s.moveTo(0, 0.16);
      s.bezierCurveTo(0.1, 0.1, 0.1, -0.06, 0, -0.16);
      s.bezierCurveTo(-0.1, -0.06, -0.1, 0.1, 0, 0.16);
      break;

    case 'coracao':
      s.moveTo(0, -0.16);
      s.bezierCurveTo(0.16, -0.02, 0.12, 0.16, 0, 0.09);
      s.bezierCurveTo(-0.12, 0.16, -0.16, -0.02, 0, -0.16);
      break;

    case 'bordo':
      // Cinco lobos simplificados
      s.moveTo(0, 0.18);
      s.lineTo(0.06, 0.06);
      s.lineTo(0.15, 0.09);
      s.lineTo(0.09, -0.02);
      s.lineTo(0.16, -0.11);
      s.lineTo(0.05, -0.09);
      s.lineTo(0, -0.18);
      s.lineTo(-0.05, -0.09);
      s.lineTo(-0.16, -0.11);
      s.lineTo(-0.09, -0.02);
      s.lineTo(-0.15, 0.09);
      s.lineTo(-0.06, 0.06);
      s.closePath();
      break;

    case 'petala':
      s.moveTo(0, 0.15);
      s.bezierCurveTo(0.11, 0.09, 0.09, -0.08, 0, -0.13);
      s.bezierCurveTo(-0.09, -0.08, -0.11, 0.09, 0, 0.15);
      break;

    case 'losango':
    default:
      s.moveTo(0, 0.15);
      s.lineTo(0.08, 0);
      s.lineTo(0, -0.15);
      s.lineTo(-0.08, 0);
      s.closePath();
      break;
  }

  return s;
}

function createLeafGeometry(shape: LeafShape): THREE.BufferGeometry {
  // Contornos de bezier precisam de subdivisão suficiente para ler como
  // curva. Com 2 segmentos, uma folha oval saía serrilhada — parecia bordo.
  const curveSegments = shape === 'agulha' || shape === 'losango' ? 1 : 5;
  return new THREE.ShapeGeometry(createLeafShape(shape), curveSegments);
}

/**
 * Cache por formato. São seis geometrias minúsculas e imutáveis; recriá-las
 * por árvore seria desperdício puro.
 */
const cache = new Map<LeafShape, THREE.BufferGeometry>();

export function getLeafGeometry(shape: LeafShape): THREE.BufferGeometry {
  let geom = cache.get(shape);
  if (!geom) {
    geom = createLeafGeometry(shape);
    cache.set(shape, geom);
  }
  return geom;
}
