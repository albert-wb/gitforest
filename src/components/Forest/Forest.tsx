/**
 * GitForest — Renderizador da Floresta
 *
 * Desenha **todas** as árvores de fundo em duas chamadas de desenho: uma
 * geometria mesclada para troncos e galhos, e um único `InstancedMesh` para
 * toda a folhagem. Uma malha por árvore custaria dezenas de draw calls e
 * inviabilizaria a escala que esta fase existe para provar.
 *
 * ## Crescimento sem trabalho por quadro
 *
 * Cada vértice carrega o instante em que a sua árvore nasceu (`aBornAt`) e a
 * posição da base dela (`aOrigin`). O progresso é derivado no shader a partir
 * do tempo corrente, então a animação de brotar não custa **nada** na CPU:
 * nenhum uniform a atualizar, nenhum atributo a reescrever, nenhuma
 * renderização do React. É o mesmo princípio da correção feita na Fase 1 no
 * `growthProgress` da árvore em foco, levado ao limite.
 *
 * É isso que transforma a latência da API em narrativa: as árvores brotam
 * conforme os dados chegam, em vez de um spinner de vinte segundos.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useForestStore, type ForestNode } from '../../store/useForestStore';
import { ForestPicking } from './ForestPicking';
import { useSceneStore } from '../../store/useSceneStore';
import { getAtmosphere } from '../../world/atmosphere';
import { getSeason } from '../../world/season';
import { SPECIES, type SpeciesId } from '../../engine/species';
import { getLeafGeometry } from '../Tree/leafShapes';
import { MycorrhizalNetwork } from './MycorrhizalNetwork';

/** Duração do brotar de cada árvore, em segundos. */
const GROW_DURATION = 2.2;
/** Folhas aparecem um pouco depois dos galhos. */
const LEAF_DELAY = 0.35;

// ============================================================
// Shaders
// ============================================================

const growthChunk = /* glsl */ `
  uniform float uTime;
  uniform float uGrowDuration;

  attribute vec3 aOrigin;
  attribute float aBornAt;

  /** 0 → 1 com desaceleração, derivado do relógio da cena. */
  float growthAt(float delay) {
    float t = clamp((uTime - aBornAt - delay) / uGrowDuration, 0.0, 1.0);
    return 1.0 - pow(1.0 - t, 3.0);
  }
`;

const trunkVertexShader = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>

  ${growthChunk}

  attribute vec3 aBark;

  varying vec3 vColor;
  varying vec3 vNormal;

  void main() {
    float g = growthAt(0.0);

    // Cresce a partir do pé: a base fica plantada e a copa sobe
    vec3 grown = aOrigin + (position - aOrigin) * g;

    vColor = aBark;
    vNormal = normalize(normalMatrix * normal);

    vec4 worldPos = modelMatrix * vec4(grown, 1.0);
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
  }
`;

const trunkFragmentShader = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>

  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;

  varying vec3 vColor;
  varying vec3 vNormal;

  void main() {
    // Iluminação simples de propósito: a casca detalhada com ruído
    // procedural fica só na árvore em foco. A esta distância ninguém vê
    // fissura de casca, mas todo mundo sente o custo de calculá-la.
    float ndl = max(dot(normalize(vNormal), uSunDir), 0.0);
    vec3 color = vColor * (uAmbient + uSunColor * ndl * 0.75);

    gl_FragColor = vec4(color, 1.0);

    #include <fog_fragment>
  }
`;

const foliageVertexShader = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>

  ${growthChunk}

  uniform float uWind;

  attribute vec3 aTint;
  attribute float aPhase;

  varying vec3 vTint;

  void main() {
    float g = growthAt(${LEAF_DELAY.toFixed(2)});

    vec4 instancePos = instanceMatrix * vec4(position * g, 1.0);
    vec4 worldPos = modelMatrix * instancePos;

    // Balanço leve, com fase por instância para não pulsar em uníssono
    float sway = sin(uTime * 1.3 + aPhase + worldPos.x * 0.2);
    worldPos.x += sway * uWind * 0.05;
    worldPos.z += cos(uTime * 1.1 + aPhase) * uWind * 0.035;

    vTint = aTint;

    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
  }
