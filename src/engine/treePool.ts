/**
 * GitForest — Pool de Workers
 *
 * Distribui a geração das árvores entre alguns workers e devolve promessas.
 *
 * O número de workers é deliberadamente baixo. Gerar árvore é trabalho de CPU
 * puro; subir um worker por núcleo disputaria tempo com a própria thread de
 * renderização e derrubaria o framerate que este pool existe para preservar.
 */

import type { TreeParams } from './types';
import type { SpeciesChoice } from '../engine/species';
import type { TreeJobRequest, TreeJobResponse } from '../workers/treeWorker';

const POOL_SIZE = Math.max(
  1,
  Math.min(3, (navigator.hardwareConcurrency ?? 4) - 1),
);

interface PendingJob {
  resolve: (value: TreeJobResponse) => void;
  reject: (reason: unknown) => void;
}

interface PoolWorker {
  worker: Worker;
  busy: boolean;
}

let pool: PoolWorker[] | null = null;
const pending = new Map<string, PendingJob>();
const queue: TreeJobRequest[] = [];
let jobCounter = 0;

function createWorker(): PoolWorker {
  const worker = new Worker(
    new URL('../workers/treeWorker.ts', import.meta.url),
    { type: 'module' },
  );

  const entry: PoolWorker = { worker, busy: false };

  worker.onmessage = (event: MessageEvent<TreeJobResponse>) => {
    const job = pending.get(event.data.id);
    pending.delete(event.data.id);
    entry.busy = false;

    job?.resolve(event.data);
    drain();
  };

  worker.onerror = (event) => {
    entry.busy = false;
    // Sem o id da requisição não dá para saber qual promessa falhou; rejeitar
    // todas as pendentes deste worker seria pior. O consumidor trata o
    // timeout tratando o nó como erro.
    console.error('[treePool] worker falhou', event.message);
    drain();
  };

  return entry;
}

function getPool(): PoolWorker[] {
  if (!pool) {
    pool = Array.from({ length: POOL_SIZE }, createWorker);
  }
  return pool;
}

function drain(): void {
  if (queue.length === 0) return;

  for (const entry of getPool()) {
    if (entry.busy) continue;
    const job = queue.shift();
    if (!job) return;
    entry.busy = true;
    entry.worker.postMessage(job);
  }
}

export function generateTreeAsync(
  login: string,
  params: TreeParams,
  speciesChoice: SpeciesChoice,
  lod: 1 | 2,
): Promise<TreeJobResponse> {
  const id = `${login}#${jobCounter++}`;

  return new Promise<TreeJobResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    queue.push({ id, login, params, speciesChoice, lod });
    drain();
  });
}

/** Descarta trabalho ainda não iniciado — usado ao trocar de floresta. */
export function clearTreeQueue(): void {
  queue.length = 0;
}

export function disposeTreePool(): void {
  pool?.forEach((entry) => entry.worker.terminate());
  pool = null;
  pending.clear();
  queue.length = 0;
}
