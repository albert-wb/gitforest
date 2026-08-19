/**
 * GitForest — Particles (Partículas Ambientais) v2.0
 *
 * Sistema de partículas com dois layers:
 * - Fireflies (vagalumes): pontos de luz que pulsam e flutuam
 * - Pollen (pólen): partículas douradas ascendentes suaves
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createRNG } from '../../utils/math';

/**
 * Seeds fixas: como a grama e o terreno, as partículas precisam ser
 * determinísticas. Com `Math.random()` a distribuição inicial mudava a cada
 * remontagem do componente — e o React 19 sinaliza chamadas impuras durante a
 * renderização justamente porque esse tipo de instabilidade é difícil de
 * rastrear depois.
 */
const FIREFLY_SEED = 4_112_207;
const POLLEN_SEED = 8_310_559;

/** Fireflies — vagalumes que pulsam com luz quente */
function Fireflies({ count = 40 }: { count?: number }) {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, speeds, phases, brightnesses } = useMemo(() => {
    const rng = createRNG(FIREFLY_SEED);
    const pos = new Float32Array(count * 3);
    const spd = new Float32Array(count);
    const phs = new Float32Array(count);
    const brt = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = 2 + rng() * 10;
      const height = 1 + rng() * 10;

      pos[i * 3] = Math.cos(angle) * radius;
      pos[i * 3 + 1] = height;
      pos[i * 3 + 2] = Math.sin(angle) * radius;

      spd[i] = 0.15 + rng() * 0.4;
      phs[i] = rng() * Math.PI * 2;
      brt[i] = rng(); // brilho base individual
    }

    return { positions: pos, speeds: spd, phases: phs, brightnesses: brt };
  }, [count]);

  const fireflyVertexShader = `
    uniform float uTime;
    attribute float brightness;
    varying float vBrightness;
    
    void main() {
      vBrightness = brightness;
      
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      
      // Tamanho baseado no pulsar
      float pulse = sin(uTime * 2.0 + brightness * 6.28) * 0.5 + 0.5;
      gl_PointSize = (3.0 + pulse * 5.0) * (200.0 / -mvPosition.z);
      
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const fireflyFragmentShader = `
    uniform float uTime;
    varying float vBrightness;
    
    void main() {
      // Forma circular com glow suave
      float dist = length(gl_PointCoord - vec2(0.5));
      if (dist > 0.5) discard;
      
      float glow = 1.0 - smoothstep(0.0, 0.5, dist);
      glow = pow(glow, 2.0);
      
      // Pulsação individual
      float pulse = sin(uTime * 1.5 + vBrightness * 6.28) * 0.5 + 0.5;
      pulse = pow(pulse, 3.0); // Pulsar mais acentuado
      
      // Cor quente dourada (vagalume)
      vec3 color = vec3(1.0, 0.85, 0.4) * glow * pulse;
      float alpha = glow * pulse * 0.8;
      
      gl_FragColor = vec4(color, alpha);
    }
  `;

  // Animação de flutuação errática (padrão de vagalume)
  useFrame((state) => {
    if (!pointsRef.current || !materialRef.current) return;

    const posArray = pointsRef.current.geometry.attributes.position.array as Float32Array;
    const t = state.clock.getElapsedTime();

    for (let i = 0; i < count; i++) {
      const phase = phases[i];
      const speed = speeds[i];

      // Movimento errático (vagalumes não voam em linha reta)
      posArray[i * 3] += Math.sin(t * speed + phase) * 0.003 + Math.sin(t * speed * 3.7 + phase) * 0.001;
      posArray[i * 3 + 1] += Math.cos(t * speed * 0.6 + phase) * 0.004;
      posArray[i * 3 + 2] += Math.cos(t * speed * 0.8 + phase + 1) * 0.003;

      // Loop vertical
      if (posArray[i * 3 + 1] > 14) posArray[i * 3 + 1] = 1;
      if (posArray[i * 3 + 1] < 0.5) posArray[i * 3 + 1] = 13;
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true;
    materialRef.current.uniforms.uTime.value = t;
  });

  // Criar geometry com brightness attribute
  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('brightness', new THREE.Float32BufferAttribute(brightnesses, 1));
    return geom;
  }, [positions, brightnesses]);

  return (
    <points ref={pointsRef} geometry={geometry}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={fireflyVertexShader}
        fragmentShader={fireflyFragmentShader}
        uniforms={{
          uTime: { value: 0 },
        }}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/** Pollen — partículas douradas ascendentes */
function Pollen({ count = 50 }: { count?: number }) {
  const pointsRef = useRef<THREE.Points>(null);

  const { positions, speeds, phases, respawn } = useMemo(() => {
    const rng = createRNG(POLLEN_SEED);
    const pos = new Float32Array(count * 3);
    const spd = new Float32Array(count);
    const phs = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = 1 + rng() * 6;
      const height = rng() * 12;

      pos[i * 3] = Math.cos(angle) * radius;
      pos[i * 3 + 1] = height;
      pos[i * 3 + 2] = Math.sin(angle) * radius;

      spd[i] = 0.3 + rng() * 0.6;
      phs[i] = rng() * Math.PI * 2;
    }

    // O reposicionamento acontece no laço de animação, fora da renderização —
    // por isso pode continuar consumindo o mesmo PRNG seedado.
    return { positions: pos, speeds: spd, phases: phs, respawn: rng };
  }, [count]);

  useFrame((state) => {
    if (!pointsRef.current) return;

    const posArray = pointsRef.current.geometry.attributes.position.array as Float32Array;
    const t = state.clock.getElapsedTime();

    for (let i = 0; i < count; i++) {
      const phase = phases[i];
      const speed = speeds[i];

      // Ascensão lenta + drift horizontal
      posArray[i * 3] += Math.sin(t * speed * 0.3 + phase) * 0.002;
      posArray[i * 3 + 1] += 0.005 + Math.sin(t * speed + phase) * 0.002;
      posArray[i * 3 + 2] += Math.cos(t * speed * 0.4 + phase) * 0.002;

      // Loop vertical
      if (posArray[i * 3 + 1] > 15) {
        posArray[i * 3 + 1] = 0.5;
        const angle = respawn() * Math.PI * 2;
        const radius = 1 + respawn() * 6;
        posArray[i * 3] = Math.cos(angle) * radius;
        posArray[i * 3 + 2] = Math.sin(angle) * radius;
      }
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.04}
        color="#ffe4a0"
        transparent
        opacity={0.4}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

/** Componente principal de partículas */
export function Particles() {
  return (
    <group>
      <Fireflies count={40} />
      <Pollen count={50} />
    </group>
  );
}
