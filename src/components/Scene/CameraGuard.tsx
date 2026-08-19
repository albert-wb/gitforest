/**
 * GitForest — Trava de Câmera
 *
 * Com o chão plano, um `maxPolarAngle` pouco maior que 90° era inofensivo.
 * Com relevo, ele deixa a câmera atravessar a encosta e enxergar o terreno
 * por dentro. Limitar o ângulo sozinho não resolve: mesmo acima do horizonte
 * a câmera pode entrar num morro ao orbitar.
 *
 * A solução é consultar o mesmo `heightAt()` que gerou a malha e empurrar a
 * câmera para cima quando ela chega perto demais do solo. Roda em prioridade
 * padrão, ou seja, depois do `OrbitControls` (que usa prioridade -1) ter
 * escrito a posição do frame.
 */

import { useFrame } from '@react-three/fiber';
import { getTerrain } from '../../world/terrain';

interface CameraGuardProps {
  /** Folga mínima entre a câmera e a superfície, em unidades de mundo. */
  clearance?: number;
}

export function CameraGuard({ clearance = 1.5 }: CameraGuardProps) {
  const terrain = getTerrain();

  useFrame(({ camera }) => {
    const floor =
      terrain.heightAt(camera.position.x, camera.position.z) + clearance;
    if (camera.position.y < floor) {
      camera.position.y = floor;
    }
  });

  return null;
}
