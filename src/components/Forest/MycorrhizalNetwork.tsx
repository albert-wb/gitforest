/**
 * GitForest — Rede Micorrízica
 *
 * Florestas de verdade ligam suas árvores por redes de fungos que trocam
 * água, carbono e sinais químicos entre indivíduos — o *wood wide web*. É a
 * metáfora exata do que este projeto quer mostrar, e aqui ela resolve três
 * problemas de uma vez:
 *
 * 1. **Torna as raízes visíveis.** Até a Fase 1 a feature inteira renderizava
 *    enterrada sob um chão opaco. Agora a rede sobe à superfície e o
 *    enraizamento finalmente se vê.
 * 2. **Dá forma ao grafo social** sem poluir a cena com linhas abstratas
 *    flutuando no ar.
 * 3. **Mostra atividade**: pulsos de luz viajam da raiz para as folhas da
 *    rede, sugerindo troca entre as contas conectadas.
 *
 * Cada aresta vira uma fita que acompanha o relevo — por isso ela consulta o
 * mesmo `heightAt()` do terreno, e não uma linha reta no ar.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useForestStore } from '../../store/useForestStore';
import { useSceneStore } from '../../store/useSceneStore';
import { getTerrain } from '../../world/terrain';
import { getAtmosphere } from '../../world/atmosphere';

/** Amostras por aresta. Mais que isto não melhora a aderência ao relevo. */
const SAMPLES = 26;
/** Largura da fita, em unidades de mundo. */
const RIBBON_WIDTH = 0.32;
/** Levantada da superfície, para não brigar em z com o terreno. */
const SURFACE_LIFT = 0.07;

const vertexShader = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>

  attribute float aPathT;
  attribute float aEdgeSeed;
  attribute float aStrength;

  varying float vPathT;
  varying float vEdgeSeed;
  varying float vStrength;
  varying float vEdge;

  void main() {
    vPathT = aPathT;
    vEdgeSeed = aEdgeSeed;
    vStrength = aStrength;
    // uv.x guarda de que lado da fita o vertice esta (0 ou 1)
    vEdge = uv.x;

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>

  uniform float uTime;
  uniform float uReveal;
  uniform vec3 uColor;
  uniform vec3 uPulseColor;

  varying float vPathT;
  varying float vEdgeSeed;
  varying float vStrength;
  varying float vEdge;

  void main() {
    // A fita só existe até onde a revelação já chegou: a rede se estende da
    // árvore raiz para fora, como o micélio realmente cresce.
    if (vPathT > uReveal) discard;

    // Desbota nas bordas da fita, para não ter recorte duro contra a grama
    float across = 1.0 - abs(vEdge * 2.0 - 1.0);
    float body = smoothstep(0.0, 0.55, across);

    // Pulso viajando ao longo do caminho
    float travel = fract(uTime * 0.28 + vEdgeSeed);
    float dist = abs(fract(vPathT - travel + 0.5) - 0.5);
    float pulse = smoothstep(0.09, 0.0, dist);

    // Some junto às pontas, onde a fita entra no solo sob as árvores
    float ends = smoothstep(0.0, 0.12, vPathT) * smoothstep(1.0, 0.88, vPathT);

    vec3 color = mix(uColor, uPulseColor, pulse);
    // Discreta em repouso, viva só na passagem do pulso: com o brilho de base
    // alto a rede virava um traço de laser cruzando a paisagem.
    float alpha = body * ends * vStrength * (0.14 + pulse * 0.6);

    gl_FragColor = vec4(color * alpha, alpha);

    #include <fog_fragment>
  }
`;

export function MycorrhizalNetwork() {
  const edges = useForestStore((s) => s.edges);
  const atmosphereId = useSceneStore((s) => s.atmosphere);
  const preset = useMemo(() => getAtmosphere(atmosphereId), [atmosphereId]);

  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const revealStart = useRef<number | null>(null);

  const geometry = useMemo(() => {
    if (edges.length === 0) return null;

    const terrain = getTerrain();
    const positions: number[] = [];
    const uvs: number[] = [];
    const pathT: number[] = [];
    const seeds: number[] = [];
    const strengths: number[] = [];
    const indices: number[] = [];

    let vertexBase = 0;

    edges.forEach((edge, edgeIndex) => {
      const seed = (edgeIndex * 0.6180339887) % 1;
      // Ligações de segundo grau são mais tênues
      const strength = edge.degree === 1 ? 1 : 0.55;

      const [x0, , z0] = edge.from;
      const [x1, , z1] = edge.to;

      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.001) return;

      // Perpendicular no plano do chão
      const px = (-dz / len) * (RIBBON_WIDTH / 2);
      const pz = (dx / len) * (RIBBON_WIDTH / 2);

      for (let i = 0; i < SAMPLES; i++) {
        const t = i / (SAMPLES - 1);

        // Leve arco lateral: caminhos retos entre árvores leem como cabo,
        // não como micélio
        const bow = Math.sin(t * Math.PI) * len * 0.06 * (seed * 2 - 1);
        const cx = x0 + dx * t + (-dz / len) * bow;
        const cz = z0 + dz * t + (dx / len) * bow;

        // Acompanha o relevo — é para isto que o terreno é fonte única
        const y = terrain.heightAt(cx, cz) + SURFACE_LIFT;

        positions.push(cx + px, y, cz + pz);
        positions.push(cx - px, y, cz - pz);
        uvs.push(0, t, 1, t);
        pathT.push(t, t);
        seeds.push(seed, seed);
        strengths.push(strength, strength);

        if (i < SAMPLES - 1) {
          const a = vertexBase + i * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }

      vertexBase += SAMPLES * 2;
    });

    if (positions.length === 0) return null;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setAttribute('aPathT', new THREE.Float32BufferAttribute(pathT, 1));
    geom.setAttribute('aEdgeSeed', new THREE.Float32BufferAttribute(seeds, 1));
    geom.setAttribute(
      'aStrength',
      new THREE.Float32BufferAttribute(strengths, 1),
    );
    geom.setIndex(indices);
    geom.computeBoundingSphere();

    return geom;
  }, [edges]);

  const uniforms = useMemo(
    () =>
      THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uReveal: { value: 0 },
          uColor: { value: new THREE.Color('#3fd9a0') },
          uPulseColor: { value: new THREE.Color('#c7ffe9') },
        },
      ]),
    [],
  );

  useEffect(() => {
    revealStart.current = null;
  }, [geometry]);

  useEffect(() => {
    if (!materialRef.current) return;
    // De noite a rede é o elemento mais brilhante da cena; de dia precisa
    // recuar para não competir com a folhagem iluminada.
    const nocturnal = preset.id === 'noite' || preset.id === 'amanhecer';
    materialRef.current.uniforms.uColor.value.set(
      nocturnal ? '#4ff0b4' : '#2f9e74',
    );
  }, [preset]);

  useFrame((state) => {
    const material = materialRef.current;
    if (!material) return;

    const now = state.clock.getElapsedTime();
    if (revealStart.current === null) revealStart.current = now;

    material.uniforms.uTime.value = now;
    // Cresce da raiz para fora ao longo de alguns segundos
    material.uniforms.uReveal.value = Math.min(
      (now - revealStart.current) / 3.5,
      1,
    );
  });

  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} renderOrder={2}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
        fog
      />
    </mesh>
  );
}
