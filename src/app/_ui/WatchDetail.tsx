'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { HistoryPoint, StoreOption, WatchDetail } from '../../lib/dashboard.ts';
import { STATUS_LABEL, ago, dateTime, money } from './fmt.ts';
import { PriceChart } from './PriceChart.tsx';

type Tab = 'ofertas' | 'canais' | 'historico' | 'config';

export function WatchDetailView(props: {
  id: number;
  stores: StoreOption[];
  onChanged: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
}) {
  const [data, setData] = useState<WatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('ofertas');

  async function load() {
    const res = await fetch(`/api/ui/watches/${props.id}`, { cache: 'no-store' }).catch(() => null);
    if (res?.status === 401) return window.location.replace('/login');
    if (!res || !res.ok) return setError(res?.status === 404 ? 'Busca não encontrada.' : 'Não consegui carregar.');
    setData((await res.json()) as WatchDetail);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.id]);

  if (error) return <div className="notice error">{error}</div>;
  if (!data) return <p className="muted">Carregando…</p>;
  const { card } = data;

  return (
    <>
      <div className="hero">
        <div className="stat">
          <span>Menor agora</span>
          <strong>{money(card.best?.price)}</strong>
        </div>
        <div className="stat">
          <span>{card.kind === 'categoria' ? 'Teto' : `Alvo (+${card.marginPct}%)`}</span>
          <strong>{card.kind === 'categoria' ? money(card.ceiling) : money(card.target)}</strong>
        </div>
        <div className="stat">
          <span>Menor já visto</span>
          <strong>{money(card.lowestEver)}</strong>
        </div>
      </div>
      <div className="badges" style={{ marginBottom: 12 }}>
        <span className={`badge ${card.status}`}>{STATUS_LABEL[card.status]}</span>
        {card.onlyDeals && <span className="badge deal">só promoções</span>}
        {!card.active && <span className="badge">⏸ pausada</span>}
        <span className="badge">checada {ago(card.lastCheckedAt)}</span>
      </div>

      <div className="tabs" role="tablist">
        {(
          [
            ['ofertas', `Ofertas (${data.offers.length})`],
            ['canais', `Canais (${data.channelPosts.length})`],
            ['historico', 'Histórico'],
            ['config', 'Configurar'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'ofertas' && <Offers data={data} />}
      {tab === 'canais' && <ChannelPosts data={data} />}
      {tab === 'historico' && <History data={data} />}
      {tab === 'config' && (
        <Config
          data={data}
          stores={props.stores}
          onSaved={async () => {
            await load();
            await props.onChanged();
          }}
          onDeleted={props.onDeleted}
        />
      )}
    </>
  );
}

function ChannelPosts({ data }: { data: WatchDetail }) {
  if (data.channelPosts.length === 0) {
    return (
      <p className="muted">
        Nenhum post de canal bateu com esta busca nas últimas 48h. Cadastre canais na aba <a href="/canais">Canais</a>.
      </p>
    );
  }
  return (
    <div>
      {data.channelPosts.map((p) => (
        <div key={p.postId} className="offer">
          <div className="offer-top">
            <strong>{p.channelTitle || 'canal'}</strong>
            <span className="offer-price">{p.price !== null ? money(p.price) : 'sem preço'}</span>
          </div>
          <div className="offer-title">{p.title}</div>
          <div className="offer-meta">
            {p.store && <span>🏪 {p.storeName}</span>}
            {p.coupons.map((c) => (
              <span key={c} className="badge deal">
                🎟️ {c}
              </span>
            ))}
            <span>{dateTime(p.postedAt)}</span>
            {p.postUrl && (
              <a href={p.postUrl} target="_blank" rel="noopener noreferrer">
                post ↗
              </a>
            )}
            {p.offerUrl && (
              <a href={p.offerUrl} target="_blank" rel="noopener noreferrer">
                oferta ↗
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Offers({ data }: { data: WatchDetail }) {
  if (data.offers.length === 0) {
    return <p className="muted">Nenhuma oferta encontrada ainda. Use “Checar agora” ou aguarde a próxima rodada.</p>;
  }
  return (
    <div>
      {data.offers.map((o) => (
        <div key={o.id} className={`offer${o.current ? '' : ' stale'}`}>
          <div className="offer-top">
            <strong>{o.storeName}</strong>
            <span className="offer-price">{money(o.price)}</span>
          </div>
          <div className="offer-title">{o.title}</div>
          <div className="offer-meta">
            {o.regularPrice && o.regularPrice > o.price && <span>de {money(o.regularPrice)}</span>}
            {o.isDeal && <span className="badge deal">promoção</span>}
            {o.endsAt && <span>⏰ até {dateTime(o.endsAt)}</span>}
            {typeof o.shippingPrice === 'number' && <span>🚚 {o.shippingPrice === 0 ? 'frete grátis' : `frete ${money(o.shippingPrice)}`}</span>}
            <span>{o.current ? `visto ${ago(o.lastSeenAt)}` : `não aparece desde ${dateTime(o.lastSeenAt)}`}</span>
            <a href={o.url} target="_blank" rel="noopener noreferrer">
              Abrir na loja ↗
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}

function changes(points: HistoryPoint[]) {
  const last = new Map<string, number>();
  const out: (HistoryPoint & { delta: number | null })[] = [];
  for (const p of points) {
    const prev = last.get(p.store);
    out.push({ ...p, delta: prev === undefined ? null : p.price - prev });
    last.set(p.store, p.price);
  }
  return out.reverse();
}

function History({ data }: { data: WatchDetail }) {
  const { daily, points } = data.history;
  if (points.length === 0) {
    return <p className="muted">Ainda sem histórico. Ele começa a ser registrado a partir da próxima checagem.</p>;
  }
  const list = changes(points).slice(0, 60);
  return (
    <div>
      <PriceChart daily={daily} target={data.card.target} ceiling={data.card.ceiling} />
      <div className="legend">
        <span>
          <i />
          menor preço do dia
        </span>
        <span>
          <i className="target" />
          alvo {money(data.card.target)}
        </span>
        <span>
          <i className="ceiling" />
          teto {money(data.card.ceiling)}
        </span>
      </div>
      <ul className="changes">
        {list.map((p, i) => (
          <li key={`${p.seenAt}-${p.store}-${i}`}>
            <span>
              <span className="muted">{dateTime(p.seenAt)}</span> · {p.storeName}
            </span>
            <span>
              <strong>{money(p.price)}</strong>{' '}
              {p.delta !== null && Math.abs(p.delta) >= 0.01 && (
                <span className={p.delta < 0 ? 'down' : 'up'}>
                  {p.delta < 0 ? '▼' : '▲'} {money(Math.abs(p.delta))}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Config(props: { data: WatchDetail; stores: StoreOption[]; onSaved: () => Promise<void>; onDeleted: () => Promise<void> | void }) {
  const { card } = props.data;
  const [target, setTarget] = useState(String(card.target).replace('.', ','));
  const [margin, setMargin] = useState(String(card.marginPct).replace('.', ','));
  const [chosen, setChosen] = useState<string[]>(props.data.stores ?? []);
  const [onlyDeals, setOnlyDeals] = useState(card.onlyDeals);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/ui/watches/${card.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    const out = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    if (!res?.ok) return setMsg({ text: out?.error ?? 'Não foi possível salvar.', error: true });
    setMsg({ text: okText });
    await props.onSaved();
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    await send(
      { target, margin, onlyDeals, ...(props.data.categoryUrl ? {} : { stores: chosen.length > 0 ? chosen : null }) },
      'Alterações salvas.',
    );
  }

  async function remove() {
    if (!window.confirm(`Remover a busca “${card.label}”? O histórico dela também será apagado.`)) return;
    setBusy(true);
    const res = await fetch(`/api/ui/watches/${card.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setMsg({ text: 'Não foi possível remover.', error: true });
    await props.onDeleted();
  }

  return (
    <form className="form" onSubmit={save}>
      <div className="field">
        <span className="hint">{props.data.categoryUrl ? `Link: ${props.data.categoryUrl}` : `Busca: ${props.data.query}`}</span>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="ct">{card.kind === 'categoria' ? 'Teto (R$)' : 'Preço alvo (R$)'}</label>
          <input id="ct" className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="cm">Margem (%)</label>
          <input id="cm" className="input" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} required />
        </div>
      </div>
      {!props.data.categoryUrl && (
        <fieldset className="field">
          <legend>Lojas</legend>
          <span className="hint">Nenhuma marcada = todas as lojas ligadas.</span>
          <div className="checks">
            {props.stores.map((s) => (
              <label key={s.id} className="check">
                <input
                  type="checkbox"
                  checked={chosen.includes(s.id)}
                  onChange={() => setChosen((c) => (c.includes(s.id) ? c.filter((x) => x !== s.id) : [...c, s.id]))}
                />
                {s.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className="switch">
        <input type="checkbox" checked={onlyDeals} onChange={(e) => setOnlyDeals(e.target.checked)} />
        <span>
          Apenas promoções
          <small>Só avisa ofertas com preço de/por (riscado) ou com prazo de fim.</small>
        </span>
      </label>
      {msg && (
        <div className={`notice${msg.error ? ' error' : ''}`} role="status">
          {msg.text}
        </div>
      )}
      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Salvar
        </button>
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={() => send({ active: !card.active }, card.active ? 'Busca pausada.' : 'Busca ativada.')}
        >
          {card.active ? '⏸ Pausar' : '▶ Ativar'}
        </button>
        <button className="btn btn-danger" type="button" disabled={busy} onClick={remove}>
          Remover
        </button>
      </div>
    </form>
  );
}
