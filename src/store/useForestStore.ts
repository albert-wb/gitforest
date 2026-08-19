/**
 * GitForest — Store da Floresta
 *
 * Enquanto `useTreeStore` guarda **uma** árvore (a que está em foco, com
 * geometria completa e interação), esta store guarda as **outras** — dezenas
 * ou centenas delas, em nível de detalhe reduzido, com os buffers já prontos
 * vindos do worker.
 *
 * A separação é proposital: a árvore em foco tem shader de casca, hitboxes e
 * tooltip; as de fundo existem para dar contexto e são desenhadas em lote.
 * Misturar as duas numa estrutura só obrigaria a pagar o custo da primeira
 * em todas.
 *
 * ## Dois modos, uma cena
 *
 * - **Amizades** (`growForest`): as conexões de uma conta, algumas dezenas de
 *   árvores, todas carregadas de uma vez.
 * - **País** (`growCountry`): o ranking de contribuidores de um país, que
 *   passa de novecentas contas só no Brasil. Aqui carregar tudo está fora de
 *   questão, e as árvores entram e saem conforme a câmera se move (ver
 *   `streamAround`).
 *
 * Os dois escrevem no **mesmo** `nodes`. É o que faz a renderização em lote, a
 * seleção por clique e o cartão da conta funcionarem nos dois modos sem uma
 * linha de código a mais.
 */

import { create } from 'zustand';
import type { GitHubUser } from '../engine/types';
import type { TreeJobResponse } from '../workers/treeWorker';
import type { ConnectionMode } from '../api/forest';
import {
  fetchForestGraph,
  fetchLiteProfiles,
  STREAM_CONCURRENCY,
} from '../api/forest';
import { fetchCountryUsers, type Country } from '../api/topUsers';
import { normalizeUserData } from '../api/normalizer';
import { layoutForest, type TreePlacement } from '../world/forestLayout';
import { layoutCountry, type CountryPlacement } from '../world/countryLayout';
import { generateTreeAsync, clearTreeQueue } from '../engine/treePool';
import { sceneNow } from '../utils/clock';
import { useSceneStore } from './useSceneStore';

export type ForestStatus = 'idle' | 'discovering' | 'growing' | 'ready' | 'error';

/** `'pais'` acompanha os modos de conexão de `api/forest`. */
export type ForestMode = ConnectionMode | 'pais';

export interface ForestNode {
  login: string;
  degree: 1 | 2;
  position: [number, number, number];
  scale: number;
  mesh: TreeJobResponse;
  /**
   * Perfil reduzido de quem é dono desta árvore.
   *
   * Fica no nó, e não numa busca separada por login, porque o dado já foi
   * baixado para gerar a árvore — guardá-lo é de graça e é o que permite
   * abrir o cartão da conta no clique sem nenhuma ida à rede.
   */
  profile: GitHubUser;
  /** Posição no ranking do país. Ausente no modo de amizades. */
  rank?: number;
  /**
   * Instante em que a árvore entrou na cena, no relógio compartilhado.
   * O shader deriva daqui o progresso do brotar, sem nenhum trabalho por
   * quadro. Marcado na store, e não no componente, porque ler um ref durante
   * a renderização é justamente o que o React proíbe.
   */
  bornAt: number;
}

/** Aresta do grafo, usada pela rede micorrízica. */
export interface ForestEdge {
  from: [number, number, number];
  to: [number, number, number];
  degree: 1 | 2;
}

/** O que basta para plantar uma árvore, venha ela de qual modo vier. */
interface PlantTarget {
  position: [number, number, number];
  scale: number;
  degree: 1 | 2;
  lod: 1 | 2;
  rank?: number;
}

// ============================================================
// Carregamento sob demanda (modo país)
// ============================================================

