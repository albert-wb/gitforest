/**
 * GitForest — Seleção de Árvores da Floresta
 *
 * Camada invisível de alvos de raycasting, uma por árvore de fundo.
 *
 * ## Por que uma camada separada, e não o clique na própria árvore
 *
 * A floresta inteira é desenhada como **uma** geometria mesclada de troncos
 * mais um `InstancedMesh` por formato de folha — é o que a mantém em duas
 * chamadas de desenho. O preço disso é que um raio que acerta essa malha não
 * diz *qual* árvore foi atingida: os vértices de setenta contas moram no
 * mesmo buffer, sem nada que os separe.
 *
 * Recuperar essa informação exigiria ou desmembrar a floresta em uma malha
 * por árvore (jogando fora o lote inteiro) ou carregar um atributo de índice
 * por vértice e ler de volta o triângulo atingido. Um cilindro invisível por
 * árvore é mais barato e muito mais simples de ler.
 *
 * ⚠️ **Um `InstancedMesh`, e não uma malha por árvore.** A primeira versão
 * usava um `<mesh>` por árvore, no molde de `Tree/BranchHitboxes`. Medindo, a
 * cena saltou de 32 para 99 chamadas de desenho com setenta árvores: cada
 * cilindro invisível, apesar de ter doze triângulos, custava uma chamada
 * inteira — a floresta que tanto trabalho deu para caber em duas passou a
 * gastar setenta em alvos que ninguém vê. Instanciado, o conjunto todo é uma
 * chamada, e `instanceId` no evento diz qual árvore foi atingida.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useForestStore, type ForestNode } from '../../store/useForestStore';

/**
 * Folga horizontal do cilindro de seleção.
 *
 * Um pouco maior que a copa de propósito: mirar numa árvore pequena a trinta
 * unidades de distância com o mouse é difícil, e errar o clique é bem pior do
 * que acertar a vizinha por engano.
 */
const PICK_PADDING = 1.35;

export function ForestPicking() {
  const nodes = useForestStore((s) => s.nodes);
  const hovered = useForestStore((s) => s.hovered);
  const setHovered = useForestStore((s) => s.setHovered);
  const select = useForestStore((s) => s.select);

  const meshRef = useRef<THREE.InstancedMesh>(null);

  const hoveredNode = useMemo(
    () => nodes.find((n) => n.login === hovered) ?? null,
    [nodes, hovered],
  );

  /**
   * Um cilindro unitário para todas as árvores; a matriz de cada instância é
   * que lhe dá altura e raio. Assim a geometria é criada uma vez só, e não a
   * cada lote que chega.
   */
  const geometry = useMemo(() => {
    const geom = new THREE.CylinderGeometry(1, 0.7, 1, 6, 1, true);
    // O cilindro nasce centrado na origem; deslocá-lo aqui deixa a matriz de
    // instância cuidar só de posição e escala.
    geom.translate(0, 0.5, 0);
    return geom;
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || nodes.length === 0) return;

    const dummy = new THREE.Object3D();
    nodes.forEach((node, i) => {
      const height = node.mesh.height * node.scale;
      const radius = Math.max(
        node.mesh.radius * node.scale * PICK_PADDING,
        0.8,
      );
      dummy.position.set(node.position[0], node.position[1], node.position[2]);
      dummy.scale.set(radius, height, radius);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });

    mesh.count = nodes.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [nodes]);

  if (nodes.length === 0) return null;

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        // `key` força uma malha nova quando a floresta cresce além da
        // capacidade alocada — `InstancedMesh` não realoca sozinho.
        key={nodes.length}
        args={[geometry, undefined, nodes.length]}
        onPointerMove={(e) => {
          e.stopPropagation();
          const node = nodes[e.instanceId ?? -1];
          if (!node) return;
          setHovered(node.login);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(null);
          document.body.style.cursor = 'default';
        }}
        onClick={(e) => {
          e.stopPropagation();
          const node = nodes[e.instanceId ?? -1];
          if (node) select(node.login);
        }}
      >
        {/* Invisível, mas presente para o raio: `visible={false}` esconderia
            a malha da lista de interação do R3F junto com o desenho. */}
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </instancedMesh>

      {hoveredNode && <HoverLabel node={hoveredNode} />}
    </group>
  );
}

/**
 * Prévia flutuante: quem é o dono, antes de clicar.
 *
 * Sem `distanceFactor`, ao contrário do tooltip da árvore em foco. Ali a
 * etiqueta acompanha a escala da cena porque a câmera fica sempre por perto;
 * aqui as árvores estão a dezenas de unidades e uma etiqueta que encolhe com
 * a distância ficaria ilegível justamente onde ela é mais necessária.
 */
function HoverLabel({ node }: { node: ForestNode }) {
  const height = node.mesh.height * node.scale;
  const { profile } = node;

  return (
    <Html
      position={[
        node.position[0],
        node.position[1] + height + 0.8,
        node.position[2],
      ]}
      center
      zIndexRange={[20, 10]}
      style={{ pointerEvents: 'none' }}
    >
      <div className="forest-hover">
        <img
          className="forest-hover__avatar"
          src={profile.avatarUrl}
          alt=""
          width={22}
          height={22}
        />
        <span className="forest-hover__login">{profile.login}</span>
        <span className="forest-hover__degree">
          {node.rank !== undefined
            ? `#${node.rank}`
            : node.degree === 1
              ? '1º grau'
              : '2º grau'}
        </span>
      </div>
    </Html>
  );
}
