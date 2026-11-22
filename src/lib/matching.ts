/** Números por extenso viram dígitos, para "Force One" casar com "Force 1" (e vice-versa). */
const NUMBER_WORDS: Record<string, string> = {
  um: '1', uma: '1', one: '1',
  dois: '2', duas: '2', two: '2',
  tres: '3', three: '3',
  quatro: '4', four: '4',
  cinco: '5', five: '5',
  seis: '6', six: '6',
  sete: '7', seven: '7',
  oito: '8', eight: '8',
  nove: '9', nine: '9',
  dez: '10', ten: '10',
};

export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Palavras normalizadas, com números por extenso trocados por dígitos. */
export function wordsOf(s: string): string[] {
  return normalizeText(s)
    .split(' ')
    .filter(Boolean)
    .map((w) => NUMBER_WORDS[w] ?? w);
}

export interface ParsedQuery {
  include: string[];
  exclude: string[];
  /** Palavras como foram digitadas (sem acento), para mandar à loja. */
  typed: string[];
}

/** "force one kabuto -almofada" → inclui force/1/kabuto, exclui almofada. */
export function parseQuery(raw: string): ParsedQuery {
  const include: string[] = [];
  const exclude: string[] = [];
  const typed: string[] = [];
  for (const part of raw.split(/\s+/)) {
    if (!part) continue;
    const isExclusion = part.length > 1 && part.startsWith('-');
    const text = isExclusion ? part.slice(1) : part;
    if (!isExclusion) typed.push(...normalizeText(text).split(' ').filter(Boolean));
    for (const w of wordsOf(text)) (isExclusion ? exclude : include).push(w);
  }
  return { include: [...new Set(include)], exclude: [...new Set(exclude)], typed: [...new Set(typed)] };
}

/** Chave para agrupar buscas iguais (a ordem das palavras e as exclusões não mudam a busca na loja). */
export function queryKey(raw: string): string {
  return [...parseQuery(raw).include].sort().join(' ');
}

/** O que é digitado no campo de busca das lojas (como o usuário escreveu, sem as exclusões). */
export function searchTerms(raw: string): string {
  return parseQuery(raw).typed.join(' ');
}

/**
 * O título precisa conter TODAS as palavras da busca (palavras curtas: exatas; longas: início da palavra)
 * e nenhuma das excluídas.
 */
export function matchesQuery(title: string, raw: string): boolean {
  const { include, exclude } = parseQuery(raw);
  if (include.length === 0) return false;
  return matchesWords(title, include, exclude);
}

/** Só as exclusões (para categorias por link, onde não há palavras obrigatórias). */
export function passesExclusions(title: string, raw: string): boolean {
  return matchesWords(title, [], parseQuery(raw).exclude);
}

function matchesWords(title: string, include: string[], exclude: string[]): boolean {
  const words = wordsOf(title);
  const has = (t: string) => (t.length <= 3 ? words.includes(t) : words.some((w) => w.startsWith(t)));
  return include.every(has) && !exclude.some(has);
}
