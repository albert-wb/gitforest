/**
 * GitForest — Leaves (Folhagem) v3.0
 *
 * Renderiza todas as folhas usando InstancedMesh para performance.
 *
 * Três mudanças na v3 em relação ao losango cinza único de antes:
 *
 * 1. **Formato por espécie** — agulha de pinheiro, pétala de cerejeira,
 *    folha de bordo, e assim por diante.
 * 2. **Cor tratada** — a cor crua da linguagem passa por `toFoliageColor`.
 *    Sem isso, uma conta de C (`#555555`) nasce com folhagem cinza-chumbo.
 * 3. **Estação** — matiz e densidade são uniforms/contagem, então trocar de
 *    estação é instantâneo e não regenera a árvore.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { LeafData } from '../../engine/types';
import type { SpeciesProfile } from '../../engine/species';
import type { SeasonProfile } from '../../world/season';
import { getLeafGeometry } from './leafShapes';
import { toFoliageColor } from '../../utils/colors';
import { clamp01 } from '../../utils/math';

interface LeavesProps {
  leaves: LeafData[];
  species: SpeciesProfile;
  season: SeasonProfile;
  /**
   * Progresso do crescimento (0-1), lido a cada quadro sem passar pelo React.
   * Ver a explicação em `Tree.tsx`.
   */
  growthRef?: React.RefObject<number>;
}

