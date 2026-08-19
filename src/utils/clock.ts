/**
 * GitForest — Relógio da Cena
 *
 * Um único relógio compartilhado entre as stores e os shaders.
 *
 * Existe por um motivo específico: as árvores da floresta precisam registrar
 * o instante em que nasceram para que o shader derive o progresso do brotar
 * sem trabalho por quadro. Só que quem insere a árvore é a store, fora do
 * `useFrame`, e portanto sem acesso ao relógio do React Three Fiber. Marcar o
 * tempo com o relógio do R3F exigiria ler um ref durante a renderização — que
 * é justamente o que o React proíbe.
 *
 * Com uma origem própria em escopo de módulo, store e shader falam da mesma
 * linha do tempo sem precisar se conhecer.
 */

const EPOCH = performance.now();

/** Segundos desde o carregamento do módulo. */
export function sceneNow(): number {
  return (performance.now() - EPOCH) / 1000;
}
