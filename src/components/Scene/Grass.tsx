/**
 * GitForest — Grama
 *
 * Reescrita completa dos antigos 300 triângulos planos.
 *
 * Quatro coisas mudaram, e cada uma resolve um problema concreto:
 *
 * 1. **Segue o terreno.** Cada talo é posicionado por `terrain.heightAt()` e
 *    inclinado parcialmente na direção da normal do solo. Antes tudo vivia em
 *    y = 0, o que só funcionava porque o chão era um disco plano.
 * 2. **Vento de verdade.** A curvatura acontece no vertex shader, proporcional
 *    ao quadrado da altura ao longo do talo, com um campo de ruído rolando na
 *    direção do vento — dá para ver a rajada atravessando o campo. O código
 *    anterior anunciava "animação de vento" mas só pulsava o `emissive`.
 * 3. **Determinística.** Usa o PRNG seedado do projeto. Com `Math.random()` a
 *    grama mudava a cada remontagem do componente.
 * 4. **Concorda com o chão.** A cor de cada talo sai de `terrain.colorAt()`,
 *    a mesma função que pinta o terreno, puxada para o verde e modulada pelo
 *    preset de atmosfera. Grama e solo não brigam mais de cor.
 *
 * Os talos são agrupados em tufos e organizados em tiles, cada tile um
 * `InstancedMesh` com bounding sphere real — assim o frustum culling funciona,
 * em vez de ser desligado.
 *
 * ## O campo acompanha a câmera
 *
 * Os tiles não formam um campo fixo ao redor da origem: eles formam uma
 * **janela** que anda junto com o ponto para onde a câmera olha. Com um campo
 * fixo, bastava arrastar a cena com o botão direito para sair da grama e
 * encontrar terreno pelado — e a única saída seria aumentar o raio, o que
 * multiplica o custo pela **área** para cobrir um lugar onde ninguém está
 * olhando na maior parte do tempo.
 *
 * Isso só é possível porque o conteúdo de um tile depende exclusivamente das
 * suas coordenadas de grade (a seed é derivada de `ti`/`tj`). Um tile gerado
 * quando a câmera passa por ali é idêntico ao que seria gerado ao voltar, de
 * modo que caminhar de ida e volta não muda a paisagem.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getTerrain } from '../../world/terrain';
import { getAtmosphere, type AtmospherePreset } from '../../world/atmosphere';
import { useSceneStore } from '../../store/useSceneStore';
import { createRNG, lerp } from '../../utils/math';

// ============================================================
// Parâmetros
// ============================================================

const SEED = 77_311;

const TILE_SIZE = 24;

/**
 * Anéis de tiles ao redor do tile central: 2 dá uma grade 5x5, ou seja um
 * campo de 120 unidades de lado sempre centrado no que se está olhando.
 *
 * Cada anel a mais custa o **perímetro** da grade, não um tile: passar de 2
 * para 3 vai de 25 para 49 tiles.
 */
const TILE_RING = 2;

/**
 * Tufos por tile.
 *
 * Uniforme, sem queda com a distância. A versão anterior ralava a grama longe
 * da origem, o que fazia sentido quando o campo era fixo e a câmera vivia no
 * centro dele; com a janela seguindo a câmera, "longe" passou a ser relativo a
 * um centro móvel — e densidade que depende de um centro móvel significa que o
 * tile muda de conteúdo quando a grade desliza, o que aparece como grama
 * piscando no chão.
 *
 * O valor recupera a densidade que a versão antiga tinha **no centro**
 * (~1,4 tufos por unidade quadrada). Com 560, o campo cobria mais área mas
 * ficava visivelmente ralo debaixo da câmera, que é onde a grama é vista de
 * perto e mais importa.
 */
const TUFTS_PER_TILE = 810;

/**
 * Tiles construídos por quadro, no máximo.
 *
 * Montar um tile são milhares de consultas ao terreno e outras tantas
 * quaternions; fazer os cinco de uma fileira nova no mesmo quadro produz um
 * engasgo visível justamente enquanto a pessoa arrasta a cena.
 */
