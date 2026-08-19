/** TEMPORÁRIO — sonda de medição. Remover depois de calibrar. */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    __gf?: Record<string, number>;
  }
}

export function DebugProbe() {
  const gl = useThree((s) => s.gl);
  const frames = useRef(0);
  const tris = useRef(0);
  const calls = useRef(0);
  const acc = useRef(0);
  const last = useRef(performance.now());

  useEffect(() => {
    // Sem isto, `info` é zerado no início de cada `render()`, e com
    // pós-processamento a última passada é o quad de tela cheia — daí a
    // leitura de "1 triângulo, 1 draw call".
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);

  useFrame(() => {
    const now = performance.now();
    acc.current += now - last.current;
    last.current = now;

    tris.current += gl.info.render.triangles;
    calls.current += gl.info.render.calls;
    gl.info.reset();
    frames.current++;

    if (frames.current >= 20) {
      window.__gf = {
        ms: Math.round((acc.current / frames.current) * 10) / 10,
        triangles: Math.round(tris.current / frames.current),
        calls: Math.round(calls.current / frames.current),
        geometries: gl.info.memory.geometries,
      };
      frames.current = 0;
      tris.current = 0;
      calls.current = 0;
      acc.current = 0;
    }
  });

  return null;
}
