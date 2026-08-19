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
 * árvore custa setenta objetos simples de raycast — comparado a milhares de
 * triângulos de folha, é a opção barata *e* a mais simples de ler.
 *
 * O mesmo truque já é usado na árvore em foco (`Tree/BranchHitboxes`), pelo
 * mesmo motivo.
 */

import { useMemo } from 'react';
import { Html } from '@react-three/drei';
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

  const hoveredNode = useMemo(
    () => nodes.find((n) => n.login === hovered) ?? null,
    [nodes, hovered],
  );

  if (nodes.length === 0) return null;

  return (
    <group>
      {nodes.map((node) => {
        const height = node.mesh.height * node.scale;
        const radius = Math.max(node.mesh.radius * node.scale * PICK_PADDING, 0.8);

        return (
          <mesh
            key={node.login}
            // O cilindro nasce centrado na origem, então sobe meia altura
            position={[
              node.position[0],
              node.position[1] + height / 2,
              node.position[2],
            ]}
            onPointerEnter={(e) => {
              e.stopPropagation();
              setHovered(node.login);
              document.body.style.cursor = 'pointer';
            }}
            onPointerLeave={() => {
              setHovered(null);
              document.body.style.cursor = 'default';
            }}
            onClick={(e) => {
              e.stopPropagation();
              select(node.login);
            }}
          >
            <cylinderGeometry args={[radius, radius * 0.7, height, 6, 1, true]} />
            {/* Invisível, mas presente para o raio: `visible={false}` tiraria
                o objeto da cena e com ele o clique. */}
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        );
      })}

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
