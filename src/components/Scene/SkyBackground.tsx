/**
 * GitForest — Céu
 *
 * Quad de tela cheia com o gradiente do preset de atmosfera.
 *
 * Duas mudanças importantes em relação à versão anterior:
 *
 * 1. **O gradiente segue o mundo, não a tela.** Antes as faixas de cor eram
 *    indexadas por `vUv.y`, então o "horizonte" acompanhava o viewport: ao
 *    inclinar a câmera para cima o céu continuava idêntico. Agora o shader
 *    reconstrói a direção do raio em espaço de mundo e usa a componente Y
 *    dela — o horizonte fica onde deve ficar.
 * 2. **As cores vêm do preset**, as mesmas que alimentam luz e neblina.
 *
 * `frustumCulled` fica desligado de propósito: a esfera envolvente do quad é
 * minúscula e centrada na origem, então o culling o descartaria em boa parte
 * das órbitas — deixando a tela preta.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getAtmosphere } from '../../world/atmosphere';
import { useSceneStore } from '../../store/useSceneStore';

const skyVertexShader = /* glsl */ `
  uniform mat4 uInvViewProj;

  varying vec3 vDir;

  void main() {
    // Reprojeta o canto do quad para o mundo e deriva a direção de visão
    vec4 far = uInvViewProj * vec4(position.xy, 1.0, 1.0);
    vDir = normalize(far.xyz / far.w - cameraPosition);

    // z = 0.9999 mantém o quad colado no plano de fundo
    gl_Position = vec4(position.xy, 0.9999, 1.0);
  }
`;

const skyFragmentShader = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunGlow;
  uniform float uStars;
  uniform float uTime;

  varying vec3 vDir;

  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  /** Campo esparso de estrelas ancorado na direção de visão. */
  float starField(vec3 dir) {
    vec3 p = dir * 220.0;
    vec3 cell = floor(p);
    vec3 f = fract(p) - 0.5;

    float r = hash31(cell);
    if (r < 0.986) return 0.0;

    float intensity = (r - 0.986) / 0.014;
    float point = smoothstep(0.42, 0.0, length(f));
    float twinkle = 0.55 + 0.45 * sin(uTime * 1.8 + r * 320.0);

    return point * intensity * twinkle;
  }

  void main() {
    float h = vDir.y;

    vec3 color;
    if (h > 0.32) {
      color = mix(uMid, uTop, clamp((h - 0.32) / 0.68, 0.0, 1.0));
    } else if (h > 0.02) {
      color = mix(uHorizon, uMid, clamp((h - 0.02) / 0.30, 0.0, 1.0));
    } else {
      // Abaixo da linha do horizonte quase tudo é coberto por terreno,
      // mas a faixa continua para o caso de ângulos rasantes.
      color = mix(uSunColor, uHorizon, clamp((h + 0.22) / 0.24, 0.0, 1.0));
    }

    // Estrelas desaparecem perto do horizonte, onde a atmosfera é espessa
    if (uStars > 0.0) {
      color += vec3(starField(vDir)) * uStars * smoothstep(0.0, 0.32, h);
    }

    // Disco e halo do sol, na direção real da luz principal da cena
    float sunDot = max(dot(vDir, uSunDir), 0.0);
    color += uSunColor * pow(sunDot, 220.0) * uSunGlow * 2.0;
    color += uSunColor * pow(sunDot, 6.0) * uSunGlow * 0.35;
    color += uSunColor * pow(sunDot, 1.5) * uSunGlow * 0.06;

    gl_FragColor = vec4(color, 1.0);
  }
`;

function createSkyUniforms() {
  return {
    uInvViewProj: { value: new THREE.Matrix4() },
    uTop: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunGlow: { value: 0.5 },
    uStars: { value: 0 },
    uTime: { value: 0 },
  };
}

export function SkyBackground() {
  const atmosphereId = useSceneStore((s) => s.atmosphere);
  const preset = useMemo(() => getAtmosphere(atmosphereId), [atmosphereId]);

  // O material é declarado em JSX e alcançado por ref. Uniforms são mutados a
  // cada quadro, e o React só permite esse tipo de escrita fora da
  // renderização — através de uma ref, nunca de um valor de `useMemo`.
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => createSkyUniforms(), []);

  useEffect(() => {
    if (!materialRef.current) return;
    const u = materialRef.current.uniforms;

    u.uTop.value.set(preset.sky.top);
    u.uMid.value.set(preset.sky.mid);
    u.uHorizon.value.set(preset.sky.horizon);
    u.uSunColor.value.set(preset.sky.sun);
    u.uSunGlow.value = preset.sky.sunGlow;
    u.uStars.value = preset.sky.stars;
    u.uSunDir.value.set(...preset.sun.direction).normalize();
  }, [preset]);

  useFrame((state) => {
    if (!materialRef.current) return;
    const { camera, clock } = state;

    materialRef.current.uniforms.uInvViewProj.value
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .invert();
    materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
  });

  return (
    <mesh renderOrder={-1} frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={skyVertexShader}
        fragmentShader={skyFragmentShader}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}