const TILES_POR_QUADRO = 2;
/** Talos por tufo — agrupar lê muito melhor que espalhar uniformemente. */
const BLADES_PER_TUFT = 5;
const TUFT_SPREAD = 0.26;

/** Acima deste declive o solo é rocha exposta e a grama não pega. */
const MAX_SLOPE = 0.42;
/** Nada de grama brotando dentro do tronco. */
const TRUNK_CLEARANCE = 1.2;

const BLADE_SEGMENTS = 3;
const BLADE_HALF_WIDTH = 0.032;
const BLADE_CURVE = 0.2;
const BLADE_MIN_HEIGHT = 0.18;
const BLADE_MAX_HEIGHT = 0.42;

/** Quanto o talo acompanha a inclinação do terreno (1 = totalmente). */
const TERRAIN_ALIGNMENT = 0.65;

/** Verde para o qual a cor do solo é puxada ao virar folha de grama. */
const GRASS_GREEN = new THREE.Color('#79a848');
const GRASS_GREEN_MIX = 0.55;

// ============================================================
// Geometria do talo
// ============================================================

/**
 * Talo afilado e curvado para a frente. `bladeT` (0 na raiz, 1 na ponta)
 * alimenta tanto a curvatura do vento quanto o gradiente de cor.
 */
function createBladeGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const ts: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < BLADE_SEGMENTS; i++) {
    const t = i / BLADE_SEGMENTS;
    const w = BLADE_HALF_WIDTH * Math.pow(1 - t, 0.65);
    const y = t;
    const z = BLADE_CURVE * t * t;
    positions.push(-w, y, z, w, y, z);
    ts.push(t, t);
  }

  // Vértice único na ponta
  const tipIndex = BLADE_SEGMENTS * 2;
  positions.push(0, 1, BLADE_CURVE);
  ts.push(1);

  for (let i = 0; i < BLADE_SEGMENTS - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }
  const lastL = (BLADE_SEGMENTS - 1) * 2;
  indices.push(lastL, tipIndex, lastL + 1);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('bladeT', new THREE.Float32BufferAttribute(ts, 1));
  geom.setIndex(indices);
  return geom;
}

// ============================================================
// Shaders
// ============================================================

const grassVertexShader = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>

  uniform float uTime;
  uniform float uWindStrength;
  uniform vec2 uWindDir;

  attribute float bladeT;
  attribute vec3 aTint;
  attribute float aPhase;

  varying vec3 vTint;
  varying float vT;

  // Ruído de valor barato — serve só para o campo de rajadas
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vTint = aTint;
    vT = bladeT;

    vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);

    // Campo de rajadas rolando na direção do vento: dá para ver a onda
    // atravessando o campo em vez de todo talo oscilar em uníssono.
    vec2 gustUv = worldPos.xz * 0.045 - uWindDir * uTime * 0.6;
    float gust = vnoise(gustUv) * 2.0 - 1.0;
    float sway = sin(uTime * 1.7 + aPhase);
    float bend = (gust * 0.75 + sway * 0.45) * uWindStrength;

    // A base fica presa no solo; só a ponta entorta de verdade.
    float falloff = bladeT * bladeT;
    worldPos.xz += uWindDir * bend * falloff * 0.7;
    // Entortar precisa encurtar, senão o talo "estica" ao dobrar.
    worldPos.y -= abs(bend) * falloff * 0.12;

    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
  }
`;

const grassFragmentShader = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>

  uniform vec3 uTint;
  uniform vec3 uSunColor;
  uniform float uSunHeight;

  varying vec3 vTint;
  varying float vT;

  void main() {
    // A raiz do talo vive na sombra do próprio tufo
    float shade = mix(0.42, 1.15, vT);
    vec3 color = vTint * uTint * shade;

    // Um talo é fino demais para ter normal confiável; em vez de iluminar
    // de verdade, adiciona-se um toque de sol nas pontas.
    color += uSunColor * (vT * vT) * uSunHeight * 0.14;

    gl_FragColor = vec4(color, 1.0);

    #include <fog_fragment>
  }
`;