/**
 * Raio, ao redor do ponto para onde a câmera olha, dentro do qual as árvores
 * são carregadas.
 *
 * Quantas árvores isso significa sai direto de `countryLayout`:
 * `((RAIO − INNER)/SPACING)²`, ou seja `((40 − 8)/2,5)² ≈ 164`.
 *
 * O teto vem de medição, não de palpite. Uma árvore de fundo custa por volta
 * de 11 mil triângulos, então 164 delas somam ~1,8 milhão — mais a paisagem e
 * a grama, a cena fica na casa dos 2,2 milhões, que é o que uma GPU modesta
 * desenha com folga dado que os shaders aqui são simples e tudo vai em poucas
 * chamadas de desenho. Dobrar o raio **quadruplicaria** a contagem, porque o
 * que cresce é a área.
 */
const LOAD_RADIUS = 40;

/**
 * Além deste raio as árvores são descarregadas.
 *
 * A folga em relação ao raio de carga existe para evitar histerese: com os
 * dois iguais, uma árvore na fronteira entraria e sairia a cada tremida da
 * câmera, e cada entrada custa uma ida à rede e uma geração no worker.
 */
const UNLOAD_RADIUS = 56;

/** Teto absoluto de árvores vivas, caso a densidade suba. */
const MAX_LIVE = 240;

/**
 * Quantas árvores pedir por rodada de carregamento.
 *
 * Múltiplo do produto entre o tamanho do lote (4) e a concorrência (5), para
 * que uma rodada seja exatamente uma leva de requisições em paralelo e não
 * sobre um lote solitário fazendo a rodada inteira esperar por ele.
 */
const STREAM_CHUNK = 20;

/**
 * Sessão corrente da floresta e estado do carregamento sob demanda.
 *
 * Vivem em escopo de módulo, e não como campos da store, porque nenhum
 * componente precisa reagir a eles — colocá-los no estado provocaria uma
 * renderização a cada tique do carregador, que roda várias vezes por segundo.
 */
let session = '';

let friends: {
  session: string;
  placements: TreePlacement[];
  profiles: GitHubUser[];
} | null = null;

let stream: {
  session: string;
  token?: string;
  placements: CountryPlacement[];
  /** Já na cena. */
  loaded: Set<string>;
  /** Em voo: pedidas à rede ou ao worker, ainda não plantadas. */
  pending: Set<string>;
  busy: boolean;
} | null = null;

interface ForestStore {
  status: ForestStatus;
  error: string | null;
  /** Login no centro da floresta de amizades. Nulo no modo país. */
  root: string | null;
  /** País em exibição. Nulo no modo de amizades. */
  country: Country | null;
  mode: ForestMode | null;

  /** Quantas árvores foram descobertas e quantas já brotaram. */
  discovered: number;
  grown: number;
  /** Lotes de perfil que o GitHub não entregou — vira claro na floresta. */
  failedBatches: number;

  nodes: ForestNode[];
  edges: ForestEdge[];

  /** Contador incrementado a cada lote — os componentes 3D observam isto. */
  revision: number;

  /** Login da árvore com o cursor em cima (null = nenhuma). */
  hovered: string | null;
  /** Login da árvore clicada, cujo cartão está aberto. */
  selected: string | null;

  setHovered: (login: string | null) => void;
  select: (login: string | null) => void;

  growForest: (root: string, token?: string) => Promise<void>;
  growCountry: (country: Country, token?: string) => Promise<void>;
  /**
   * Carrega e descarrega árvores ao redor de um ponto do terreno.
   *
   * Chamada pelo `CountryStreamer` a partir da câmera. Sai na hora quando não
   * há nada a fazer, então pode ser chamada com frequência.
   */
  streamAround: (x: number, z: number) => void;
  /**
   * Replanta a floresta já descoberta com a espécie corrente, sem rede.
   *
   * Trocar de espécie é uma escolha visual; os perfis do GitHub não mudaram
   * por causa dela. Refazer a busca custaria dezenas de requisições a cada
   * clique no painel de estilo e ainda esbarraria no limite da API.
   */
  replantForest: () => void;
  clearForest: () => void;
}

