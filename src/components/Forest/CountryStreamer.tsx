/**
 * GitForest — Carregador Sob Demanda da Floresta de um País
 *
 * O ranking de um país passa de novecentas contas. Baixar e gerar tudo levaria
 * minutos de rede e encheria a memória com geometria que ninguém está olhando,
 * então a floresta carrega só o que está por perto de onde a câmera aponta e
 * devolve o resto (ver `LOAD_RADIUS`/`UNLOAD_RADIUS` em `useForestStore`).
 *
 * Este componente é só o gatilho: ele existe para transformar "onde a câmera
 * está" numa chamada periódica. A decisão de o que carregar e o que descartar
 * mora na store, onde estão os dados.
 *
 * O ponto de referência é o **alvo do OrbitControls**, e não a posição da
 * câmera. São coisas diferentes: com a câmera afastada olhando para o centro,
 * carregar ao redor dela encheria a cena de árvores atrás do observador e
 * deixaria vazio justamente o que ele está vendo.
 */

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { useForestStore } from '../../store/useForestStore';

/**
 * Intervalo entre verificações, em segundos.
 *
 * Não precisa ser por quadro: o raio de carga tem folga de catorze unidades
 * sobre o de descarga, o que dá tempo de sobra para a próxima leva chegar
 * antes de a câmera alcançar a borda do que já está carregado.
 */
const INTERVALO = 0.6;

export function CountryStreamer() {
  const mode = useForestStore((s) => s.mode);
  const streamAround = useForestStore((s) => s.streamAround);

  const controls = useThree((s) => s.controls) as {
    target?: THREE.Vector3;
  } | null;
  const camera = useThree((s) => s.camera);

  const acumulado = useRef(0);

  useFrame((_, delta) => {
    if (mode !== 'pais') return;

    acumulado.current += delta;
    if (acumulado.current < INTERVALO) return;
    acumulado.current = 0;

    const alvo = controls?.target;
    streamAround(
      alvo ? alvo.x : camera.position.x,
      alvo ? alvo.z : camera.position.z,
    );
  });

  return null;
}