// ============================================================
// Geração das instâncias
// ============================================================

interface TileData {
  key: string;
  origin: [number, number, number];
  count: number;
  matrices: Float32Array;
  tints: Float32Array;
  phases: Float32Array;
}

/**
 * Constrói um tile pelas suas coordenadas de grade.
 *
 * Determinístico: a seed sai de `ti`/`tj`, então o mesmo par sempre produz a
 * mesma grama. É o que permite descartar e reconstruir tiles conforme a
 * câmera anda sem que a paisagem mude por baixo.
 */
function buildTile(ti: number, tj: number): TileData | null {
  const terrain = getTerrain();

  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();
  const identity = new THREE.Quaternion();
  const qTerrain = new THREE.Quaternion();
  const qTilt = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();
  const color = new THREE.Color();

  const originX = (ti + 0.5) * TILE_SIZE;
  const originZ = (tj + 0.5) * TILE_SIZE;

  const rng = createRNG(SEED + ti * 7919 + tj * 104_729);

  const capacity = TUFTS_PER_TILE * BLADES_PER_TUFT;
  const matrices = new Float32Array(capacity * 16);
  const tints = new Float32Array(capacity * 3);
  const phases = new Float32Array(capacity);
  let written = 0;

  for (let t = 0; t < TUFTS_PER_TILE; t++) {
    const tuftX = originX + (rng() - 0.5) * TILE_SIZE;
    const tuftZ = originZ + (rng() - 0.5) * TILE_SIZE;

    // Rejeições avaliadas por tufo, não por talo — 5x mais barato
    if (Math.hypot(tuftX, tuftZ) < TRUNK_CLEARANCE) continue;
    if (terrain.slopeAt(tuftX, tuftZ) > MAX_SLOPE) continue;

    // A cor do solo naquele ponto, puxada para verde de folha
    const [gr, gg, gb] = terrain.colorAt(tuftX, tuftZ);
    color.setRGB(gr, gg, gb).lerp(GRASS_GREEN, GRASS_GREEN_MIX);

    for (let b = 0; b < BLADES_PER_TUFT; b++) {
      const x = tuftX + (rng() - 0.5) * TUFT_SPREAD;
      const z = tuftZ + (rng() - 0.5) * TUFT_SPREAD;
      const y = terrain.heightAt(x, z);

      const n = terrain.normalAt(x, z);
      normal.set(n[0], n[1], n[2]);

      qTerrain.setFromUnitVectors(up, normal);
      qTilt.slerpQuaternions(identity, qTerrain, TERRAIN_ALIGNMENT);
      qYaw.setFromAxisAngle(up, rng() * Math.PI * 2);

      const height = lerp(BLADE_MIN_HEIGHT, BLADE_MAX_HEIGHT, rng());
      const width = 0.8 + rng() * 0.45;

      // Posição relativa ao tile: mantém as matrizes em números pequenos
      dummy.position.set(x - originX, y, z - originZ);
      dummy.quaternion.copy(qTilt).multiply(qYaw);
      dummy.scale.set(width, height, width);
      dummy.updateMatrix();
      dummy.matrix.toArray(matrices, written * 16);

      // Variação de brilho por talo, senão o tufo vira uma mancha chapada
      const jitter = 0.82 + rng() * 0.36;
      tints[written * 3] = color.r * jitter;
      tints[written * 3 + 1] = color.g * jitter;
      tints[written * 3 + 2] = color.b * jitter;

      phases[written] = rng() * Math.PI * 2;
      written++;
    }
  }

  if (written === 0) return null;

  return {
    key: `${ti}_${tj}`,
    origin: [originX, 0, originZ],
    count: written,
    matrices: matrices.subarray(0, written * 16),
    tints: tints.subarray(0, written * 3),
    phases: phases.subarray(0, written),
  };
}

