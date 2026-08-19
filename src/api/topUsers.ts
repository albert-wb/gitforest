/**
 * GitForest — Top Usuários por País
 *
 * Lê as listas do projeto `gayanvoice/top-github-users`, que publica, por
 * país, um ranking de contas do GitHub por contribuições públicas.
 *
 * ## Por que este atalho, e não a busca do próprio GitHub
 *
 * A API do GitHub permite `search users location:Brazil sort:followers`, mas
 * a busca é limitada a mil resultados, cobra caro no orçamento de pontos e,
 * pior, `location` é texto livre digitado pelo usuário: "Brasil", "SP",
 * "🇧🇷" e "São Paulo, Brazil" são a mesma coisa para uma pessoa e coisas
 * diferentes para a query. Aquele repositório já resolveu essa normalização e
 * republica o resultado periodicamente via GitHub Actions.
 *
 * ## Sobre buscar de outro repositório em tempo de execução
 *
 * O conteúdo vem de `raw.githubusercontent.com`, que responde com
 * `Access-Control-Allow-Origin: *` e não exige autenticação — dá para ler
 * direto do navegador, sem proxy. Em compensação, é um arquivo de terceiros:
 * o parser abaixo trata formato inesperado devolvendo lista vazia com uma
 * mensagem clara, em vez de quebrar a aplicação.
 */

const RAW_BASE =
  'https://raw.githubusercontent.com/gayanvoice/top-github-users/main/markdown/public_contributions';

export interface RankedUser {
  login: string;
  /** Posição no ranking do país, começando em 1. */
  rank: number;
  /** Contribuições públicas segundo a lista. Zero quando não anunciado. */
  contributions: number;
}

export interface Country {
  /** Nome do arquivo sem extensão: `brazil`, `united-states`… */
  slug: string;
  /** Rótulo para exibição: `Brazil`, `United States`… */
  nome: string;
}

/**
 * Países com lista publicada.
 *
 * ⚠️ **Embutido de propósito, e não buscado da API do GitHub.**
 *
 * O caminho natural seria listar o diretório com
 * `GET /repos/:owner/:repo/contents/:path`. Ele *funciona*, mas devolve 138 KB
 * de JSON — um objeto completo por arquivo, com SHA, tamanho e quatro URLs —
 * para extrair daí apenas os nomes. Nos testes, essa resposta foi cortada no
 * meio da transferência e chegou ao navegador como um `TypeError: Failed to
 * fetch` sem status nem evento de rede, que é a pior classe de erro possível:
 * indistinguível de estar offline. O arquivo do próprio país, com 325 KB, era
 * baixado sem problema pelo `raw`.
 *
 * Trocar cento e vinte e duas linhas de dado estável por uma requisição de 138
 * KB que pode falhar em silêncio é um mau negócio. A lista muda quando o
 * projeto de origem acrescenta um país — raro, e sem consequência: quem não
 * está aqui simplesmente não aparece no seletor, em vez de o seletor inteiro
 * ficar vazio.
 */
const COUNTRY_SLUGS: string[] = [
  'afghanistan', 'albania', 'algeria', 'andorra', 'angola', 'argentina',
  'armenia', 'australia', 'austria', 'azerbaijan', 'bahrain', 'bangladesh',
  'belarus', 'belgium', 'benin', 'bhutan', 'bolivia', 'botswana', 'brazil',
  'bulgaria', 'burundi', 'cambodia', 'cameroon', 'canada', 'chad', 'chile',
  'china', 'colombia', 'congo', 'croatia', 'cuba', 'cyprus', 'czechia',
  'denmark', 'ecuador', 'egypt', 'estonia', 'ethiopia', 'finland', 'france',
  'georgia', 'germany', 'ghana', 'greece', 'guatemala', 'honduras',
  'hungary', 'iceland', 'india', 'indonesia', 'iran', 'iraq', 'ireland',
  'israel', 'italy', 'jamaica', 'japan', 'jordan', 'kazakhstan', 'kenya',
  'kuwait', 'laos', 'latvia', 'lithuania', 'luxembourg', 'madagascar',
  'malawi', 'malaysia', 'maldives', 'mali', 'malta', 'mauritania',
  'mauritius', 'mexico', 'moldova', 'mongolia', 'montenegro', 'morocco',
  'myanmar', 'namibia', 'nepal', 'netherlands', 'nicaragua', 'nigeria',
  'norway', 'oman', 'pakistan', 'palestine', 'panama', 'paraguay', 'peru',
  'philippines', 'poland', 'portugal', 'qatar', 'romania', 'russia',
  'rwanda', 'senegal', 'serbia', 'singapore', 'slovakia', 'slovenia',
  'spain', 'sudan', 'sweden', 'switzerland', 'syria', 'taiwan', 'tanzania',
  'thailand', 'tunisia', 'turkey', 'uganda', 'ukraine', 'uruguay',
  'uzbekistan', 'venezuela', 'vietnam', 'yemen', 'zambia', 'zimbabwe',
];

/** Transforma `united-states` em `United States`. */
function slugParaNome(slug: string): string {
  return slug
    .split('-')
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ');
}

/** Países disponíveis, já em ordem alfabética de exibição. */
export function listCountries(): Country[] {
  return COUNTRY_SLUGS.map((slug) => ({ slug, nome: slugParaNome(slug) }));
}

/**
 * Extrai o ranking de um país.
 *
 * O arquivo é uma tabela HTML dentro de markdown. Cada linha tem a posição
 * num `<td>` e o login no `href` de um link para o perfil. O padrão do login
 * exige que a URL **termine** logo depois dele (`">`), o que descarta de
 * graça os vários links para o próprio repositório espalhados pelo cabeçalho
 * — eles sempre têm mais caminho depois do nome.
 */
export async function fetchCountryUsers(slug: string): Promise<RankedUser[]> {
  let response: Response;

  try {
    // Os arquivos passam de trezentos kilobytes, e uma conexão ruim consegue
    // deixar a transferência pendurada sem nunca falhar. Sem prazo, o painel
    // ficava eternamente em "Lendo o ranking…" — um travamento silencioso,
    // pior que um erro. Com prazo, vira uma mensagem e uma nova tentativa.
    response = await fetch(`${RAW_BASE}/${slug}.md`, {
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new Error(
      `A lista de ${slugParaNome(slug)} não respondeu a tempo. Tente de novo.`,
    );
  }

  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? `Não há lista publicada para "${slug}".`
        : `Não foi possível ler a lista de ${slug} (${response.status}).`,
    );
  }

  const markdown = await response.text();
  const users: RankedUser[] = [];
  const vistos = new Set<string>();

  // Uma linha da tabela por vez: sem isso não dá para saber qual número
  // pertence a qual login.
  for (const row of markdown.split('<tr>')) {
    const login = /<a href="https:\/\/github\.com\/([A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38})">/.exec(
      row,
    )?.[1];
    if (!login || vistos.has(login)) continue;

    // O primeiro número da linha é a posição; o último, as contribuições.
    const numeros = [...row.matchAll(/<td>(\d+)<\/td>/g)].map((m) =>
      Number(m[1]),
    );
    if (numeros.length === 0) continue;

    vistos.add(login);
    users.push({
      login,
      rank: numeros[0],
      contributions: numeros.length > 1 ? numeros[numeros.length - 1] : 0,
    });
  }

  if (users.length === 0) {
    throw new Error(
      'A lista foi lida mas nenhum usuário foi reconhecido — o formato do arquivo de origem provavelmente mudou.',
    );
  }

  users.sort((a, b) => a.rank - b.rank);
  return users;
}
