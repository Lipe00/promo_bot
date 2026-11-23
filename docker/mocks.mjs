// Servidor falso para os testes locais (porta 4000):
//   - Telegram Bot API: /bot<token>/<método> guarda as mensagens; GET /__messages lista; DELETE limpa.
//   - Loja falsa: /loja/busca?q=... devolve uma página com JSON-LD (usada como "fonte cadastrada").
import { createServer } from 'node:http';

const messages = [];
let nextId = 1;

const CATALOG = [
  { name: 'Headset Gamer Force One Kabuto 7.1 Wireless', price: '279.90', slug: 'kabuto', until: '2099-12-31' },
  { name: 'Almofada de reposição Force One Kabuto', price: '49.90', slug: 'almofada' },
  { name: 'Headset Force One Supersonic', price: '199.90', slug: 'supersonic' },
  { name: 'Placa de Vídeo RTX 4060 8GB', price: '1899.00', slug: 'rtx4060' },
  { name: 'Placa de Vídeo RTX 4060 Ti 16GB', price: '2899.00', slug: 'rtx4060ti' },
  { name: 'Placa de Vídeo RTX 4060 OC White', price: '1949.00', slug: 'rtx4060oc' },
  // Para o teste de "apenas promoções": um sem prazo e um com prazo de fim.
  { name: 'Mouse Gamer Pro X', price: '149.90', slug: 'mouse' },
  { name: 'Mouse Gamer Pro X Edição Limitada', price: '159.90', slug: 'mouse-promo', until: '2099-06-30' },
];

function storePage(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = CATALOG.filter((p) => words.some((w) => p.name.toLowerCase().includes(w)));
  const ld = found.map((p) => ({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    offers: {
      '@type': 'Offer',
      price: p.price,
      priceCurrency: 'BRL',
      url: `http://mocks:4000/loja/p/${p.slug}`,
      ...(p.until ? { priceValidUntil: p.until } : {}),
    },
  }));
  return `<!doctype html><html><body><h1>Loja falsa</h1>${ld
    .map((x) => `<script type="application/ld+json">${JSON.stringify(x)}</script>`)
    .join('')}${'<p>conteúdo</p>'.repeat(50)}</body></html>`;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://mocks');
  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const bot = url.pathname.match(/^\/bot([^/]+)\/(\w+)$/);
  if (bot && req.method === 'POST') {
    const raw = await readBody(req);
    let payload = {};
    try {
      payload = JSON.parse(raw || '{}');
    } catch {}
    messages.push({ method: bot[2], payload, at: new Date().toISOString() });
    return json(200, { ok: true, result: bot[2] === 'sendMessage' ? { message_id: nextId++ } : true });
  }
  if (url.pathname === '/__messages') {
    if (req.method === 'DELETE') {
      messages.length = 0;
      return json(200, { ok: true });
    }
    return json(200, messages);
  }
  if (url.pathname === '/robots.txt') {
    res.writeHead(404);
    return res.end();
  }
  if (url.pathname === '/loja/busca') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(storePage(url.searchParams.get('q') ?? ''));
  }
  if (url.pathname === '/health') return json(200, { ok: true });
  res.writeHead(404);
  res.end('not found');
}).listen(4000, () => console.log('mocks na porta 4000'));
