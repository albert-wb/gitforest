/**
 * GitForest — Branches (Tronco e Galhos) v2.0
 *
 * Renderiza os segmentos de tronco/galhos como cilindros low-poly.
 * Usa merge de geometrias para minimizar draw calls.
 * Shader customizado de casca com textura procedural e AO.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import type { TreeSegment } from '../../engine/types';
import type { SpeciesProfile } from '../../engine/species';
import { hexToRgb } from '../../utils/colors';

interface BranchesProps {
  segments: TreeSegment[];
  isTrunk: boolean;
  species: SpeciesProfile;
}

/** Galho seco: dessaturado e frio, contrastando com a casca viva. */
const BARK_DEAD: [number, number, number] = [0.28, 0.27, 0.24];

/**
 * Lados do cilindro. O tronco ganha mais que os galhos: com 5 lados, um
 * tronco grosso lê como um prisma pentagonal, enquanto num galho fino a
 * mesma contagem é imperceptível e o custo é multiplicado por centenas.
 */
const RADIAL_SEGMENTS_TRUNK = 7;
const RADIAL_SEGMENTS_BRANCH = 4;

/** Vertex shader de casca */
const barkVertexShader = `
  attribute vec3 barkColor;
  attribute float barkDepth;
  
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vDepth;
  
  void main() {
    vColor = barkColor;
    vNormal = normalize(normalMatrix * normal);
    vDepth = barkDepth;
    
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

/** Fragment shader de casca com textura procedural */
const barkFragmentShader = `
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vDepth;
  
  // Simplex noise simplificado (hash-based)
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  
  float noise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
          mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
          mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z
    );
  }
  
  void main() {
    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
    vec3 normal = normalize(vNormal);
    
    // === Textura Procedural de Casca ===
    // Anéis verticais (crescimento)
    float rings = noise3D(vWorldPosition * vec3(2.0, 12.0, 2.0)) * 0.5 + 0.5;
    // Fissuras (cracks)
    float cracks = noise3D(vWorldPosition * vec3(8.0, 3.0, 8.0));
    // Micro-detalhe
    float micro = noise3D(vWorldPosition * 25.0) * 0.15;
    
    // Combinar padrão de casca
    float barkPattern = rings * 0.6 + cracks * 0.3 + micro;
    
    // Variação de cor pela textura
    vec3 barkColor = mix(vColor * 0.7, vColor * 1.3, barkPattern);
    
    // === Iluminação ===
    float NdotL = max(dot(normal, lightDir), 0.0);
    
    // Ambient Occlusion nas fissuras
    float ao = smoothstep(0.15, 0.6, barkPattern);
    ao = mix(0.5, 1.0, ao);
    
    // Galhos mais profundos recebem menos luz (oclusão natural)
    float depthAO = mix(1.0, 0.7, smoothstep(0.0, 3.0, vDepth));
    
    vec3 ambient = barkColor * 0.3 * ao * depthAO;
    vec3 diffuse = barkColor * NdotL * 0.6;
    
    // Leve highlight especular (casca úmida/musgo)
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 halfDir = normalize(lightDir + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), 32.0) * 0.08;
    
    vec3 finalColor = ambient + diffuse + vec3(spec);
    
    // Tocar galhos mortos com dessaturação e tom frio
    // (já aplicado via barkColor, mas add extra)
    
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export function Branches({ segments, isTrunk, species }: BranchesProps) {
  const { mergedGeometry } = useMemo(() => {
    if (segments.length === 0) return { mergedGeometry: null };

    const geometries: THREE.BufferGeometry[] = [];
    const colors: number[] = [];
    const depths: number[] = [];

    const barkDark = hexToRgb(species.barkDark);
    const barkLight = hexToRgb(species.barkLight);
    // O tronco é sempre mais escuro e úmido que os ramos altos
    const trunkDark = barkDark.map((c) => c * 0.78) as [number, number, number];
    const radialSegments = isTrunk
      ? RADIAL_SEGMENTS_TRUNK
      : RADIAL_SEGMENTS_BRANCH;

    for (const seg of segments) {
      const dx = seg.end[0] - seg.start[0];
      const dy = seg.end[1] - seg.start[1];
      const dz = seg.end[2] - seg.start[2];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (length < 0.001) continue;

      // Cilindro low-poly.
      //
      // `toNonIndexed()` é o que realmente produz o facetado: com vértices
      // compartilhados, `computeVertexNormals` faz a média entre faces e a
      // casca sai lisa. O `flatShading` que ficava no material não resolvia —
      // num `ShaderMaterial` customizado o Three injeta o `#define
      // FLAT_SHADED`, mas o shader de casca nunca o consultou.
      const geom = new THREE.CylinderGeometry(
        seg.endRadius,
        seg.startRadius,
        length,
        radialSegments,
        1,
        false,
      ).toNonIndexed();

      // Posicionar e orientar o cilindro
      const midpoint = new THREE.Vector3(
        (seg.start[0] + seg.end[0]) / 2,
        (seg.start[1] + seg.end[1]) / 2,
        (seg.start[2] + seg.end[2]) / 2,
      );

      const direction = new THREE.Vector3(dx, dy, dz).normalize();
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction,
      );

      const matrix = new THREE.Matrix4();
      matrix.compose(midpoint, quaternion, new THREE.Vector3(1, 1, 1));
      geom.applyMatrix4(matrix);

      // Flat shading para low-poly
      geom.computeVertexNormals();

      // Cor base: varia entre dark e light baseado na posição
      const posCount = geom.attributes.position.count;
      
      if (seg.isDead) {
        for (let i = 0; i < posCount; i++) {
          colors.push(BARK_DEAD[0], BARK_DEAD[1], BARK_DEAD[2]);
          depths.push(seg.depth);
        }
      } else if (isTrunk) {
        for (let i = 0; i < posCount; i++) {
          // Interpolação vertical no tronco (base escura → topo claro)
          const y = geom.attributes.position.getY(i);
          const t = Math.max(0, Math.min(1, (y + 2) / 10));
          colors.push(
            trunkDark[0] + (barkLight[0] - trunkDark[0]) * t,
            trunkDark[1] + (barkLight[1] - trunkDark[1]) * t,
            trunkDark[2] + (barkLight[2] - trunkDark[2]) * t,
          );
          depths.push(seg.depth);
        }
      } else {
        for (let i = 0; i < posCount; i++) {
          // Variação sutil por galho
          const branchVar = (seg.branchIndex * 0.037) % 0.1;
          colors.push(
            barkDark[0] + (barkLight[0] - barkDark[0]) * 0.5 + branchVar,
            barkDark[1] + (barkLight[1] - barkDark[1]) * 0.5 + branchVar * 0.5,
            barkDark[2] + (barkLight[2] - barkDark[2]) * 0.5,
          );
          depths.push(seg.depth);
        }
      }

      geometries.push(geom);
    }

    if (geometries.length === 0) return { mergedGeometry: null };

    // Merge todas as geometrias em uma só (1 draw call)
    const merged = mergeGeometries(geometries);
    if (!merged) return { mergedGeometry: null };

    // Adicionar atributos customizados
    merged.setAttribute(
      'barkColor',
      new THREE.Float32BufferAttribute(colors, 3),
    );
    merged.setAttribute(
      'barkDepth',
      new THREE.Float32BufferAttribute(depths, 1),
    );

    // Cleanup
    geometries.forEach((g) => g.dispose());

    return { mergedGeometry: merged };
  }, [segments, isTrunk, species]);

  if (!mergedGeometry) return null;

  return (
    <mesh geometry={mergedGeometry} castShadow receiveShadow>
      <shaderMaterial
        vertexShader={barkVertexShader}
        fragmentShader={barkFragmentShader}
        uniforms={{}}
      />
    </mesh>
  );
}