// ============================================================
// Componentes
// ============================================================

function GrassTile({
  tile,
  preset,
}: {
  tile: TileData;
  preset: AtmospherePreset;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const geometry = useMemo(() => {
    const geom = createBladeGeometry();
    geom.setAttribute(
      'aTint',
      new THREE.InstancedBufferAttribute(tile.tints, 3),
    );
    geom.setAttribute(
      'aPhase',
      new THREE.InstancedBufferAttribute(tile.phases, 1),
    );
    return geom;
  }, [tile]);

  const uniforms = useMemo(() => createGrassUniforms(), []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    (mesh.instanceMatrix.array as Float32Array).set(tile.matrices);
    mesh.instanceMatrix.needsUpdate = true;

    // Com as matrizes no lugar, a esfera envolvente fica correta e o frustum
    // culling passa a funcionar de verdade.
    mesh.computeBoundingSphere();
  }, [tile]);

  // Trocar de atmosfera só mexe em uniforms — nunca reconstrói os talos
  useEffect(() => {
    if (!materialRef.current) return;
    const u = materialRef.current.uniforms;

    u.uTint.value.set(preset.grassTint);
    u.uSunColor.value.set(preset.sun.color);
    u.uSunHeight.value = Math.max(
      new THREE.Vector3(...preset.sun.direction).normalize().y,
      0,
    );
  }, [preset]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state) => {
    if (!materialRef.current) return;
    materialRef.current.uniforms.uTime.value = state.clock.getElapsedTime();
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, tile.count]}
      position={tile.origin}
      castShadow={false}
      receiveShadow={false}
    >
      <shaderMaterial
        ref={materialRef}
        vertexShader={grassVertexShader}
        fragmentShader={grassFragmentShader}
        uniforms={uniforms}
        fog
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}

/**
 * Cada tile tem o seu próprio material. Parece desperdício, mas o Three
 * compartilha o programa de shader compilado entre materiais de mesmo código —
 * o que se duplica é só o bloco de uniforms, e em troca cada material pode ser
 * mutado através da sua própria ref, que é o único caminho de escrita que o
 * React permite fora da renderização.
 */
function createGrassUniforms() {
  return THREE.UniformsUtils.merge([
    // Sem os uniforms de fog aqui, o renderer não tem onde escrever a cor e a
    // distância da neblina, e a grama não se integra ao horizonte.
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uWindStrength: { value: 1 },
      uWindDir: { value: new THREE.Vector2(1, 0.35).normalize() },
      uTint: { value: new THREE.Color('#ffffff') },
      uSunColor: { value: new THREE.Color('#ffffff') },
      uSunHeight: { value: 1 },
    },
  ]);
}

/**
 * Cache de tiles já construídos, em escopo de módulo.
 *
 * Fora da store e fora do componente porque o conteúdo é função pura das
 * coordenadas de grade: caminhar de ida e volta reaproveita o que já foi
 * calculado, e nada disso precisa provocar renderização.
 */
const cacheTiles = new Map<string, TileData | null>();

/**
 * Teto do cache.
 *
 * Cada tile guarda ~4 mil talos, ou algo como 320 KB de typed arrays. Sem
 * teto, atravessar a paisagem de ponta a ponta acumularia centenas de tiles e
 * dezenas de megabytes que nunca mais seriam desenhados. Cinquenta cobre a
 * grade visível (25) mais o rastro recente, de modo que voltar sobre os
 * próprios passos ainda reaproveita.
 */
const MAX_TILES_CACHE = 50;

