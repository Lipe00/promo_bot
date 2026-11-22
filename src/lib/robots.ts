export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

interface Group {
  agents: string[];
  allow: string[];
  disallow: string[];
}

/** Lê um robots.txt e devolve as regras que valem para o nosso robô (ou para "*"). */
export function parseRobots(text: string, agent: string): RobotsRules {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (current && value) (field === 'allow' ? current.allow : current.disallow).push(value);
    } else {
      lastWasAgent = false;
    }
  }

  const token = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.includes(token));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
  return {
    allow: chosen.flatMap((g) => g.allow),
    disallow: chosen.flatMap((g) => g.disallow),
  };
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + (anchored ? '$' : ''));
}

/** Regra mais longa vence; em empate, "Allow" vence (RFC 9309). */
export function isPathAllowed(rules: RobotsRules, pathAndQuery: string): boolean {
  let bestLen = -1;
  let allowed = true;
  const consider = (patterns: string[], isAllow: boolean) => {
    for (const p of patterns) {
      if (!patternToRegExp(p).test(pathAndQuery)) continue;
      if (p.length > bestLen || (p.length === bestLen && isAllow)) {
        bestLen = p.length;
        allowed = isAllow;
      }
    }
  };
  consider(rules.disallow, false);
  consider(rules.allow, true);
  return allowed;
}

interface CacheEntry {
  rules: RobotsRules | null;
  reason?: string;
  at: number;
}

const cache = new Map<string, CacheEntry>();

export function clearRobotsCache(): void {
  cache.clear();
}

export interface RobotsOptions {
  /** Nome do nosso robô no robots.txt. */
  agent: string;
  userAgent: string;
  timeoutMs?: number;
  ttlMs?: number;
  fetchFn?: typeof fetch;
  now?: () => number;
}

async function loadRobots(origin: string, opts: RobotsOptions, now: number): Promise<CacheEntry> {
  const doFetch = opts.fetchFn ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await doFetch(origin + '/robots.txt', {
      signal: ctrl.signal,
      headers: { 'user-agent': opts.userAgent },
    });
    if (res.status >= 500) return { rules: null, reason: `robots.txt da loja respondeu ${res.status}`, at: now };
    // 4xx = loja não publica robots.txt: nada proibido (RFC 9309).
    if (res.status >= 400) return { rules: { allow: [], disallow: [] }, at: now };
    const text = (await res.text()).slice(0, 500_000);
    return { rules: parseRobots(text, opts.agent), at: now };
  } catch {
    return { rules: null, reason: 'não consegui ler o robots.txt da loja', at: now };
  } finally {
    clearTimeout(timer);
  }
}

/** Confere se o nosso robô pode abrir essa URL. Na dúvida (robots.txt fora do ar), não abre. */
export async function checkRobots(
  url: string,
  opts: RobotsOptions,
): Promise<{ allowed: boolean; reason?: string }> {
  const u = new URL(url);
  const now = (opts.now ?? Date.now)();
  const ttl = opts.ttlMs ?? 6 * 60 * 60 * 1000;

  let entry = cache.get(u.origin);
  if (!entry || now - entry.at > ttl) {
    entry = await loadRobots(u.origin, opts, now);
    cache.set(u.origin, entry);
  }
  if (!entry.rules) return { allowed: false, reason: entry.reason ?? 'robots.txt indisponível' };
  return isPathAllowed(entry.rules, u.pathname + u.search)
    ? { allowed: true }
    : { allowed: false, reason: 'o robots.txt da loja proíbe robôs nesta página' };
}