const EMPTY = {
  error: null,
  nodes: [] as ForestNode[],
  edges: [] as ForestEdge[],
  hovered: null,
  selected: null,
  discovered: 0,
  grown: 0,
  failedBatches: 0,
};

export const useForestStore = create<ForestStore>((set, get) => ({
  status: 'idle',
  error: null,
  root: null,
  country: null,
  mode: null,
  discovered: 0,
  grown: 0,
  failedBatches: 0,
  nodes: [],
  edges: [],
  revision: 0,
  hovered: null,
  selected: null,

  setHovered: (login) => set({ hovered: login }),
  select: (login) => set({ selected: login }),

  // ---------- Modo amizades ----------

  growForest: async (root, token) => {
    clearTreeQueue();
    stream = null;
    session = `user:${root}`;
    const mine = session;

    set({
      ...EMPTY,
      status: 'discovering',
      root,
      country: null,
      mode: null,
      revision: get().revision + 1,
    });

    try {
      const graph = await fetchForestGraph(root, token);
      if (session !== mine) return;

      const placements = layoutForest(
        graph.root,
        graph.firstDegree,
        graph.secondDegree,
        graph.sharedCount,
      );

      friends = { session: mine, placements, profiles: [] };

      set({
        status: 'growing',
        mode: graph.mode,
        discovered: placements.length,
        edges: buildEdges(placements),
      });

      const targets = friendTargets(placements);

      // Perfis chegam em lotes; cada lote vira árvores que brotam de imediato
      const { failedBatches } = await fetchLiteProfiles(
        placements.map((p) => p.login),
        token,
        (users) => {
          // Guardar os perfis é o que permite replantar depois sem rede
          if (friends?.session === mine) friends.profiles.push(...users);
          void plantProfiles(users, targets, mine);
        },
        STREAM_CONCURRENCY,
      );

      if (session !== mine) return;
      set({ status: 'ready', failedBatches });
    } catch (err) {
      if (session !== mine) return;
      set({ status: 'error', error: mensagem(err, 'Erro ao montar a floresta') });
    }
  },

  // ---------- Modo país ----------

  growCountry: async (country, token) => {
    clearTreeQueue();
    friends = null;
    session = `country:${country.slug}`;
    const mine = session;

    set({
      ...EMPTY,
      status: 'discovering',
      root: null,
      country,
      // A rede micorrízica fica de fora: ela representa conexões reais entre
      // contas, e estar no ranking do mesmo país não é uma conexão. Desenhar
      // fios entre estranhos seria inventar um dado que não existe.
      mode: 'pais',
      revision: get().revision + 1,
    });

    try {
      const users = await fetchCountryUsers(country.slug);
      if (session !== mine) return;

      const placements = layoutCountry(country.slug, users);

      stream = {
        session: mine,
        token,
        placements,
        loaded: new Set(),
        pending: new Set(),
        busy: false,
      };

      set({ status: 'growing', discovered: placements.length });

      // A primeira leva sai do centro: é para lá que a câmera aponta ao abrir
      get().streamAround(0, 0);
    } catch (err) {
      if (session !== mine) return;
      set({ status: 'error', error: mensagem(err, 'Erro ao carregar o país') });
    }
  },

  streamAround: (x, z) => {
    const s = stream;
    if (!s || s.session !== session || s.busy) return;

    // ---- Descarregar o que ficou para trás ----
    const nodes = get().nodes;
    const sobreviventes = nodes.filter(
      (n) => Math.hypot(n.position[0] - x, n.position[2] - z) <= UNLOAD_RADIUS,
    );

    if (sobreviventes.length !== nodes.length) {
      for (const n of nodes) {
        if (!sobreviventes.includes(n)) s.loaded.delete(n.login);
      }
      set((state) => ({
        nodes: sobreviventes,
        grown: sobreviventes.length,
        revision: state.revision + 1,
        // A árvore selecionada pode ter acabado de sair de cena
        selected: sobreviventes.some((n) => n.login === state.selected)
          ? state.selected
          : null,
      }));
    }

    if (s.loaded.size + s.pending.size >= MAX_LIVE) return;

    // ---- Escolher as próximas, das mais próximas para as mais distantes ----
    const candidatos = s.placements
      .filter(
        (p) =>
          !s.loaded.has(p.login) &&
          !s.pending.has(p.login) &&
          Math.hypot(p.position[0] - x, p.position[2] - z) <= LOAD_RADIUS,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.position[0] - x, a.position[2] - z) -
          Math.hypot(b.position[0] - x, b.position[2] - z),
      )
      .slice(0, STREAM_CHUNK);

    if (candidatos.length === 0) {
      if (get().status === 'growing') set({ status: 'ready' });
      return;
    }

    const mine = s.session;
    const targets = countryTargets(candidatos);
    for (const p of candidatos) s.pending.add(p.login);
    s.busy = true;
    set({ status: 'growing' });

    void fetchLiteProfiles(
      candidatos.map((p) => p.login),
      s.token,
      (users) => {
        void plantProfiles(users, targets, mine).then(() => {
          if (stream?.session !== mine) return;
          for (const u of users) {
            stream.pending.delete(u.login);
            stream.loaded.add(u.login);
          }
        });
      },
      STREAM_CONCURRENCY,
    )
      .then(({ failedBatches }) => {
        if (stream?.session !== mine) return;
        // Quem não voltou sai da fila; se estiver por perto na próxima
        // rodada, será pedido de novo.
        for (const p of candidatos) stream.pending.delete(p.login);
        stream.busy = false;
        if (failedBatches > 0) {
          set((st) => ({ failedBatches: st.failedBatches + failedBatches }));
        }
      })
      .catch(() => {
        if (stream?.session !== mine) return;
        for (const p of candidatos) stream.pending.delete(p.login);
        stream.busy = false;
      });
  },

  // ---------- Comum ----------

  replantForest: () => {
    // No modo país o replantio acontece sozinho: basta esvaziar a cena, e o
    // carregador põe tudo de volta com a espécie nova na rodada seguinte.
    if (stream?.session === session) {
      clearTreeQueue();
      stream.loaded.clear();
      stream.pending.clear();
      stream.busy = false;
      set((state) => ({
        ...EMPTY,
        discovered: state.discovered,
        status: 'growing',
        revision: state.revision + 1,
      }));
      return;
    }

    const f = friends;
    if (!f || f.session !== session || f.profiles.length === 0) return;

    clearTreeQueue();
    // As árvores somem e voltam brotando: a troca de espécie fica legível
    // como um replantio, e não como um piscar de tela.
    set((state) => ({
      nodes: [],
      grown: 0,
      status: 'growing',
      hovered: null,
      selected: null,
      revision: state.revision + 1,
    }));

    const mine = f.session;
    void plantProfiles(f.profiles, friendTargets(f.placements), mine).then(() => {
      if (session === mine) set({ status: 'ready' });
    });
  },

  clearForest: () => {
    clearTreeQueue();
    friends = null;
    stream = null;
    session = '';
    set((state) => ({
      ...EMPTY,
      status: 'idle',
      root: null,
      country: null,
      mode: null,
      revision: state.revision + 1,
    }));
  },
}));

