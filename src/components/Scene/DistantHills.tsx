/**
 * GitForest — Morros Distantes
 *
 * Quatro camadas de silhueta de montanha ao redor da cena — o recurso que faz
 * uma paisagem parecer grande sem custar quase nada (o truque clássico do
 * Firewatch). Cada camada é um anel de parede com o topo recortado por ruído
 * "ridged", desbotado em direção à cor do horizonte conforme se afasta.
 *
 * Estas camadas ficam **fora** da neblina (`fog={false}`) de propósito: o
 * desbotamento é assado direto na cor de vértice, o que dá controle artístico
 * total sobre a profundidade em vez de depender de uma curva linear.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { createNoise2D, ridged2D } from '../../world/noise';
import { getAtmosphere } from '../../world/atmosphere';
import { useSceneStore } from '../../store/useSceneStore';

interface HillLayer {
  radius: number;
  /** Altura média da crista */
  base: number;
  /** Variação de altura entre picos e selas */
  amplitude: number;
  /** Escala de amostragem do ruído: menor = picos mais largos */
  noiseScale: number;
  /** Quanto a camada desbota em direção à cor do horizonte (0-1) */
  fade: number;
  segments: number;
}

/**
 * A camada mais próxima (340) fica logo além do alcance da neblina e dentro do
 * alcance da malha do terreno, de modo que nunca há uma fresta entre elas.
 */
const LAYERS: HillLayer[] = [
  { radius: 340, base: 14, amplitude: 17, noiseScale: 2.4, fade: 0.5, segments: 220 },
  { radius: 470, base: 23, amplitude: 25, noiseScale: 3.1, fade: 0.68, segments: 190 },
  { radius: 660, base: 35, amplitude: 35, noiseScale: 3.9, fade: 0.81, segments: 160 },
  { radius: 900, base: 52, amplitude: 47, noiseScale: 4.8, fade: 0.9, segments: 140 },
];

/** As paredes descem bem abaixo do horizonte para nunca revelarem a base. */
const WALL_BOTTOM = -140;

const RIDGE_OPTS = { octaves: 4, lacunarity: 2.1, persistence: 0.5 };

export function DistantHills() {
  const atmosphereId = useSceneStore((s) => s.atmosphere);
  const preset = useMemo(() => getAtmosphere(atmosphereId), [atmosphereId]);

  const layers = useMemo(() => {
    const hillColor = new THREE.Color(preset.hills);
    const horizonColor = new THREE.Color(preset.fog.color);

    return LAYERS.map((layer, layerIndex) => {
      // Seed própria por camada: cordilheiras diferentes, não a mesma repetida
      const noise = createNoise2D(9173 + layerIndex * 731);

      const positions: number[] = [];
      const colors: number[] = [];

      // Cor do topo: a base do morro, já puxada para o horizonte
      const top = hillColor.clone().lerp(horizonColor, layer.fade);
      // Bruma acumula no sopé das montanhas — mais claro embaixo, não mais escuro
      const bottom = top.clone().lerp(horizonColor, 0.4);

      const pushVertex = (
        angle: number,
        y: number,
        color: THREE.Color,
      ) => {
        positions.push(
          Math.cos(angle) * layer.radius,
          y,
          Math.sin(angle) * layer.radius,
        );
        colors.push(color.r, color.g, color.b);
      };

      /**
       * Amostrar o ruído sobre um círculo garante que a crista feche sem
       * emenda ao dar a volta completa.
       */
      const crestAt = (angle: number): number => {
        const s = layer.noiseScale;
        const r = ridged2D(
          noise,
          Math.cos(angle) * s,
          Math.sin(angle) * s,
          RIDGE_OPTS,
        );
        return layer.base + (r - 0.35) * layer.amplitude;
      };

      const step = (Math.PI * 2) / layer.segments;

      for (let i = 0; i < layer.segments; i++) {
        const a0 = i * step;
        const a1 = a0 + step;
        const h0 = crestAt(a0);
        const h1 = crestAt(a1);

        // Dois triângulos formando o quad da parede entre a0 e a1
        pushVertex(a0, h0, top);
        pushVertex(a0, WALL_BOTTOM, bottom);
        pushVertex(a1, h1, top);

        pushVertex(a1, h1, top);
        pushVertex(a0, WALL_BOTTOM, bottom);
        pushVertex(a1, WALL_BOTTOM, bottom);
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geom.computeBoundingSphere();

      return { geom, key: layer.radius };
    });
  }, [preset]);

  return (
    <group>
      {layers.map(({ geom, key }) => (
        <mesh key={key} geometry={geom} frustumCulled={false}>
          <meshBasicMaterial
            vertexColors
            fog={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}
