/**
 * GitForest — Terreno e Horizonte
 *
 * `TerrainMesh` é a malha facetada detalhada, colorida por vértice (altitude,
 * declive e curvatura) — sem uma única textura.
 *
 * `HorizonRing` é o truque que fecha a paisagem: um anel plano que começa
 * *além* do alcance da neblina e vai até quase o plano de corte da câmera.
 * Como tudo depois de `fog.far` é exatamente a cor da neblina, o anel e a
 * borda da malha detalhada se tornam indistinguíveis, e o terreno parece não
 * ter fim. Sem ele, a borda quadrada do plano ficaria visível nas diagonais.
 */

import { useMemo } from 'react';
import { getTerrain } from '../../world/terrain';
import { getAtmosphere } from '../../world/atmosphere';
import { useSceneStore } from '../../store/useSceneStore';

/**
 * Precisa ser maior que o maior `fog.far` de qualquer preset e menor que
 * `TerrainConfig.size / 2`, para haver sobreposição com a malha detalhada.
 */
const HORIZON_RING_INNER = 300;
const HORIZON_RING_OUTER = 1300;

export function TerrainMesh() {
  const terrain = getTerrain();

  // Construção pesada (~centenas de milhares de avaliações de ruído), mas o
  // resultado é cacheado dentro do próprio terreno — roda uma vez por sessão.
  const geometry = useMemo(() => terrain.buildGeometry(), [terrain]);

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        vertexColors
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
}

export function HorizonRing() {
  const atmosphereId = useSceneStore((s) => s.atmosphere);
  const preset = useMemo(() => getAtmosphere(atmosphereId), [atmosphereId]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]}>
      <ringGeometry args={[HORIZON_RING_INNER, HORIZON_RING_OUTER, 72, 1]} />
      {/* `fog={false}` + a própria cor da neblina = casamento exato com a
          borda 100% enevoada da malha detalhada. */}
      <meshBasicMaterial color={preset.fog.color} fog={false} />
    </mesh>
  );
}