/** Vertex shader com animação de vento e passagem de dados para SSS */
const leafVertexShader = `
  uniform float uTime;
  uniform float uWindStrength;
  
  attribute vec3 instanceColorAttr;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vWorldNormal;
  varying vec3 vPosition;
  
  void main() {
    vColor = instanceColorAttr;
    vNormal = normalMatrix * normal;
    
    // Posição local do vértice instanciado
    vec4 instancePos = instanceMatrix * vec4(position, 1.0);
    
    // Transformar para espaço global (world)
    vec4 worldPos = modelMatrix * instancePos;
    
    // Normal no espaço mundo para SSS
    vWorldNormal = normalize((modelMatrix * instanceMatrix * vec4(normal, 0.0)).xyz);
    
    // Animação de vento multi-camada (mais orgânica)
    float windPhase = worldPos.x * 1.5 + worldPos.y * 0.8 + worldPos.z * 1.2;
    
    // Vento principal (ondulação lenta)
    float wind1 = sin(uTime * 1.2 + windPhase) * uWindStrength;
    // Vento secundário (rajadas)
    float wind2 = cos(uTime * 2.5 + windPhase * 1.3) * uWindStrength * 0.3;
    // Micro-tremor (folha individual)
    float wind3 = sin(uTime * 4.0 + float(gl_InstanceID) * 0.37) * uWindStrength * 0.15;
    
    float totalWind = wind1 + wind2 + wind3;
    
    worldPos.x += totalWind * 0.06;
    worldPos.z += (wind1 * 0.7 + wind2) * 0.04;
    worldPos.y += abs(totalWind) * 0.015;
    
    vPosition = worldPos.xyz;
    
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

/** Fragment shader com iluminação, subsurface scattering e variação de cor */
const leafFragmentShader = `
  uniform vec3 uSeasonTint;
  uniform float uSeasonAmount;
  uniform float uSeasonBrightness;

  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vWorldNormal;
  varying vec3 vPosition;

  void main() {
    // Direção da luz principal (sol)
    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
    vec3 normal = normalize(vNormal);
    vec3 worldNormal = normalize(vWorldNormal);

    // A estação puxa a folhagem inteira para um matiz comum, antes de
    // qualquer iluminação — é o que faz o outono parecer outono sem
    // reconstruir uma única folha.
    vec3 baseColor = mix(vColor, uSeasonTint, uSeasonAmount) * uSeasonBrightness;

    // Difusa frontal
    float NdotL = max(dot(normal, lightDir), 0.0);

    // === Subsurface Scattering Simplificado ===
    // Quando a luz vem de trás da folha, ela brilha com translucência
    float backLight = max(dot(-worldNormal, lightDir), 0.0);
    float sss = pow(backLight, 2.0) * 0.6;

    // Cor SSS: simula luz atravessando o tecido vegetal. O ganho é contido
    // de propósito — mais que isto e a copa inteira desbota para pastel.
    vec3 sssColor = baseColor * 1.2 + vec3(0.04, 0.08, 0.0);

    // === Iluminação Composta ===
    vec3 ambient = baseColor * 0.35;
    vec3 diffuse = baseColor * NdotL * 0.55;
    vec3 subsurface = sssColor * sss;

    // Variação de profundidade pela altura (copa mais clara)
    float heightFactor = smoothstep(0.0, 10.0, vPosition.y);

    vec3 finalColor = ambient + diffuse + subsurface;
    finalColor = mix(finalColor * 0.85, finalColor * 1.15, heightFactor);

    // Leve rim light (contorno brilhante contra o céu)
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float rim = 1.0 - max(dot(viewDir, worldNormal), 0.0);
    rim = pow(rim, 3.0) * 0.2;
    finalColor += vec3(rim) * baseColor;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export function Leaves({ leaves, species, season, growthRef }: LeavesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uWindStrength: { value: 1 },
      uSeasonTint: { value: new THREE.Color('#ffffff') },
      uSeasonAmount: { value: 0 },
      uSeasonBrightness: { value: 1 },
    }),
    [],
  );

  // Preparar geometria e instâncias simultaneamente para evitar bugs no WebGL
  const { leafGeometry, matrices } = useMemo(() => {
    // Clonado porque cada árvore anexa o seu próprio atributo de cor
    // instanciada à geometria — o contorno em si é compartilhado.
    const geom = getLeafGeometry(species.leafShape).clone();
    const dummy = new THREE.Object3D();
    const mats: THREE.Matrix4[] = [];
    const cols: number[] = [];

    // Cache por cor de linguagem: `toFoliageColor` faz conversões de espaço
    // de cor, e uma copa tem milhares de folhas com meia dúzia de cores.
    const foliageCache = new Map<string, [number, number, number]>();

    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];

      dummy.position.set(
        leaf.position[0],
        leaf.position[1],
        leaf.position[2],
      );

      // A normal já vem variada da gramática (cada folha do cacho nasce
      // depois de rotações próprias), então basta olhar na direção dela.
      dummy.lookAt(
        leaf.position[0] + leaf.normal[0],
        leaf.position[1] + leaf.normal[1],
        leaf.position[2] + leaf.normal[2],
      );
      // Giro no próprio plano: evita que folhas vizinhas fiquem paralelas
      dummy.rotateZ((i * 2.39996) % (Math.PI * 2));

      const scaleVariation = 0.75 + (Math.sin(i * 1.618) * 0.5 + 0.5) * 0.5;
      const s = leaf.scale * scaleVariation;
      dummy.scale.set(s, s, s);

      dummy.updateMatrix();
      mats.push(dummy.matrix.clone());

      let foliage = foliageCache.get(leaf.color);
      if (!foliage) {
        foliage = toFoliageColor(
          leaf.color,
          species.foliageBase,
          species.foliageTint,
        );
        foliageCache.set(leaf.color, foliage);
      }

      // Variação de brilho por instância, senão a copa vira uma mancha chapada
      const variation = 0.86 + (Math.sin(i * 2.236) * 0.5 + 0.5) * 0.28;
      cols.push(
        Math.min(1, foliage[0] * variation),
        Math.min(1, foliage[1] * variation),
        Math.min(1, foliage[2] * variation),
      );
    }

    const colorAttr = new THREE.InstancedBufferAttribute(
      new Float32Array(cols),
      3
    );
    geom.setAttribute('instanceColorAttr', colorAttr);

    return { leafGeometry: geom, matrices: mats };
  }, [leaves, species]);

  // Estação é só uniform — nunca reconstrói a folhagem
  useEffect(() => {
    if (!materialRef.current) return;
    const u = materialRef.current.uniforms;
    u.uSeasonTint.value.set(season.tint);
    u.uSeasonAmount.value = season.tintAmount;
    u.uSeasonBrightness.value = season.brightness;
  }, [season]);

  // Aplicar matrizes ao InstancedMesh
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;

    // A esfera envolvente precisa ser calculada com a contagem cheia, antes
    // que o crescimento comece a reduzi-la. Uma vez definida, o Three não a
    // recalcula — é o que permite manter o frustum culling ligado em vez de
    // desenhar todas as folhas de todas as árvores em todos os quadros.
    mesh.count = matrices.length;
    mesh.computeBoundingSphere();
  }, [matrices]);

  // Uniforms e revelação progressiva das folhas, fora do ciclo do React
  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.getElapsedTime();
    }

    // Densidade sazonal e crescimento são o mesmo mecanismo: um corte na
    // contagem de instâncias. Funciona como desbaste uniforme porque a lista
    // de folhas é embaralhada na geração (ver `shuffleLeaves` em turtle.ts).
    const mesh = meshRef.current;
    if (mesh) {
      const growth = growthRef ? clamp01(growthRef.current) : 1;
      mesh.count = Math.floor(leaves.length * season.density * growth);
    }
  });

  if (leaves.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[leafGeometry, undefined, leaves.length]}
    >
      <shaderMaterial
        ref={materialRef}
        vertexShader={leafVertexShader}
        fragmentShader={leafFragmentShader}
        uniforms={uniforms}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}
