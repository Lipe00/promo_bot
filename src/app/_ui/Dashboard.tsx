'use client';

import { useCallback, useEffect, useState } from 'react';
import type { StoreOption, WatchCard } from '../../lib/dashboard.ts';
import { STATUS_LABEL, ago, money } from './fmt.ts';
import { Panel } from './Panel.tsx';
import { Shell } from './Shell.tsx';
import { WatchDetailView } from './WatchDetail.tsx';
import { WatchForm } from './WatchForm.tsx';

type Open = { kind: 'detail'; id: number } | { kind: 'new' } | null;

function openFromUrl(): Open {
  const p = new URLSearchParams(window.location.search).get('p');
  if (p === 'novo') return { kind: 'new' };
  return p && /^\d+$/.test(p) ? { kind: 'detail', id: Number(p) } : null;
}

export function Dashboard(props: { username: string; initialCards: WatchCard[]; stores: StoreOption[] }) {
  const [cards, setCards] = useState(props.initialCards);
  const [stores, setStores] = useState(props.stores);
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/ui/watches', { cache: 'no-store' });
    if (res.status === 401) {
      window.location.replace('/login');
      return;
    }
    if (!res.ok) return;
    const body = (await res.json()) as { cards: WatchCard[]; stores: StoreOption[] };
    setCards(body.cards);
    setStores(body.stores);
  }, []);

  // O painel acompanha a URL (?p=12 ou ?p=novo): o botão voltar do celular fecha o painel.
  useEffect(() => {
    setOpen(openFromUrl());
    const onPop = () => setOpen(openFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function show(next: Open) {
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('p', next.kind === 'new' ? 'novo' : String(next.id));
    else url.searchParams.delete('p');
    if (next && !open) {
      // Abrir cria uma entrada no histórico; o "voltar" do celular fecha o painel.
      window.history.pushState({ panel: true }, '', url);
    } else {
      window.history.replaceState(window.history.state, '', url);
    }
    setOpen(next);
  }

  function close() {
    if (!open) return;
    if (window.history.state?.panel) window.history.back();
    else show(null); // painel aberto direto por link (?p=…): só limpa a URL
  }

  async function checkNow() {
    setChecking(true);
    setNotice(null);
    const res = await fetch('/api/ui/check', { method: 'POST' }).catch(() => null);
    if (!res || !res.ok) {
      setChecking(false);
      setNotice({ text: 'Não consegui iniciar a checagem.', error: true });
      return;
    }
    setNotice({ text: 'Checando as lojas… os preços se atualizam em até um minuto.' });
    for (const wait of [15_000, 20_000, 25_000]) {
      await new Promise((r) => setTimeout(r, wait));
      await refresh();
    }
    setChecking(false);
    setNotice({ text: 'Checagem concluída.' });
  }

  const active = cards.filter((c) => c.active);
  const hot = active.filter((c) => c.status === 'abaixo').length;
  const lastCheck = cards.map((c) => c.lastCheckedAt).filter(Boolean).sort().at(-1) ?? null;
  const selected = open?.kind === 'detail' ? cards.find((c) => c.id === open.id) : undefined;

  return (
    <Shell
      username={props.username}
      active="buscas"
      actions={
        <>
          <button className="btn btn-primary" onClick={() => show({ kind: 'new' })}>
            + <span className="only-wide">Produto</span>
          </button>
          <button className="btn" onClick={checkNow} disabled={checking} title="Checar agora">
            {checking ? '…' : '↻'} <span className="only-wide">Checar agora</span>
          </button>
        </>
      }
    >
      <main className="wrap">
        <div className="summary">
          <span>{active.length} busca(s) ativa(s)</span>
          <span>·</span>
          <span>{hot} abaixo do alvo</span>
          <span>·</span>
          <span>última checagem {ago(lastCheck)}</span>
        </div>
        {notice && (
          <div className={`notice${notice.error ? ' error' : ''}`} role="status">
            {notice.text}
          </div>
        )}

        {cards.length === 0 ? (
          <div className="empty">
            <p>Nenhuma busca ainda.</p>
            <button className="btn btn-primary" onClick={() => show({ kind: 'new' })}>
              Cadastrar o primeiro produto
            </button>
          </div>
        ) : (
          <div className="grid">
            {cards.map((c) => (
              <button
                key={c.id}
                className={`card${c.active ? '' : ' paused'}`}
                onClick={() => show({ kind: 'detail', id: c.id })}
                aria-label={`${c.label}: ${c.best ? money(c.best.price) : 'sem preço'}`}
              >
                <div className="card-title">
                  {c.kind === 'categoria' ? '📦 ' : ''}
                  {c.label}
                </div>
                <div className="badges">
                  {!c.active && <span className="badge">⏸ pausada</span>}
                  {c.active && <span className={`badge ${c.status}`}>{STATUS_LABEL[c.status]}</span>}
                  {c.onlyDeals && <span className="badge deal">só promoções</span>}
                </div>
                <div className={`card-price${c.best ? '' : ' none'}`}>{c.best ? money(c.best.price) : 'Ainda sem preço'}</div>
                <div className="card-meta">
                  {c.best ? `${c.best.storeName} · ${c.best.current ? ago(c.best.seenAt) : 'visto ' + ago(c.best.seenAt)}` : `alvo ${money(c.target)}`}
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {open?.kind === 'new' && (
        <Panel title="Novo produto" onClose={close}>
          <WatchForm
            stores={stores}
            onCreated={async (id) => {
              await refresh();
              show({ kind: 'detail', id });
              setNotice({ text: 'Busca criada. Use "Checar agora" para buscar os preços já.' });
            }}
          />
        </Panel>
      )}
      {open?.kind === 'detail' && (
        <Panel title={selected?.label ?? 'Busca'} onClose={close}>
          <WatchDetailView
            key={open.id}
            id={open.id}
            stores={stores}
            onChanged={refresh}
            onDeleted={async () => {
              await refresh();
              show(null);
            }}
          />
        </Panel>
      )}
    </Shell>
  );
}