// ============================================================
// Auxiliares
// ============================================================

function mensagem(err: unknown, padrao: string): string {
  return err instanceof Error ? err.message : padrao;
}

function friendTargets(placements: TreePlacement[]): Map<string, PlantTarget> {
  return new Map(
    placements.map((p) => [
      p.login,
      {
        position: p.position,
        scale: p.scale,
        degree: p.degree,
        lod: p.degree,
      },
    ]),
  );
}

function countryTargets(
  placements: CountryPlacement[],
): Map<string, PlantTarget> {
  return new Map(
    placements.map((p) => [
      p.login,
      {
        position: p.position,
        scale: p.scale,
        // O topo do ranking ganha árvore em detalhe cheio: são as maiores da
        // cena e ficam no centro, onde a câmera começa.
        degree: p.rank <= 40 ? 1 : 2,
        lod: p.rank <= 40 ? 1 : 2,
        rank: p.rank,
      } satisfies PlantTarget,
    ]),
  );
}

/**
 * Ligações da rede micorrízica: raiz → primeiro grau, e primeiro grau →
 * segundo grau (cada um ao vizinho de primeiro grau mais próximo, que é uma
 * boa aproximação de por onde a conexão passou).
 */
function buildEdges(placements: TreePlacement[]): ForestEdge[] {
  const first = placements.filter((p) => p.degree === 1);
  const edges: ForestEdge[] = [];

  for (const p of placements) {
    if (p.degree === 1) {
      edges.push({ from: [0, 0, 0], to: p.position, degree: 1 });
      continue;
    }

    let nearest = first[0];
    let best = Infinity;
    for (const q of first) {
      const d = Math.hypot(
        q.position[0] - p.position[0],
        q.position[2] - p.position[2],
      );
      if (d < best) {
        best = d;
        nearest = q;
      }
    }
    if (nearest) edges.push({ from: nearest.position, to: p.position, degree: 2 });
  }

  return edges;
}