`;

const foliageFragmentShader = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>

  uniform vec3 uSeasonTint;
  uniform float uSeasonAmount;
  uniform float uSeasonBrightness;
  uniform vec3 uAmbient;
  uniform vec3 uSunColor;

  varying vec3 vTint;

  void main() {
    vec3 base = mix(vTint, uSeasonTint, uSeasonAmount) * uSeasonBrightness;
    vec3 color = base * (uAmbient + uSunColor * 0.55);

    gl_FragColor = vec4(color, 1.0);

    #include <fog_fragment>
  }
`;

// ============================================================
// Montagem dos buffers
// ============================================================

/** Folhagem de uma espécie: geometria instanciada e as matrizes que a povoam. */
interface FoliageBatch {
  geometry: THREE.BufferGeometry;
  /**
   * As matrizes andam ao lado da geometria, e **não** dentro de
   * `geometry.userData`.
   *
   * `BufferGeometry.copy()` atribui `userData` por referência, então todos os
   * clones de um mesmo contorno compartilham o mesmo objeto. Guardar as
   * matrizes ali fazia a última espécie processada sobrescrever as demais —
   * e quando o array sobrescrito era maior que o `instanceMatrix` de destino,
   * o resultado era um `offset is out of bounds` em pleno `set()`.
   */
  matrices: Float32Array;
  count: number;
}

interface MergedForest {
  trunkGeometry: THREE.BufferGeometry | null;
  foliage: Map<SpeciesId, FoliageBatch>;
}

/**
 * Junta os buffers de todas as árvores.
 *
 * Roda a cada lote que chega (uma dezena de vezes numa floresta completa),
 * não a cada quadro. A alternativa — buffers pré-alocados com `drawRange`
 * crescente — evitaria a realocação, mas a esta escala a diferença não paga
 * a complexidade.
 */
