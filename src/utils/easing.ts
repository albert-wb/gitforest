/**
 * GitForest — Funções de Easing
 *
 * Curvas de animação avançadas para transições suaves.
 */

/** Ease-out cubic (desacelera suavemente) */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Ease-out elastic (quica como elástico) */
export function easeOutElastic(t: number): number {
  const c4 = (2 * Math.PI) / 3;
  if (t === 0) return 0;
  if (t === 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

/** Ease-out back (ultrapassa levemente e volta) */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Ease-in-out quart (suave nas duas pontas) */
export function easeInOutQuart(t: number): number {
  return t < 0.5
    ? 8 * t * t * t * t
    : 1 - Math.pow(-2 * t + 2, 4) / 2;
}

/** Ease-out quint (forte desaceleração) */
export function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

/**
 * Mapeia um progresso global (0-1) para uma sub-faixa.
 * Retorna 0 antes de `start`, 1 após `end`, e interpola entre eles.
 */
export function phaseProgress(
  globalProgress: number,
  start: number,
  end: number,
): number {
  if (globalProgress <= start) return 0;
  if (globalProgress >= end) return 1;
  return (globalProgress - start) / (end - start);
}