/**
 * Transforma perfis em árvores e as insere na cena.
 *
 * Existe fora da store porque todos os caminhos precisam exatamente do mesmo
 * comportamento — a floresta de amizades, o replantio por troca de espécie e o
 * carregamento sob demanda do modo país. Duplicar isso significaria manter
 * várias cópias da guarda contra a floresta ter sido trocada enquanto o worker
 * trabalhava, o tipo de detalhe que só some numa das cópias.
 *
 * ⚠️ **O lote inteiro entra num `set` só.** Cada alteração em `nodes` obriga
 * `Forest` a refazer a mesclagem de toda a geometria da cena; com uma
 * atualização por árvore, plantar N árvores custava N mesclagens de tamanho
 * crescente. Isso passava despercebido com setenta amigos e não passaria com
 * duzentas árvores entrando e saindo enquanto a câmera anda.
 *
 * A promessa resolve quando todos os trabalhos do lote terminam, bem ou mal.
 * Uma árvore que não nasce vira um claro na floresta, não um erro.
 */
async function plantProfiles(
  users: GitHubUser[],
  targets: Map<string, PlantTarget>,
  mine: string,
): Promise<void> {
  const speciesChoice = useSceneStore.getState().species;

  const resultados = await Promise.all(
    users.map(async (user): Promise<ForestNode | null> => {
      const target = targets.get(user.login);
      if (!target) return null;

      try {
        const mesh = await generateTreeAsync(
          user.login,
          normalizeUserData(user),
          speciesChoice,
          target.lod,
        );

        return {
          login: user.login,
          degree: target.degree,
          position: target.position,
          scale: target.scale,
          rank: target.rank,
          mesh,
          profile: user,
          bornAt: sceneNow(),
        };
      } catch {
        // Uma árvore que não nasce não invalida a floresta
        return null;
      }
    }),
  );

  const novos = resultados.filter((n): n is ForestNode => n !== null);
  if (novos.length === 0) return;

  // A floresta pode ter sido trocada enquanto os workers trabalhavam
  if (session !== mine) return;

  useForestStore.setState((state) => {
    // Uma rodada de carregamento pode se sobrepor à anterior; sem esta
    // checagem a mesma árvore entraria duas vezes na geometria mesclada.
    const jaNaCena = new Set(state.nodes.map((n) => n.login));
    const entrando = novos.filter((n) => !jaNaCena.has(n.login));
    if (entrando.length === 0) return state;

    return {
      nodes: [...state.nodes, ...entrando],
      grown: state.grown + entrando.length,
      revision: state.revision + 1,
    };
  });
}
