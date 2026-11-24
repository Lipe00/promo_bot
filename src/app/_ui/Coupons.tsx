'use client';

import { useState } from 'react';
import type { CouponRow } from '../../lib/types.ts';
import { ago } from './fmt.ts';
import { Shell } from './Shell.tsx';

const STORES: [string, string][] = [
  ['mercadolivre', 'Mercado Livre'],
  ['amazon', 'Amazon'],
  ['shopee', 'Shopee'],
  ['kabum', 'KaBuM!'],
  ['aliexpress', 'AliExpress'],
  ['magalu', 'Magalu'],
  ['outra', 'Outras'],
];
const NAME = Object.fromEntries(STORES);
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export function Coupons(props: { username: string; initial: CouponRow[]; couponStores: string[] }) {
  const [filter, setFilter] = useState<string>('todas');
  const [copied, setCopied] = useState<number | null>(null);
  const [notify, setNotify] = useState<string[]>(props.couponStores);
  const [saved, setSaved] = useState<string | null>(null);

  const list = props.initial.filter((c) => filter === 'todas' || c.store === filter);
  const counts = new Map<string, number>();
  for (const c of props.initial) counts.set(c.store, (counts.get(c.store) ?? 0) + 1);

  async function copy(c: CouponRow) {
    try {
      await navigator.clipboard.writeText(c.code);
    } catch {
      const t = document.createElement('textarea');
      t.value = c.code;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    setCopied(c.id);
    setTimeout(() => setCopied((x) => (x === c.id ? null : x)), 1500);
  }

  async function toggleNotify(store: string) {
    const next = notify.includes(store) ? notify.filter((s) => s !== store) : [...notify, store];
    setNotify(next);
    setSaved(null);
    const res = await fetch('/api/ui/coupons', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ couponStores: next }),
    }).catch(() => null);
    setSaved(res?.ok ? 'Salvo.' : 'Não consegui salvar.');
  }

  return (
    <Shell username={props.username} active="cupons">
      <main className="wrap">
        <div className="summary">
          <span>{props.initial.length} cupom(ns) vistos nos canais</span>
        </div>

        <div className="chips" role="tablist" aria-label="Filtrar por loja">
          <button className="chip" aria-pressed={filter === 'todas'} onClick={() => setFilter('todas')}>
            Todas
          </button>
          {STORES.filter(([id]) => counts.has(id)).map(([id, name]) => (
            <button key={id} className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {name} <span className="muted">{counts.get(id)}</span>
            </button>
          ))}
        </div>

        {list.length === 0 ? (
          <div className="empty">
            <p>Nenhum cupom ainda.</p>
            <p className="muted">Eles aparecem quando os canais monitorados (aba Canais) postam cupons.</p>
          </div>
        ) : (
          <div className="coupon-grid">
            {list.map((c) => {
              const stale = Date.now() - Date.parse(c.last_seen_at) > STALE_MS;
              return (
                <div key={c.id} className={`coupon${stale ? ' stale' : ''}`}>
                  <div className="coupon-top">
                    <span className="badge">{NAME[c.store] ?? c.store}</span>
                    <span className="muted small">{ago(c.last_seen_at)}</span>
                  </div>
                  <button className="code" onClick={() => copy(c)} aria-label={`Copiar cupom ${c.code}`}>
                    <span>{c.code}</span>
                    <small>{copied === c.id ? 'copiado ✓' : 'copiar'}</small>
                  </button>
                  {c.discount && <div className="coupon-discount">{c.discount}</div>}
                  {c.description && <div className="coupon-desc">{c.description}</div>}
                  <div className="offer-meta">
                    <span>{c.channel_title || 'canal'}</span>
                    {c.post_url && (
                      <a href={c.post_url} target="_blank" rel="noopener noreferrer">
                        post ↗
                      </a>
                    )}
                    {c.offer_url && (
                      <a href={c.offer_url} target="_blank" rel="noopener noreferrer">
                        oferta ↗
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <section className="settings">
          <h3>Avisar no Telegram cupons de</h3>
          <div className="checks">
            {STORES.map(([id, name]) => (
              <label key={id} className="check">
                <input type="checkbox" checked={notify.includes(id)} onChange={() => toggleNotify(id)} />
                {name}
              </label>
            ))}
          </div>
          {saved && <p className="muted small">{saved}</p>}
        </section>
      </main>
    </Shell>
  );
}
