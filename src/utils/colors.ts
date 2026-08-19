/**
 * GitForest — Mapa de Cores por Linguagem
 *
 * Cores oficiais do GitHub para linguagens de programação.
 * Usadas para colorir as folhas/flores da árvore.
 */

export const LANGUAGE_COLORS: Record<string, string> = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572A5',
  Java: '#b07219',
  'C#': '#178600',
  'C++': '#f34b7d',
  C: '#555555',
  Go: '#00ADD8',
  Rust: '#dea584',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  Scala: '#c22d40',
  R: '#198CE7',
  Shell: '#89e051',
  Lua: '#000080',
  Perl: '#0298c3',
  Haskell: '#5e5086',
  Elixir: '#6e4a7e',
  Clojure: '#db5855',
  Erlang: '#B83998',
  'Objective-C': '#438eff',
  Vim: '#199f4b',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Jupyter: '#DA5B0B',
  Dockerfile: '#384d54',
  Makefile: '#427819',
  Zig: '#ec915c',
  Nim: '#ffc200',
  Julia: '#a270ba',
  OCaml: '#3be133',
  F: '#b845fc',
  Assembly: '#6E4C13',
  VHDL: '#adb2cb',
  Verilog: '#b2b7f8',
  Nix: '#7e7eff',
  PowerShell: '#012456',
  Terraform: '#5c4ee5',
};

/** Cor padrão para linguagens não mapeadas */
export const DEFAULT_LANGUAGE_COLOR = '#8b9dc3';

/**
 * Retorna a cor de uma linguagem (com fallback).
 */
export function getLanguageColor(language: string | null | undefined): string {
  if (!language) return DEFAULT_LANGUAGE_COLOR;
  return LANGUAGE_COLORS[language] ?? DEFAULT_LANGUAGE_COLOR;
}

/**
 * Converte hex para array RGB normalizado [0-1].
 */
export function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0.5, 0.5, 0.5];
  return [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255,
  ];
}

// ============================================================
// Tratamento de folhagem
// ============================================================

/** Abaixo desta saturação a linguagem não tem matiz que valha preservar. */
const ACHROMATIC_THRESHOLD = 0.16;

/**
 * Faixa em que uma cor ainda lê como folha viva.
 *
 * O teto de luminosidade é deliberadamente baixo: folha clara demais, somada
 * ao espalhamento subsuperficial do shader e ao contraluz do céu, desbota
 * para um pastel esbranquiçado que não lê como vegetação.
 */
const LEAF_SATURATION: [number, number] = [0.38, 0.85];
const LEAF_LIGHTNESS: [number, number] = [0.24, 0.48];

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;

  return [h / 6, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hueToRgb(p, q, h + 1 / 3),
    hueToRgb(p, q, h),
    hueToRgb(p, q, h - 1 / 3),
  ];
}

function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/**
 * Converte a cor oficial de uma linguagem numa cor que funcione como folha.
 *
 * O problema que isto resolve é concreto: a cor do C no GitHub é `#555555`.
 * Aplicada crua, uma árvore de C nasce com folhagem cinza-chumbo e parece
 * morta — foi exatamente o que aconteceu com a árvore padrão. O mesmo vale
 * para Lua (`#000080`, azul-marinho quase preto) e Ruby (`#701516`, vinho
 * escuro).
 *
 * A regra é preservar identidade sem abrir mão de parecer vegetação:
 *
 * - **Linguagem com matiz** (JavaScript amarelo, Rust laranja, Go ciano):
 *   mantém-se o matiz e só se puxam saturação e luminosidade para uma faixa
 *   plausível. Continua reconhecível.
 * - **Linguagem acromática** (C, Dockerfile): não há matiz a proteger, então
 *   ela adota a cor-base da espécie, guardando apenas o contraste claro/
 *   escuro original como variação.
 *
 * `tint` controla o quanto o resultado ainda é puxado para a espécie — é o
 * que permite à cerejeira ficar rosada sem apagar de todo as linguagens.
 */
export function toFoliageColor(
  languageHex: string,
  speciesBaseHex: string,
  tint: number,
): [number, number, number] {
  const base = hexToRgb(speciesBaseHex);

  // Repositório sem linguagem detectada. O azul-acinzentado de fallback não
  // representa nada — melhor deixar a folha simplesmente ser da espécie do
  // que fingir uma identidade que o dado não tem.
  if (languageHex.toLowerCase() === DEFAULT_LANGUAGE_COLOR.toLowerCase()) {
    return base;
  }

  const raw = hexToRgb(languageHex);
  const [h, s, l] = rgbToHsl(raw[0], raw[1], raw[2]);

  if (s < ACHROMATIC_THRESHOLD) {
    // Sem matiz para proteger: herda a espécie, guardando o claro/escuro
    const [bh, bs, bl] = rgbToHsl(base[0], base[1], base[2]);
    const shifted = clamp(bl + (l - 0.5) * 0.3, LEAF_LIGHTNESS[0], LEAF_LIGHTNESS[1]);
    return hslToRgb(bh, bs, shifted);
  }

  const leaf = hslToRgb(
    h,
    clamp(s, LEAF_SATURATION[0], LEAF_SATURATION[1]),
    clamp(l, LEAF_LIGHTNESS[0], LEAF_LIGHTNESS[1]),
  );

  return mix(leaf, base, clamp(tint, 0, 1));
}
