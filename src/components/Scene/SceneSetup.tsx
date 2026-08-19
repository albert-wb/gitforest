/**
 * GitForest — Iluminação e Atmosfera da Cena
 *
 * Todas as luzes, a neblina e o pós-processamento saem do mesmo preset que
 * pinta o céu (`world/atmosphere.ts`). Antes essas cores viviam separadas, e o
 * resultado era uma neblina roxa desbotando geometria contra um horizonte
 * laranja — um erro invisível enquanto a cena era só uma árvore num disco.
 *
 * O `<Environment preset="sunset">` foi removido: ele baixava um HDRI de um
 * CDN em tempo de execução (custo no primeiro carregamento, e falha sem rede)
 * para produzir um ambiente que uma `hemisphereLight` entrega de graça — e que
 * é exatamente o modelo certo para uma cena ao ar livre, com a cor do céu
 * vindo de cima e a cor do solo rebatendo de baixo.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { getAtmosphere, SUN_DISTANCE } from '../../world/atmosphere';
import { useSceneStore } from '../../store/useSceneStore';

/**
 * Metade da largura da caixa ortográfica de sombra.
 * Cobre a árvore e a clareira ao redor com folga; a paisagem distante não
 * recebe sombra projetada, e a esta escala ninguém nota.
 */
const SHADOW_EXTENT = 30;
const SHADOW_MAP_SIZE = 2048;

function scaleDirection(
  direction: [number, number, number],
  distance: number,
): [number, number, number] {
  const v = new THREE.Vector3(...direction).normalize().multiplyScalar(distance);
  return [v.x, v.y, v.z];
}

export function SceneSetup() {
  const atmosphereId = useSceneStore((s) => s.atmosphere);
  const preset = useMemo(() => getAtmosphere(atmosphereId), [atmosphereId]);

  const sunPosition = useMemo(
    () => scaleDirection(preset.sun.direction, SUN_DISTANCE),
    [preset],
  );
  const fillPosition = useMemo(
    () => scaleDirection(preset.fill.direction, SUN_DISTANCE * 0.7),
    [preset],
  );

  return (
    <>
      {/* Ambiente ao ar livre: céu por cima, solo rebatendo por baixo */}
      <hemisphereLight
        args={[
          preset.hemisphere.sky,
          preset.hemisphere.ground,
          preset.hemisphere.intensity,
        ]}
      />

      {/* Luz principal (sol ou lua) — a única que projeta sombra */}
      <directionalLight
        position={sunPosition}
        intensity={preset.sun.intensity}
        color={preset.sun.color}
        castShadow
        shadow-mapSize-width={SHADOW_MAP_SIZE}
        shadow-mapSize-height={SHADOW_MAP_SIZE}
        shadow-camera-near={1}
        shadow-camera-far={SUN_DISTANCE * 2.5}
        shadow-camera-left={-SHADOW_EXTENT}
        shadow-camera-right={SHADOW_EXTENT}
        shadow-camera-top={SHADOW_EXTENT}
        shadow-camera-bottom={-SHADOW_EXTENT}
        // Sem estes dois, uma caixa desta largura produz acne de sombra
        // por toda a encosta do terreno.
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />

      {/* Preenchimento frio do lado oposto, para o contraluz não fechar */}
      <directionalLight
        position={fillPosition}
        intensity={preset.fill.intensity}
        color={preset.fill.color}
      />

      {/* A cor daqui é a mesma que fecha o horizonte (ver HorizonRing) */}
      <fog
        attach="fog"
        args={[preset.fog.color, preset.fog.near, preset.fog.far]}
      />

      <EffectComposer>
        <Bloom
          intensity={preset.bloom.intensity}
          luminanceThreshold={preset.bloom.threshold}
          luminanceSmoothing={0.9}
          mipmapBlur
        />
        <Vignette offset={0.3} darkness={0.55} />
      </EffectComposer>
    </>
  );
}
