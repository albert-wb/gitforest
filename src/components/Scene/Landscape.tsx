/**
 * GitForest — Paisagem
 *
 * Agrupa tudo que forma o cenário, na ordem em que o olho lê a cena:
 * terreno detalhado → fecho do horizonte → morros distantes → grama.
 *
 * Substitui o antigo `Ground.tsx` (um disco verde chapado de raio 15 com 300
 * triângulos de grama).
 */

import { TerrainMesh, HorizonRing } from './Terrain';
import { DistantHills } from './DistantHills';
import { Grass } from './Grass';

export function Landscape() {
  return (
    <group>
      <TerrainMesh />
      <HorizonRing />
      <DistantHills />
      <Grass />
    </group>
  );
}