/** Descarta os tiles mais distantes do centro quando o cache estoura. */
function podarCache(ci: number, cj: number): void {
  if (cacheTiles.size <= MAX_TILES_CACHE) return;

  const porDistancia = [...cacheTiles.keys()]
    .map((key) => {
      const [ti, tj] = key.split('_').map(Number);
      return { key, d: Math.hypot(ti - ci, tj - cj) };
    })
    .sort((a, b) => b.d - a.d);

  for (const { key } of porDistancia) {
    if (cacheTiles.size <= MAX_TILES_CACHE) break;
    cacheTiles.delete(key);
  }
}

/** Coordenada de grade de um ponto do mundo. */
function celula(v: number): number {
  return Math.floor(v / TILE_SIZE);
}

export function Grass() {
  const atmosphereId = useSceneStore((s) => s.atmosphere);
  const preset = useMemo(() => getAtmosphere(atmosphereId), [atmosphereId]);

  const controls = useThree((s) => s.controls) as {
    target?: THREE.Vector3;
  } | null;
  const camera = useThree((s) => s.camera);

  const [tiles, setTiles] = useState<TileData[]>([]);

  /**
   * Centro da grade na última reavaliação, para só reagir quando muda.
   *
   * Começa em `NaN` de propósito: qualquer comparação com `NaN` é falsa, o que
   * força a primeira avaliação a montar a fila. Inicializado em `[0, 0]`, o
   * primeiro quadro achava que já estava no lugar certo e a grade nunca era
   * preenchida — sobrava a grama que tivesse sido semeada à mão.
   */
  const centro = useRef<[number, number]>([NaN, NaN]);
  /** Tiles que faltam construir, em ordem de proximidade do centro. */
  const fila = useRef<[number, number][]>([]);

  /**
   * Publica os tiles da janela atual.
   *
   * A comparação com o estado anterior evita renderizar de novo quando nada
   * mudou — este caminho é percorrido a cada quadro em que a fila anda.
   */
  const publicar = useCallback((ci: number, cj: number) => {
    const visiveis: TileData[] = [];
    for (let di = -TILE_RING; di <= TILE_RING; di++) {
      for (let dj = -TILE_RING; dj <= TILE_RING; dj++) {
        const t = cacheTiles.get(`${ci + di}_${cj + dj}`);
        if (t) visiveis.push(t);
      }
    }
    setTiles((anterior) =>
      anterior.length === visiveis.length &&
      anterior.every((t, i) => t === visiveis[i])
        ? anterior
        : visiveis,
    );
  }, []);

  useFrame(() => {
    const alvo = controls?.target;
    const px = alvo ? alvo.x : camera.position.x;
    const pz = alvo ? alvo.z : camera.position.z;

    const ci = celula(px);
    const cj = celula(pz);

    if (ci !== centro.current[0] || cj !== centro.current[1]) {
      centro.current = [ci, cj];

      // Refaz a fila do zero: a lista anterior era relativa a um centro que
      // já não vale, e insistir nela construiria tiles fora da janela.
      fila.current = [];
      for (let di = -TILE_RING; di <= TILE_RING; di++) {
        for (let dj = -TILE_RING; dj <= TILE_RING; dj++) {
          const key = `${ci + di}_${cj + dj}`;
          if (!cacheTiles.has(key)) fila.current.push([ci + di, cj + dj]);
        }
      }
      // Do centro para fora: o que está debaixo do nariz aparece primeiro
      fila.current.sort(
        (a, b) =>
          Math.hypot(a[0] - ci, a[1] - cj) - Math.hypot(b[0] - ci, b[1] - cj),
      );
      podarCache(ci, cj);
      publicar(ci, cj);
    }

    if (fila.current.length === 0) return;

    for (let n = 0; n < TILES_POR_QUADRO && fila.current.length > 0; n++) {
      const [ti, tj] = fila.current.shift()!;
      cacheTiles.set(`${ti}_${tj}`, buildTile(ti, tj));
    }
    publicar(ci, cj);
  });

  return (
    <group>
      {tiles.map((tile) => (
        <GrassTile key={tile.key} tile={tile} preset={preset} />
      ))}
    </group>
  );
}
