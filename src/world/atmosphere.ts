/**
 * GitForest — Atmosfera
 *
 * Céu, luz e neblina definidos num lugar só.
 *
 * Antes desta refatoração as cores da cena viviam espalhadas por quatro
 * arquivos: o gradiente do céu no fragment shader, as luzes no SceneSetup, a
 * cor de fundo no App e a neblina num quinto lugar ainda. O resultado era uma
 * neblina roxa (#1a1a2e) desbotando geometria contra um horizonte laranja —
 * inofensivo enquanto não havia nada distante na cena, e fatal no instante em
 * que morros entraram.
 *
 * A regra agora é: neblina, céu e luz saem sempre do mesmo preset. Trocar de
 * hora do dia é trocar um identificador, não editar cinco arquivos.
 *
 * ⚠️ `fog.far` precisa ficar abaixo do raio da borda do terreno detalhado
 * (`TerrainConfig.size / 2`), senão a borda da malha fica visível. Ver
 * `HORIZON_RING_INNER` em `Landscape.tsx`.
 */

export type AtmosphereId = 'amanhecer' | 'goldenHour' | 'meioDia' | 'noite';

export interface AtmospherePreset {
  id: AtmosphereId;
  nome: string;
  icone: string;

  /** Faixas do gradiente do céu, da abóbada até o horizonte */
  sky: {
    top: string;
    mid: string;
    horizon: string;
    sun: string;
    /** Intensidade do brilho difuso do sol perto do horizonte */
    sunGlow: number;
    /** 0 = sem estrelas, 1 = céu noturno cheio */
    stars: number;
  };

  /** Luz principal direcional (sol ou lua). `direction` aponta da cena para a luz. */
  sun: {
    direction: [number, number, number];
    color: string;
    intensity: number;
  };

  /** Ambiente hemisférico: substitui o HDRI de CDN que era baixado em runtime */
  hemisphere: {
    sky: string;
    ground: string;
    intensity: number;
  };

  /** Luz de preenchimento fria, vinda do lado oposto */
  fill: {
    direction: [number, number, number];
    color: string;
    intensity: number;
  };

  /** A cor daqui é a mesma que fecha o horizonte — é o que costura céu e terreno */
  fog: {
    color: string;
    near: number;
    far: number;
  };

  bloom: {
    intensity: number;
    threshold: number;
  };

  /** Cor base das silhuetas de montanha ao fundo, antes do desbotamento */
  hills: string;

  /** Multiplicador de cor aplicado à grama, para casá-la com a hora do dia */
  grassTint: string;
}

export const ATMOSPHERES: Record<AtmosphereId, AtmospherePreset> = {
  amanhecer: {
    id: 'amanhecer',
    nome: 'Amanhecer',
    icone: '🌄',
    sky: {
      top: '#1b2a4a',
      mid: '#46557e',
      horizon: '#d59a86',
      sun: '#ffd9b8',
      sunGlow: 0.35,
      stars: 0.18,
    },
    sun: {
      direction: [6, 7, -9],
      color: '#ffe3cc',
      intensity: 1.05,
    },
    hemisphere: { sky: '#b9d0ea', ground: '#40503a', intensity: 0.7 },
    fill: { direction: [-6, 6, 5], color: '#8fa8d8', intensity: 0.35 },
    // Névoa rasa e densa: a assinatura do amanhecer
    fog: { color: '#9aa6bd', near: 45, far: 240 },
    bloom: { intensity: 0.3, threshold: 0.78 },
    hills: '#5f6f8c',
    grassTint: '#cfe0ee',
  },

  goldenHour: {
    id: 'goldenHour',
    nome: 'Golden Hour',
    icone: '🌅',
    sky: {
      top: '#141429',
      mid: '#261a40',
      horizon: '#8c4026',
      sun: '#f28c33',
      sunGlow: 0.5,
      stars: 0.04,
    },
    sun: {
      direction: [8, 6, 5],
      color: '#ffd4a0',
      intensity: 1.45,
    },
    hemisphere: { sky: '#ffc9a0', ground: '#3a4a2e', intensity: 0.5 },
    fill: { direction: [-5, 8, -3], color: '#87ceeb', intensity: 0.32 },
    fog: { color: '#7a4530', near: 80, far: 285 },
    bloom: { intensity: 0.35, threshold: 0.75 },
    hills: '#4a3350',
    grassTint: '#ffe0b0',
  },

  meioDia: {
    id: 'meioDia',
    nome: 'Meio-dia',
    icone: '☀️',
    sky: {
      top: '#2f6fb5',
      mid: '#6aa7d8',
      horizon: '#cfe3ee',
      sun: '#ffffff',
      sunGlow: 0.12,
      stars: 0,
    },
    sun: {
      direction: [4, 16, 6],
      color: '#fff6e0',
      intensity: 1.9,
    },
    hemisphere: { sky: '#cfe6ff', ground: '#4a5a34', intensity: 0.6 },
    fill: { direction: [-8, 7, -6], color: '#a8c8e8', intensity: 0.25 },
    fog: { color: '#c3d8e4', near: 110, far: 290 },
    bloom: { intensity: 0.18, threshold: 0.9 },
    hills: '#8fa8b8',
    grassTint: '#ffffff',
  },

  noite: {
    id: 'noite',
    nome: 'Noite Estrelada',
    icone: '🌙',
    sky: {
      top: '#05060f',
      mid: '#0c1230',
      horizon: '#1d2a4a',
      sun: '#2a3a66',
      sunGlow: 0.08,
      stars: 1,
    },
    sun: {
      direction: [-6, 10, -4],
      color: '#9fb6e8',
      intensity: 0.55,
    },
    hemisphere: { sky: '#3a4a7a', ground: '#16201c', intensity: 0.35 },
    fill: { direction: [7, 5, 6], color: '#4a5f8f', intensity: 0.18 },
    fog: { color: '#121a33', near: 60, far: 260 },
    // Threshold baixo faz os vagalumes e as folhas claras estourarem no bloom
    bloom: { intensity: 0.6, threshold: 0.5 },
    hills: '#1a2340',
    grassTint: '#6f86b8',
  },
};

export const ATMOSPHERE_ORDER: AtmosphereId[] = [
  'amanhecer',
  'goldenHour',
  'meioDia',
  'noite',
];

export const DEFAULT_ATMOSPHERE: AtmosphereId = 'goldenHour';

export function getAtmosphere(id: AtmosphereId): AtmospherePreset {
  return ATMOSPHERES[id] ?? ATMOSPHERES[DEFAULT_ATMOSPHERE];
}

/** Próximo preset na ordem de exibição (usado pelo botão de ciclo). */
export function nextAtmosphere(id: AtmosphereId): AtmosphereId {
  const i = ATMOSPHERE_ORDER.indexOf(id);
  return ATMOSPHERE_ORDER[(i + 1) % ATMOSPHERE_ORDER.length];
}

/**
 * Distância da luz principal em relação à origem.
 * A direção do preset é normalizada e escalada por este valor, de modo que a
 * câmera de sombra tenha sempre o mesmo enquadramento independente do preset.
 */
export const SUN_DISTANCE = 90;