function mergeForest(nodes: ForestNode[]): MergedForest {
  if (nodes.length === 0) {
    return { trunkGeometry: null, foliage: new Map() };
  }

  // ---------- Troncos e galhos ----------

  let vertexTotal = 0;
  for (const node of nodes) {
    vertexTotal += node.mesh.branchPositions.length / 3;
  }

  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const bark = new Float32Array(vertexTotal * 3);
  const origins = new Float32Array(vertexTotal * 3);
  const born = new Float32Array(vertexTotal);

  let v = 0;
  for (const node of nodes) {
    const src = node.mesh.branchPositions;
    const count = src.length / 3;
    const [ox, oy, oz] = node.position;
    const s = node.scale;
    const t = node.bornAt;

    for (let i = 0; i < count; i++) {
      const o = (v + i) * 3;
      // A escala é assada no vértice: a árvore já nasce no tamanho certo,
      // sem precisar de um nó de transformação por árvore.
      positions[o] = src[i * 3] * s + ox;
      positions[o + 1] = src[i * 3 + 1] * s + oy;
      positions[o + 2] = src[i * 3 + 2] * s + oz;

      normals[o] = node.mesh.branchNormals[i * 3];
      normals[o + 1] = node.mesh.branchNormals[i * 3 + 1];
      normals[o + 2] = node.mesh.branchNormals[i * 3 + 2];

      bark[o] = node.mesh.branchColors[i * 3];
      bark[o + 1] = node.mesh.branchColors[i * 3 + 1];
      bark[o + 2] = node.mesh.branchColors[i * 3 + 2];

      origins[o] = ox;
      origins[o + 1] = oy;
      origins[o + 2] = oz;

      born[v + i] = t;
    }
    v += count;
  }

  const trunkGeometry = new THREE.BufferGeometry();
  trunkGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  trunkGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  trunkGeometry.setAttribute('aBark', new THREE.BufferAttribute(bark, 3));
  trunkGeometry.setAttribute('aOrigin', new THREE.BufferAttribute(origins, 3));
  trunkGeometry.setAttribute('aBornAt', new THREE.BufferAttribute(born, 1));
  trunkGeometry.computeBoundingSphere();

  // ---------- Folhagem, agrupada por formato de folha ----------

  const bySpecies = new Map<SpeciesId, ForestNode[]>();
  for (const node of nodes) {
    const id = node.mesh.speciesId as SpeciesId;
    const list = bySpecies.get(id);
    if (list) list.push(node);
    else bySpecies.set(id, [node]);
  }

  const foliage = new Map<SpeciesId, FoliageBatch>();

  for (const [speciesId, group] of bySpecies) {
    let total = 0;
    for (const node of group) total += node.mesh.leafCount;
    if (total === 0) continue;

    const matrices = new Float32Array(total * 16);
    const tints = new Float32Array(total * 3);
    const leafOrigins = new Float32Array(total * 3);
    const leafBorn = new Float32Array(total);
    const phases = new Float32Array(total);

    let li = 0;
    for (const node of group) {
      const [ox, oy, oz] = node.position;
      const s = node.scale;
      const t = node.bornAt;

      for (let i = 0; i < node.mesh.leafCount; i++) {
        const src = i * 16;
        const dst = li * 16;

        // Escala uniforme na base + translação para a posição da árvore
        for (let c = 0; c < 12; c++) {
          matrices[dst + c] = node.mesh.leafMatrices[src + c] * s;
        }
        matrices[dst + 12] = node.mesh.leafMatrices[src + 12] * s + ox;
        matrices[dst + 13] = node.mesh.leafMatrices[src + 13] * s + oy;
        matrices[dst + 14] = node.mesh.leafMatrices[src + 14] * s + oz;
        matrices[dst + 15] = 1;

        tints[li * 3] = node.mesh.leafColors[i * 3];
        tints[li * 3 + 1] = node.mesh.leafColors[i * 3 + 1];
        tints[li * 3 + 2] = node.mesh.leafColors[i * 3 + 2];

        leafOrigins[li * 3] = ox;
        leafOrigins[li * 3 + 1] = oy;
        leafOrigins[li * 3 + 2] = oz;

        leafBorn[li] = t;
        phases[li] = (li * 2.39996) % (Math.PI * 2);
        li++;
      }
    }

    const geom = getLeafGeometry(SPECIES[speciesId].leafShape).clone();
    geom.setAttribute(
      'aTint',
      new THREE.InstancedBufferAttribute(tints, 3),
    );
    geom.setAttribute(
      'aOrigin',
      new THREE.InstancedBufferAttribute(leafOrigins, 3),
    );
    geom.setAttribute(
      'aBornAt',
      new THREE.InstancedBufferAttribute(leafBorn, 1),
    );
    geom.setAttribute(
      'aPhase',
      new THREE.InstancedBufferAttribute(phases, 1),
    );

    foliage.set(speciesId, { geometry: geom, matrices, count: total });
  }

  return { trunkGeometry, foliage };
}

// ============================================================
// Componentes
// ============================================================

