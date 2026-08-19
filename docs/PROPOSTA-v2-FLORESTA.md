# GitForest v2 — Proposta de Redesign: "A Floresta"

> Documento de proposta. Nada aqui foi implementado ainda.
> Base analisada: código real em `src/` + `codebase.md` v1.0.4 (2026-08-17).

---

## 0. TL;DR e a decisão-chave

Três pedidos foram feitos:

1. **O usuário poder escolher o design da sua árvore.**
2. **Conta logada + floresta = amigos e amigos-de-amigos.**
3. **Redesign do cenário: morros e grama.**

Os pedidos 1 e 3 são fazíveis **sem backend** e entregam quase todo o impacto visual.
O pedido 2 **exige um backend**, e essa é a decisão-crux do projeto.

**Por quê:** hoje o app é 100% client-side com um PAT no `localStorage`
([useTreeStore.ts:51](../src/store/useTreeStore.ts#L51)). Para "conta logada" de verdade é
preciso OAuth, e os endpoints OAuth do GitHub **não enviam cabeçalhos CORS** — o navegador
não consegue trocar o `code` pelo token sozinho, nem no Device Flow. Um proxy mínimo é
obrigatório. Além disso, o fan-out de amigos-de-amigos multiplica as queries por centenas,
o que torna o cache compartilhado no servidor uma necessidade, não um luxo.

**Recomendação:** Cloudflare Workers + KV (ou Vercel + Upstash). O cliente vira um
renderizador puro; o servidor faz auth, fan-out do grafo e devolve `TreeParams` já
normalizados e cacheados.

**Alternativa sem backend** (se não quiser servidor agora): fazer a **Fase 2** como
"floresta de um repositório" ou "floresta de uma org" — pega os contribuidores/membros via
PAT do próprio usuário, prova toda a arquitetura de N árvores, e não precisa de login.
A floresta pessoal entra depois, quando o backend existir.

---

## 1. Divergências entre `codebase.md` e o código real

O mapa arquitetural está desatualizado em pontos que induzem a erro quem (humano ou IA) ler
só ele. Corrigir isso é pré-requisito para qualquer trabalho grande.

| # | `codebase.md` afirma | O código realmente faz |
|:--|:--|:--|
| 1 | `Ground.tsx`: "plataforma circular reflexiva e brilhante… linhas radiais holográficas estilo grade sci-fi" | [Ground.tsx](../src/components/Scene/Ground.tsx) é um disco verde low-poly `#2d4a2e` + anel `#3d5a3e` + 300 triângulos de grama. **Nada de sci-fi.** |
| 2 | Stack: "visual futurista, dark, glassmorphism e neon" | A cena 3D é **golden hour / Firewatch**: `Environment preset="sunset"`, luz `#ffd4a0`, céu com horizonte laranja. A UI 2D é que é dark/glass. Há um **conflito de direção de arte** não resolvido. |
| 3 | `SceneSetup.tsx`: "luzes direcionais, fill e neblina" | Também monta `<Environment preset="sunset">` e um `EffectComposer` com **Bloom + Vignette** ([SceneSetup.tsx:52-69](../src/components/Scene/SceneSetup.tsx#L52-L69)). Pós-processamento não está documentado. |
| 4 | Stack não menciona | `@react-three/postprocessing` é dependência de produção; `leva` está em devDependencies e não aparece no mapa. |
| 5 | `TreeParams.seed`: "derivada do `user.id`" ([types.ts:28](../src/engine/types.ts#L28)) | É `hashString(user.login)` ([normalizer.ts:56](../src/api/normalizer.ts#L56)). Detalhe importante: **trocar o login muda a árvore**, o `id` não mudaria. |
| 6 | `BranchParams.isDead`: "último commit > 1 ano" ([types.ts:65](../src/engine/types.ts#L65)) | O normalizer usa **3 anos** ([normalizer.ts:100](../src/api/normalizer.ts#L100)). O comentário ficou para trás na correção v1.0.0. |

---

## 2. Achados técnicos (bugs e riscos reais)

### 2.1 As raízes são invisíveis 🔴

`generateRoots` cria raízes de `[0,0,0]` até `y ≈ -1.1`
([turtle.ts:180-201](../src/engine/turtle.ts#L180-L201)). O chão é um disco **opaco** em
`y = -0.05` ([Ground.tsx:18](../src/components/Scene/Ground.tsx#L18)). Ou seja: toda a
feature de raízes — que consome código no engine, no turtle e um componente inteiro
([Roots.tsx](../src/components/Tree/Roots.tsx)) — renderiza **debaixo do chão** e nunca é
vista. Sobram 5 centímetros de colo de raiz aparecendo.

Isso não é só um bug: é uma **oportunidade**. Ver a seção 5.3 (rede micorrízica).

### 2.2 `growthProgress` re-renderiza a árvore inteira 60×/s 🔴

[App.tsx:38-63](../src/App.tsx#L38-L63) roda um `requestAnimationFrame` que chama
`setGrowthProgress` a cada frame por 3 segundos. Isso são **~180 re-renders do React**
propagando por `Tree` → `Branches` × 2 → `Leaves` → `Roots` → `BranchHitboxes`. Hoje passa
despercebido com 1 árvore. Com 200 árvores é fatal.

**Correção:** mover o progresso para um `useRef` mutado dentro de `useFrame`, e aplicá-lo
via `groupRef.current.scale` e via uniform do shader. Zero re-renders do React.
O mesmo vale para o `useEffect` que faz `meshRef.current.count = visibleCount`
([Leaves.tsx:196-199](../src/components/Tree/Leaves.tsx#L196-L199)).

### 2.3 `frustumCulled={false}` nas folhas 🟠

[Leaves.tsx:214](../src/components/Tree/Leaves.tsx#L214) desliga o culling para contornar
uma bounding sphere errada. Com uma floresta, isso significa desenhar **todas as folhas de
todas as árvores** mesmo as que estão atrás da câmera. A correção certa é computar a
bounding sphere real a partir das posições das folhas.

### 2.4 Cache sem versionamento de query 🟠

[github.ts:12](../src/api/github.ts#L12) usa a chave `gitforest_cache_${login}`. Se a
`USER_QUERY` ganhar campos novos (e ela vai ganhar, nesta proposta), usuários com cache
quente recebem por até 1 hora um objeto **sem os campos novos**, causando `undefined`
silencioso. Chave deve incluir uma `QUERY_VERSION`.

Além disso, `localStorage` tem ~5MB. Uma floresta com 200 usuários cacheados estoura a
quota — e o `saveToCache` engole o erro silenciosamente
([github.ts:182](../src/api/github.ts#L182)). Migrar para **IndexedDB**.

### 2.5 `flatShading` é no-op nos ShaderMaterials 🟡

[Branches.tsx:239](../src/components/Tree/Branches.tsx#L239) passa `flatShading` a um
`shaderMaterial` customizado. O Three injeta o `#define FLAT_SHADED`, mas os shaders de
casca não o consultam nem recalculam a normal por derivadas — então o facetado low-poly
pretendido **não acontece**. Em [Roots.tsx](../src/components/Tree/Roots.tsx) funciona,
porque lá é `meshStandardMaterial`.

### 2.6 A "animação de vento na grama" não move grama 🟡

[Ground.tsx:107-117](../src/components/Scene/Ground.tsx#L107-L117): o comentário diz
"animação de vento", mas o código só pulsa o `material.emissive`. Nenhum talo se mexe.

### 2.7 Grama não-determinística e mal distribuída 🟡

Usa `Math.random()` ([Ground.tsx:80-97](../src/components/Scene/Ground.tsx#L80-L97)), então
a grama muda a cada remount — quebra a promessa de "mesma seed = mesma cena". E o sorteio
`radius = 1.5 + random() * 8` é uniforme **no raio**, não na área: concentra visivelmente
os talos perto do centro.

### 2.8 Fog briga com o céu 🟠

O fog é `#1a1a2e` (azul-arroxeado escuro,
[SceneSetup.tsx:55](../src/components/Scene/SceneSetup.tsx#L55)) mas o horizonte do céu é
laranja quente `vec3(0.95, 0.55, 0.20)`
([SkyBackground.tsx:27](../src/components/Scene/SkyBackground.tsx#L27)). Hoje quase não se
nota porque não há nada distante. **Com morros, a silhueta vai desbotar para roxo contra um
céu laranja** e o efeito atmosférico se desfaz. Fog, luz e céu precisam sair de uma única
paleta.

### 2.9 Fundo desenhado duas vezes 🟡

`<color attach="background" args={['#0a0a19']} />` ([App.tsx:80](../src/App.tsx#L80)) e o
quad fullscreen do `SkyBackground` fazem a mesma coisa. Um dos dois é desperdício.

### 2.10 Câmera e sombras não escalam para paisagem 🟠

- `far: 100` ([App.tsx:74](../src/App.tsx#L74)) — morros distantes precisam de ~1000.
- `maxPolarAngle = π/2 + 0.1` ([App.tsx:102](../src/App.tsx#L102)) permite a câmera passar
  **por baixo** do horizonte; com terreno em relevo, ela vai atravessar o morro.
- Shadow map 1024 com caixa ortográfica de ±10
  ([SceneSetup.tsx:28-33](../src/components/Scene/SceneSetup.tsx#L28-L33)) — cobre uma
  árvore, não uma floresta. Precisa de cascatas (CSM) ou sombras próximas + blob shadows.

### 2.11 `Environment preset="sunset"` baixa um HDRI de CDN em runtime 🟡

Custo de primeiro carregamento e falha offline. Para uma cena estilizada, um
`<Lightformer>`/gradiente próprio dá o mesmo resultado sem download.

### 2.12 Geometria mergeada na CPU não escala 🔴

[Branches.tsx:131-229](../src/components/Tree/Branches.tsx#L131-L229) cria um
`CylinderGeometry` por segmento e faz merge manual na thread principal. Para 1 árvore
(~centenas de segmentos), tudo bem. Para 200 árvores, é **congelamento da aba**. Ver
seção 6.

---

## 3. Redesign do cenário: morros, grama, céu

### 3.1 Terreno — um `heightAt(x, z)` como fonte única de verdade

O ponto mais importante do redesign: **uma função pura de altura** compartilhada entre CPU
e GPU. Sem isso, árvores flutuam, grama afunda e a câmera atravessa o chão.

```
src/world/terrain.ts
  heightAt(x, z): number         // fBm 3–4 oitavas, seedado
  normalAt(x, z): Vec3           // por diferenças finitas
  colorAt(x, z): Color           // altitude + declive
  clearingMask(x, z, sites): number   // achata o solo sob cada árvore
```

A mesma fBm em GLSL para o vertex shader do terreno e da grama. A `clearingMask` é o truque
que faz árvore e morro conviverem: cada árvore abre uma clareira suave de raio ~3 onde o
terreno tende ao plano, com uma borda em `smoothstep` que evita degrau.

**Malha:** `PlaneGeometry(400, 400, 192, 192)` com deslocamento por altura, `toNonIndexed()`
+ `computeVertexNormals()` para facetas duras — casa com o low-poly do resto e é mais barato
que normal maps.

**Cor por vertex color, sem textura nenhuma:**
- vales → verde saturado;
- encostas suaves → verde-oliva;
- cristas → ocre seco (mais luz, menos água);
- declive > ~35° → rocha cinza;
- concavidade (curvatura) → escurecimento, um AO de pobre que dá muita profundidade.

**Morros distantes (o "efeito Firewatch"):** 3–4 camadas de silhueta de cordilheira, cada
uma um mesh de baixíssima densidade, com desbotamento atmosférico crescente em direção à cor
do horizonte. É barato e é 80% do impacto visual da imagem.

**Água:** um lago no vale mais baixo, plano com shader de fresnel + reflexo do gradiente do
céu. Opcional, mas é o tipo de detalhe que faz o print viralizar.

### 3.2 Grama — reescrita completa

| | Hoje | Proposta |
|:--|:--|:--|
| Geometria | triângulo de 3 vértices, reto | talo curvado, 7–9 vértices, afinando para a ponta |
| Contagem | 300 fixos | 30k–80k, em tiles instanciados |
| Distribuição | `Math.random()`, uniforme no raio | RNG seedado, amostragem estratificada por área, densidade modulada por declive/altitude/proximidade de árvore |
| Terreno | ignora (tudo em `y = 0`) | `heightAt()` + alinhamento parcial à normal do terreno |
| Vento | pulso de `emissive` (não move) | curvatura no vertex shader, `pow(uv.y, 2)`, campo de ruído rolante = rajadas atravessando o campo |
| Cor | verde aleatório por instância | gradiente raiz→ponta, tingido por `colorAt(x,z)` para grama e chão concordarem |
| Culling | irrelevante | tiles de 16×16 unidades, cada um com bounding box correta |

**Detalhe temático opcional e discreto:** a ponta dos talos num raio pequeno ao redor de cada
árvore recebe um leve tingimento da cor da linguagem dominante daquele usuário. A grama
"sabe" de quem é o solo.

**Extras sazonais:** tufos secos amarelados no outono, neve acumulada no inverno, flores e
cogumelos cujas cores saem da paleta de linguagens.

### 3.3 Céu, luz e fog como um só preset

Um módulo `src/world/atmosphere.ts` com presets que definem **juntos** as cores do gradiente
do céu, a cor/intensidade das luzes, a cor do fog e os parâmetros de bloom:

- `amanhecer` — azul frio, névoa rasa nos vales
- `goldenHour` — o look atual, mas com fog coerente
- `meioDia` — alto contraste, sombras curtas
- `noiteEstrelada` — vagalumes, folhas emissivas, Via Láctea

Trocar de preset deve ser **uma linha**, não editar cinco arquivos. Hoje as cores estão
espalhadas por `SceneSetup`, `SkyBackground`, `App.tsx` e os fragment shaders.

---

## 4. Escolher o design da árvore

### 4.1 Princípio: espécie muda a *forma*, dados mudam a *escala*

A árvore precisa continuar sendo uma leitura honesta do perfil. Então: os dados do GitHub
seguem controlando altura, espessura, comprimento de galho, densidade de folhas e cor. A
espécie escolhida controla a **gramática** — ângulos, filotaxia, decaimento, silhueta da
copa, formato da folha, paleta de casca.

Hoje isso é impossível: `buildTreeGrammar(params)` tem todas as constantes cravadas
([grammar.ts:27-75](../src/engine/grammar.ts#L27-L75)) — `lerp(25, 75, rng())` para yaw,
`lerp(20, 55, rng())` para pitch, profundidade máxima 3, e a folha é um losango fixo em
[Leaves.tsx:21-31](../src/components/Tree/Leaves.tsx#L21-L31).

**Refatoração:** `buildTreeGrammar(params, species: SpeciesProfile)`.

```ts
interface SpeciesProfile {
  id: string;
  nome: string;
  // Forma
  yawRange: [number, number];
  pitchRange: [number, number];
  filotaxia: 'espiral' | 'oposta' | 'verticilada';   // como os galhos saem do tronco
  maxDepth: number;
  subBranchDecay: { length: [number, number]; radius: [number, number] };
  gravitropismo: number;   // negativo = galhos caídos (salgueiro)
  curvatura: number;       // quanto cada segmento entorta (bonsai = alto)
  // Copa
  silhueta: (t: number) => number;   // raio da copa em função da altura normalizada
  folhagem: 'cards' | 'blobs';       // folhas individuais ou massas low-poly
  formaFolha: 'losango' | 'oval' | 'agulha' | 'coracao' | 'bordo' | 'petala' | 'fronde';
  // Cor
  paletaCasca: [Cor, Cor];
  matizFolha: number;      // desvio aplicado à cor da linguagem
}
```

### 4.2 Espécies propostas

| Espécie | Silhueta | Encaixa em quem |
|:--|:--|:--|
| **Carvalho** | copa larga e arredondada, tronco grosso, galhos horizontais | perfis maduros, muitos repos |
| **Pinheiro** | monopodial, galhos verticilados apontando para baixo, agulhas | ótimo para preencher morros ao fundo |
| **Salgueiro** | galhos terminais caindo, folha longa e fina | visual melancólico, contrasta na floresta |
| **Cerejeira** | ramificação esparsa, pétalas, chuva de pétalas | perfis pequenos ficam bonitos, não vazios |
| **Bonsai** | baixo, retorcido, curvatura alta, musgo | contas novas / poucos repos — vira um charme, não uma punição |
| **Baobá** | tronco enorme, copa rala | muitas contribuições, poucos repos |

**Detalhe de produto importante:** hoje uma conta pequena gera uma árvore feia e rala.
Com espécies, "pequeno" pode virar **bonsai** ou **cerejeira** — esteticamente completo. Isso
muda a sensação do produto para o usuário casual.

### 4.3 Cosméticos, separados da espécie

- **Estação** (primavera / verão / outono / inverno): modula o matiz das folhas em direção a
  uma paleta, adiciona queda de folhas no outono, tira folhas e põe neve no inverno.
- **Paleta de casca**: 5 opções (escura, bétula, avermelhada, acinzentada, carbonizada).
- **Horário** (usa os presets de atmosfera da seção 3.3).
- **Acessórios** desbloqueáveis por marcos reais: vagalumes acima de X contribuições no ano,
  ninho acima de Y seguidores, musgo por idade de conta. Gamificação leve, ancorada em dados.

### 4.4 Persistência e — crucialmente — compartilhamento

Um estilo que só você vê não vale nada. Duas camadas:

1. **`useCustomizationStore`** (Zustand + `persist`) → `localStorage`, chave
   `gitforest_style_v1`. Funciona hoje, sem backend.
2. **URL como fonte de verdade compartilhável**:
   `?u=login&sp=pinheiro&season=outono&bark=betula&sky=goldenHour`.
   Sem isso, ninguém vê a sua escolha.
3. **Quando o backend existir**, o estilo escolhido pelo dono é salvo no servidor, para que
   a árvore dele apareça **com o estilo dele** na floresta dos amigos. Esse é o pulo do gato:
   a customização vira identidade social.

**Passo intermediário barato e valioso:** enquanto não há login, derivar a espécie padrão da
seed — `SPECIES[hashString(login) % SPECIES.length]`. A floresta já nasce variada, sem auth
nenhuma, e o dono pode sobrescrever.

### 4.5 UI

Uma gaveta "Estilo" no lado **direito** (equilibra o `InfoPanel`, que é à esquerda),
recolhível, com preview ao vivo — a árvore re-gera ao trocar de espécie usando a mesma seed,
então a transição é uma metamorfose, não um corte.

---

## 5. A floresta social

### 5.1 O GitHub não tem "amigos" — definir o que é uma conexão

Não existe amizade no GitHub, só `followers` e `following` (unidirecionais, e muito poluídos
por follow de celebridade). Proposta de definição:

- **1º grau (amigos)** = **follow mútuo**. `following ∩ followers`. É a definição honesta.
- **Conhecidos** = following não-recíproco → renderizados como uma linha de árvores
  distantes e desbotadas nos morros do fundo. Narrativa perfeita e custo quase zero.
- **2º grau** = mútuos dos meus mútuos, ordenados por **nº de mútuos em comum** (igual ao
  "conexões em comum" do LinkedIn).

**Força do laço** (define a distância radial da árvore em relação à sua):
mútuos em comum + repositórios em comum + co-contribuições + tempo desde o follow.

### 5.2 Layout da floresta

- **Você**: no morro central, na clareira mais alta. Câmera nasce olhando para você.
- **1º grau**: anel interno, posicionado por espiral de ângulo áureo + jitter seedado
  (evita padrão visível) e por Poisson-disk para não colidir. Raio ∝ inverso da força do laço.
- **2º grau**: anel externo, árvores menores, LOD baixo, sem hitbox.
- **Resto**: linha de árvores em billboard na silhueta dos morros distantes.

Orçamento sugerido: **60** árvores de 1º grau em LOD médio, **200** de 2º grau em LOD baixo,
e o resto como impostores. Números para validar com profiling, não para cravar.

### 5.3 A rede micorrízica — resolvendo o bug 2.1 e visualizando o grafo

Florestas reais conectam árvores por redes de fungos (o *wood wide web*). Proposta: as
raízes deixam de ser geometria enterrada e invisível e passam a ser uma **rede luminosa
subterrânea** que liga árvores conectadas — visível através de um terreno levemente
translúcido, ou revelada quando a câmera desce, ou pulsando quando você seleciona alguém.

Isso resolve três coisas de uma vez:
- torna a feature de raízes (hoje 100% invisível) finalmente visível;
- dá forma visual ao grafo social sem poluir a cena com linhas abstratas;
- é temático, bonito e biologicamente correto — o tipo de detalhe que dá alma ao projeto.

Pulsos de luz podem viajar pela rede representando atividade recente (um push do seu amigo
acende o caminho até a árvore dele).

### 5.4 Arquitetura de autenticação

**Não fazer:** manter o PAT no `localStorage`. Funciona para o modo "buscar username", mas é
inadequado como login.

**Fazer:**

```
Cloudflare Worker (ou Vercel Functions)
  GET  /api/auth/login      → redirect para o GitHub OAuth
  GET  /api/auth/callback   → troca code por token, grava sessão
                              cookie HttpOnly + SameSite=Lax + Secure
  GET  /api/me              → { login, avatar, style }
  GET  /api/forest          → grafo: mútuos 1º e 2º grau + força do laço
  GET  /api/tree/:login     → TreeParams já normalizados (cache 24h)
  PUT  /api/style           → salva o estilo escolhido pelo dono
```

Pontos de arquitetura:

- **Mover `normalizer.ts` para código compartilhado.** O servidor devolve `TreeParams`
  prontos; o cliente só roda o engine (que é determinístico a partir da seed). Isso reduz
  drasticamente o payload e centraliza a lógica de normalização.
- **Cache compartilhado em KV**, chaveado por `login + QUERY_VERSION`, TTL 24h para árvores
  de fundo e 1h para a árvore em foco. É o que torna o fan-out viável: o segundo usuário que
  logar já encontra metade da floresta em cache.
- **Query "lite" para árvores de fundo.** A `USER_QUERY` atual puxa 30 repos × 5 linguagens
  + histórico de commits + o calendário anual inteiro (~365 nós). Isso custa caro no
  orçamento de pontos do GraphQL (5.000/hora), e o custo é calculado por nós requisitados.
  Uma floresta de centenas de usuários **estoura** com a query cheia. Árvores de fundo
  precisam de uma query reduzida: top 8 repos, sem calendário, sem histórico de commits.
  Só a árvore em foco recebe a query completa. **Medir antes de dimensionar.**
- **Fila com backoff** no servidor para respeitar o rate limit secundário, com o cliente
  recebendo as árvores por streaming conforme ficam prontas.
- **Privacidade:** só dados públicos, mas ainda assim vale um opt-out — alguém pode não
  querer aparecer na floresta dos outros.

### 5.5 Carregamento progressivo como narrativa

Não mostrar spinner por 20 segundos. Em vez disso:

1. Sua árvore cresce imediatamente (dados já em cache).
2. Cada amigo aparece primeiro como **broto**, e cresce quando os dados dele chegam.
3. O 2º grau brota ao longe conforme a câmera se aproxima, ou ao clicar em "expandir".

A latência vira a animação. É a diferença entre "carregando" e "a floresta está nascendo".

### 5.6 Modos que funcionam **hoje**, sem login

Vale muito implementar antes do OAuth, porque provam toda a arquitetura de N árvores:

- **Floresta de um repositório** — contribuidores viram árvores. Ótimo para README de
  projetos open source.
- **Floresta de uma organização** — `organization { membersWithRole }`.
- **Floresta de um username público** — mútuos de qualquer login, sem estar logado.

---

## 6. Arquitetura de performance para N árvores

Sem isto, a floresta não roda. É a parte menos glamourosa e a mais decisiva.

### 6.1 Geração em Web Worker

L-System, turtle e merge de geometria são CPU pura, sem DOM
([lsystem.ts](../src/engine/lsystem.ts), [turtle.ts](../src/engine/turtle.ts),
[Branches.tsx:124-229](../src/components/Tree/Branches.tsx#L124-L229)). Movê-los para um
worker pool (2–4 workers) e transferir os `ArrayBuffer` de volta mantém a cena a 60fps
enquanto a floresta é gerada. Hoje, gerar 200 árvores na thread principal trava a aba por
vários segundos.

### 6.2 Níveis de detalhe

| LOD | Quando | O que renderiza |
|:--|:--|:--|
| **L0** | árvore em foco / hover | geometria completa + folhas individuais + hitboxes |
| **L1** | 1º grau, perto | galhos mergeados + folhas instanciadas, sem hitbox de sub-galho |
| **L2** | 2º grau | só tronco e galhos principais + copa em *blobs* low-poly |
| **L3** | fundo | impostor billboard, renderizado uma vez para um atlas de textura |

### 6.3 Um único InstancedMesh global para toda a folhagem

Em vez de um `InstancedMesh` por árvore (= N draw calls), **um** buffer global com um
atributo `treeIndex` por instância. A floresta inteira de folhas vira **1 draw call**. O
`growthProgress` de cada árvore vira um uniform indexado por `treeIndex`, o que também
resolve o problema 2.2 de raiz.

### 6.4 Refatoração de estado

`useTreeStore` guarda **uma** árvore ([useTreeStore.ts:16-43](../src/store/useTreeStore.ts#L16-L43)).
Precisa virar:

```ts
interface ForestStore {
  viewer: Viewer | null;
  nodes: Map<string, ForestNode>;   // login → nó
  focused: string | null;
  graph: { edges: Edge[]; };
}

interface ForestNode {
  login: string;
  degree: 0 | 1 | 2;
  status: 'pending' | 'loading' | 'ready' | 'error';
  params: TreeParams | null;
  geometry: TreeGeometry | null;
  style: SpeciesProfile;
  position: [number, number, number];   // já ajustada por heightAt()
  lod: 0 | 1 | 2 | 3;
}
```

Manter `useTreeStore` como um **seletor** sobre `nodes[focused]` preserva `InfoPanel`,
`BranchTooltip` e `BranchHitboxes` funcionando sem reescrita.

---

## 7. Roadmap sugerido

### ✅ Fase 1 — Paisagem (concluída em 2026-08-17)
Terreno com `heightAt()`, morros próximos e distantes, grama reescrita, atmosfera unificada
(céu + luz + fog num preset só), câmera e sombras dimensionadas para paisagem.
Corrigidos 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11.
Ver o registro **v1.1.0** no `codebase.md` para o detalhamento.
**Entregue: uma árvore num morro, com quatro horas do dia.**

Fica pendente da lista de achados apenas o **2.12** (merge de geometria na thread
principal), que é por natureza trabalho da Fase 3 — não faz sentido introduzir um
Web Worker antes de existir mais de uma árvore para gerar.

### ✅ Fase 2 — Estilos (concluída em 2026-08-17)
`SpeciesProfile`, refatoração de `grammar.ts` e `Leaves.tsx`, gaveta de UI, persistência
local, estado na URL, espécie padrão derivada da seed. Mais estações como eixo cosmético
independente. Ver o registro **v1.2.0** no `codebase.md`.
**Entregue: a árvore é sua — e deixou de ser feia.**

A parte não prevista desta fase foi o conserto da própria árvore padrão. O sistema de
espécies não teria salvado nada enquanto a base continuasse com tronco reto, galhos retos,
raio com degrau em cada emenda e folhas cinzas alinhadas num feixe. Duas lições que
valem para a Fase 3:

- **`branchCurve` precisa ser o arco total, não por segmento.** A rotação é aplicada no
  referencial local e acumula; 20° por segmento em sete segmentos fecham 140° e enrolam o
  galho numa argola. O salgueiro virou literalmente uma gaiola antes disso ser percebido.
- **Curvatura de galho estrutural e de ponta são coisas diferentes.** Num salgueiro real
  quem chora são as varas finas. Empurrar um parâmetro único até as pontas caírem
  destruía os galhos principais — daí `tipDroop`.

### ✅ Fase 3 — Floresta sem login (concluída em 2026-08-17)
Worker pool, LODs, folhagem instanciada global, `useForestStore`, rede micorrízica e
modo "floresta de um username público". Ver o registro **v1.3.0** no `codebase.md`.
**Entregue: 72 árvores em duas draw calls, sem travar a thread principal.**

**O que ficou de fora e por quê:**

- **IndexedDB.** A justificativa original era a quota de 5 MB do `localStorage`. Acontece
  que o caminho da floresta não escreve no `localStorage` — os perfis reduzidos são
  consumidos e descartados. O risco que motivava a migração não se materializou, e cachear
  isso é problema do servidor na Fase 4, não do cliente. Fica registrado como pendência,
  não como esquecimento.
- **LOD por distância da câmera.** O nível de detalhe hoje é fixo por grau (primeiro grau
  detalhado, segundo grau reduzido). Trocar de LOD conforme a câmera se move exigiria
  remontar os buffers mesclados, o que só compensa numa floresta bem maior.

**Lição de campo que vale registrar:** a API do GitHub responde **504** a lotes de dez
perfis que incluam `contributionsCollection`, e a página de erro do edge deles vem com
`Access-Control-Allow-Origin: *;` — malformado. O navegador então reporta o problema como
falha de CORS, escondendo por completo o 504 real. Só um teste direto contra a API, fora
do navegador, revelou a causa. Vale desconfiar de todo erro de CORS vindo de um endpoint
que comprovadamente suporta CORS.

### ✅ Fase 3.5 — Bonsai, clique nas árvores e florestas por país (concluída em 2026-08-19)
Três pedidos fora do roadmap original, atendidos juntos porque se apoiam uns nos outros.
Ver o registro **v1.4.0** no `codebase.md`.
**Entregue: uma árvore que se reconhece como bonsai, uma floresta que aparece sozinha, e
um mapa de centenas de contas que carrega só o que se vê.**

**A descoberta que valeu por todas: `trunkLean` nunca funcionou.**
Desde a Fase 2 o parâmetro existia e estava documentado como "inclinação total do pé ao
topo". Ele era repartido em frações minúsculas por dezenas de subdivisões, e entre cada
uma havia um giro aleatório de ~27°. Como o giro muda o **plano** em que a inclinação
seguinte é aplicada, as curvinhas se cancelavam umas às outras: todo tronco, de toda
espécie, subia praticamente reto. O defeito passou despercebido porque a correção da
Fase 2 tinha melhorado o resultado o bastante para parecer resolvida, e só apareceu
quando uma espécie passou a **depender** da curva do tronco para ser reconhecível.
A lição geral: em transformações que acumulam num referencial local, aleatoriedade por
passo não produz forma — produz ruído que se cancela. Forma exige coerência em escala
maior que o passo, e por isso a inclinação virou uma **onda** (`trunkWaves`).

**Outras três que valem registrar:**

- **Orçamento absoluto é armadilha quando a escala muda.** `leafBudget` cortava a copa
  num número fixo de folhas. Uma espécie que gera dez mil ficava com 3% delas e nascia
  pelada; o sintoma parecia problema de espécie, e não do orçamento.
- **Repositório é galho.** A query enxuta trazia 8 repositórios, e nenhum ajuste de
  folhagem ia consertar uma árvore com oito galhos. Antes de calibrar aparência, vale
  conferir se a quantidade de **dado** é suficiente para a forma existir.
- **Um erro sem status é pior que um erro.** A listagem de diretório da API do GitHub
  devolve 138 KB e chegou cortada no meio, virando `TypeError: Failed to fetch` sem status
  nem evento de rede — indistinguível de estar offline. Trocada por catálogo local. Pelo
  mesmo motivo, a busca do ranking ganhou `AbortSignal.timeout`: sem prazo, uma
  transferência pendurada deixava o painel eternamente em "Lendo o ranking…".

**O que ficou de fora:**

- **Rede micorrízica no modo país.** Estar no ranking do mesmo país não é uma conexão;
  desenhar fios entre estranhos seria inventar um dado que não existe.
- **Culling por frustum no carregamento.** O critério é raio ao redor do alvo da câmera,
  não o que está de fato no campo de visão. É mais simples e não descarrega o que fica
  atrás do observador quando ele apenas gira a câmera.

### Fase 4 — Login e floresta pessoal
Backend OAuth, sessão em cookie HttpOnly, `/api/forest`, cache KV compartilhado, query lite,
carregamento progressivo, estilo salvo por dono.
**Entregável: a sua floresta.**

### Fase 5 — Social
Estações, conquistas, snapshot compartilhável (imagem OG gerada no servidor), timelapse do
ano, embed para README.

---

## 8. Quick wins (todos concluídos na Fase 1)

- [x] Corrigir o comentário de `isDead` em `types.ts`: 1 ano → 3 anos.
- [x] Corrigir o comentário de `seed` em `types.ts`: `user.id` → `user.login`.
- [x] Atualizar a descrição do chão no `codebase.md` (não é sci-fi — e agora é `Landscape.tsx`).
- [x] Documentar `EffectComposer` e `@react-three/postprocessing` no `codebase.md`.
- [x] Resolver o conflito de direção de arte no `codebase.md` (cena naturalista, UI dark).
- [x] Adicionar `QUERY_VERSION` à chave de cache em `github.ts`, com limpeza das entradas antigas.
- [x] Trocar `Math.random()` por RNG seedado na grama (e também nas partículas).
- [x] Alinhar a cor do fog ao horizonte do céu — agora ambos saem do mesmo preset.
- [x] Remover a duplicação `<color attach="background">` vs. `SkyBackground`.
- [x] Corrigir o `flatShading` no-op de `Branches.tsx` (facetado real via `toNonIndexed()`).
- [x] Corrigir o comentário "animação de vento" da grama — agora o vento move os talos de verdade.
- [x] Remover o `<Environment preset="sunset">`, que baixava um HDRI de CDN em runtime.

---

## 9. Riscos e pontos a validar

| Risco | Mitigação |
|:--|:--|
| Rate limit do GraphQL no fan-out | Query lite + cache KV compartilhado + fila com backoff. **Medir o custo real em pontos antes de dimensionar a floresta.** |
| Performance com centenas de árvores | Fase 3 antes da Fase 4, com orçamento de frame medido em hardware modesto |
| Custo do backend | Cloudflare Workers + KV cobrem bem o free tier para escala pessoal |
| Privacidade / ToS do GitHub | Só dados públicos + opt-out + sem armazenar tokens de terceiros |
| Complexidade engolindo o projeto | Cada fase entrega algo utilizável sozinha; nenhuma depende da seguinte para ter valor |
