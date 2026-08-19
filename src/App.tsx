/**
 * GitForest 🌳
 *
 * Aplicação principal que compõe a cena 3D e a UI.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useTreeStore } from './store/useTreeStore';
import { useSceneStore } from './store/useSceneStore';
import { useForestStore } from './store/useForestStore';
import { useUrlState } from './hooks/useUrlState';
import { getAtmosphere } from './world/atmosphere';
import { getSeason } from './world/season';
import { getTerrain } from './world/terrain';
import { resolveSpecies } from './engine/species';
import { Tree } from './components/Tree/Tree';
import { Forest } from './components/Forest/Forest';
import { CountryStreamer } from './components/Forest/CountryStreamer';
import { SceneSetup } from './components/Scene/SceneSetup';
import { Landscape } from './components/Scene/Landscape';
import { Particles } from './components/Scene/Particles';
import { SkyBackground } from './components/Scene/SkyBackground';
import { CameraGuard } from './components/Scene/CameraGuard';
import { DebugProbe } from './components/Scene/DebugProbe';
import { SearchBar } from './components/UI/SearchBar';
import { InfoPanel } from './components/UI/InfoPanel';
import { StylePanel } from './components/UI/StylePanel';
import { ForestPanel } from './components/UI/ForestPanel';
import { NeighborCard } from './components/UI/NeighborCard';
import { CountryPanel } from './components/UI/CountryPanel';
import { LoadingScreen } from './components/UI/LoadingScreen';
import { ErrorToast } from './components/UI/ErrorToast';
import { TokenModal } from './components/UI/TokenModal';
import './App.css';

/**
 * Altura do solo no centro da clareira. Determinística, então pode ser
 * resolvida no momento do import — é o que ancora árvore, partículas e câmera
 * na superfície do morro em vez de no plano y = 0.
 */
const GROUND_Y = getTerrain().heightAt(0, 0);

function App() {
  const { status, treeParams, treeGeometry, githubToken } = useTreeStore();
  const regenerate = useTreeStore((s) => s.regenerate);
  const replantForest = useForestStore((s) => s.replantForest);
  const forestMode = useForestStore((s) => s.mode);

  const atmosphereId = useSceneStore((s) => s.atmosphere);
  const cycleAtmosphere = useSceneStore((s) => s.cycleAtmosphere);
  const speciesChoice = useSceneStore((s) => s.species);
  const seasonId = useSceneStore((s) => s.season);

  const [showTokenModal, setShowTokenModal] = useState(false);

  useUrlState();

  const atmosphere = getAtmosphere(atmosphereId);
  const season = useMemo(() => getSeason(seasonId), [seasonId]);
  const species = useMemo(
    () => resolveSpecies(speciesChoice, treeParams?.seed ?? 0),
    [speciesChoice, treeParams],
  );

  // Mostrar modal de token se não houver token configurado
  useEffect(() => {
    if (!githubToken) {
      const timer = setTimeout(() => setShowTokenModal(true), 800);
      return () => clearTimeout(timer);
    }
  }, [githubToken]);

  // Espécie muda a gramática do L-System, então exige regenerar a geometria.
  // Estação e atmosfera não — são só uniforms. O primeiro render é pulado
  // porque a árvore já nasce com a espécie corrente.
  //
  // A floresta replanta junto: deixar só a árvore em foco trocar de espécie
  // produzia um bonsai no meio de um bosque de carvalhos. O replantio não
  // toca na rede — os perfis já estão em memória.
  const firstSpeciesRun = useRef(true);
  useEffect(() => {
    if (firstSpeciesRun.current) {
      firstSpeciesRun.current = false;
      return;
    }
    regenerate();
    replantForest();
  }, [speciesChoice, regenerate, replantForest]);

  return (
    <div className="app" id="app-root">
      {/* Canvas 3D */}
      <Canvas
        className="canvas-3d"
        camera={{
          position: [13, GROUND_Y + 6, 17],
          fov: 50,
          // `far` precisa alcançar a camada de morros mais distante (900)
          near: 0.5,
          far: 1400,
        }}
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
      >
        <SceneSetup />
        <SkyBackground />
        <Landscape />

        {/* A floresta fica na raiz da cena: as posições das árvores de fundo
            já vêm em coordenadas de mundo, com a altura resolvida pelo
            terreno. Aninhá-la no grupo abaixo aplicaria o deslocamento duas
            vezes e afundaria tudo. */}
        <Forest />

        {/* Fora de `Forest` de propósito: no modo país a cena começa vazia, e
            um carregador que só existisse junto das árvores nunca chegaria a
            pedir a primeira leva. */}
        <CountryStreamer />

        {/* Partículas e árvore em foco acompanham a superfície do terreno */}
        <group position={[0, GROUND_Y, 0]}>
          <Particles />

          {status === 'ready' && treeGeometry && treeParams && (
            <Tree
              geometry={treeGeometry}
              params={treeParams}
              species={species}
              season={season}
            />
          )}
        </group>

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.05}
          minDistance={5}
          maxDistance={60}
          maxPolarAngle={Math.PI * 0.495}
          target={[0, GROUND_Y + 3.5, 0]}
        />

        <CameraGuard />
        <DebugProbe />
      </Canvas>

      {/* UI Overlay */}
      <SearchBar />
      <InfoPanel />
      <StylePanel />
      <ForestPanel />
      <NeighborCard />
      <CountryPanel />
      <LoadingScreen />
      <ErrorToast />

      {/* Hora do dia — troca céu, luz e neblina de uma vez só */}
      <button
        className="scene-button"
        id="atmosphere-button"
        onClick={cycleAtmosphere}
        title={`Atmosfera: ${atmosphere.nome}`}
        aria-label={`Trocar atmosfera. Atual: ${atmosphere.nome}`}
      >
        {atmosphere.icone}
      </button>

      {/* Botão de token */}
      <button
        className="token-button"
        id="token-settings-button"
        onClick={() => setShowTokenModal(true)}
        title="Configurar token do GitHub"
      >
        🔑
      </button>

      {/* Branding */}
      <div className="branding" id="branding">
        <span className="brand-icon">🌳</span>
        <span className="brand-name">GitForest</span>
      </div>

      {/* Tela de boas-vindas (quando idle) */}
      {status === 'idle' && forestMode !== 'pais' && (
        <div className="welcome-overlay" id="welcome-overlay">
          <div className="welcome-content">
            <h1 className="welcome-title">
              <span className="welcome-icon">🌳</span>
              GitForest
            </h1>
            <p className="welcome-subtitle">
              Visualize contribuições do GitHub como árvores orgânicas 3D
            </p>
            <p className="welcome-hint">
              Digite um username na busca acima — a floresta de amigos cresce
              junto
            </p>
          </div>
        </div>
      )}

      <TokenModal
        isOpen={showTokenModal}
        onClose={() => setShowTokenModal(false)}
      />
    </div>
  );
}

export default App;