function ForestFoliage({
  speciesId,
  batch,
}: {
  speciesId: SpeciesId;
  batch: FoliageBatch;
}) {
  const { geometry, matrices, count } = batch;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const atmosphereId = useSceneStore((s) => s.atmosphere);
  const seasonId = useSceneStore((s) => s.season);
  const preset = useMemo(() => getAtmosphere(atmosphereId), [atmosphereId]);
  const season = useMemo(() => getSeason(seasonId), [seasonId]);

  const uniforms = useMemo(
    () =>
      THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uGrowDuration: { value: GROW_DURATION },
          uWind: { value: 1 },
          uSeasonTint: { value: new THREE.Color('#ffffff') },
          uSeasonAmount: { value: 0 },
          uSeasonBrightness: { value: 1 },
          uAmbient: { value: new THREE.Color('#404040') },
          uSunColor: { value: new THREE.Color('#ffffff') },
        },
      ]),
    [],
  );

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    (mesh.instanceMatrix.array as Float32Array).set(matrices);
    mesh.instanceMatrix.needsUpdate = true;

    // A esfera envolvente precisa da contagem cheia antes do corte sazonal,
    // senão o culling descartaria a folhagem que ainda deveria aparecer.
    mesh.count = count;
    mesh.computeBoundingSphere();

    // A densidade sazonal corta a contagem; funciona como desbaste porque a
    // lista de folhas já veio embaralhada da geração.
    mesh.count = Math.floor(count * season.density);
  }, [geometry, matrices, count, season]);

  useEffect(() => {
    if (!materialRef.current) return;
    const u = materialRef.current.uniforms;
    u.uSeasonTint.value.set(season.tint);
    u.uSeasonAmount.value = season.tintAmount;
    u.uSeasonBrightness.value = season.brightness;
    u.uAmbient.value
      .set(preset.hemisphere.sky)
      .multiplyScalar(preset.hemisphere.intensity * 0.7);
    u.uSunColor.value
      .set(preset.sun.color)
      .multiplyScalar(preset.sun.intensity * 0.5);
  }, [preset, season]);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.getElapsedTime();
    }
  });

  return (
    <instancedMesh key={speciesId} ref={meshRef} args={[geometry, undefined, count]}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={foliageVertexShader}
        fragmentShader={foliageFragmentShader}
        uniforms={uniforms}
        fog
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}

function ForestTrunks({ geometry }: { geometry: THREE.BufferGeometry }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const atmosphereId = useSceneStore((s) => s.atmosphere);
  const preset = useMemo(() => getAtmosphere(atmosphereId), [atmosphereId]);

  const uniforms = useMemo(
    () =>
      THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uGrowDuration: { value: GROW_DURATION },
          uSunDir: { value: new THREE.Vector3(0.5, 1, 0.3).normalize() },
          uSunColor: { value: new THREE.Color('#ffffff') },
          uAmbient: { value: new THREE.Color('#404040') },
        },
      ]),
    [],
  );

  useEffect(() => {
    if (!materialRef.current) return;
    const u = materialRef.current.uniforms;
    u.uSunDir.value.set(...preset.sun.direction).normalize();
    u.uSunColor.value
      .set(preset.sun.color)
      .multiplyScalar(preset.sun.intensity * 0.55);
    u.uAmbient.value
      .set(preset.hemisphere.sky)
      .multiplyScalar(preset.hemisphere.intensity * 0.8);
  }, [preset]);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.getElapsedTime();
    }
  });

  return (
    <mesh geometry={geometry}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={trunkVertexShader}
        fragmentShader={trunkFragmentShader}
        uniforms={uniforms}
        fog
      />
    </mesh>
  );
}

export function Forest() {
  const nodes = useForestStore((s) => s.nodes);

  // `bornAt` já vem em cada nó, marcado pela store no relógio compartilhado
  const merged = useMemo(() => mergeForest(nodes), [nodes]);

  // Buffers antigos são liberados assim que um lote novo os substitui
  useEffect(() => {
    return () => {
      merged.trunkGeometry?.dispose();
      merged.foliage.forEach((batch) => batch.geometry.dispose());
    };
  }, [merged]);

  if (nodes.length === 0) return null;

  return (
    <group>
      {merged.trunkGeometry && (
        <ForestTrunks geometry={merged.trunkGeometry} />
      )}

      {[...merged.foliage.entries()].map(([speciesId, batch]) => (
        <ForestFoliage key={speciesId} speciesId={speciesId} batch={batch} />
      ))}

      <MycorrhizalNetwork />
      <ForestPicking />
    </group>
  );
}