/**
 * Merge manual de BufferGeometries.
 */
function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geometries.length === 0) return null;

  let totalPositions = 0;
  let totalNormals = 0;

  for (const geom of geometries) {
    totalPositions += geom.attributes.position.count * 3;
    if (geom.attributes.normal) {
      totalNormals += geom.attributes.normal.count * 3;
    }
  }

  const positions = new Float32Array(totalPositions);
  const normals = new Float32Array(totalNormals);
  const indices: number[] = [];

  let posOffset = 0;
  let normOffset = 0;
  let vertexOffset = 0;

  for (const geom of geometries) {
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count * 3; i++) {
      positions[posOffset + i] = pos.array[i];
    }

    if (geom.attributes.normal) {
      const norm = geom.attributes.normal;
      for (let i = 0; i < norm.count * 3; i++) {
        normals[normOffset + i] = norm.array[i];
      }
      normOffset += norm.count * 3;
    }

    if (geom.index) {
      for (let i = 0; i < geom.index.count; i++) {
        indices.push(geom.index.array[i] + vertexOffset);
      }
    }

    vertexOffset += pos.count;
    posOffset += pos.count * 3;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (totalNormals > 0) {
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  }
  if (indices.length > 0) {
    merged.setIndex(indices);
  }

  return merged;
}
