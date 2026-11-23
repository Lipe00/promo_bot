'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import type { StoreOption } from '../../lib/dashboard.ts';

/** Cadastro de produto ou categoria (mesmas regras do /add e /categoria do Telegram). */
export function WatchForm(props: { stores: StoreOption[]; onCreated: (id: number) => void }) {
  const [kind, setKind] = useState<'produto' | 'categoria'>('produto');
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState('');
  const [margin, setMargin] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [onlyDeals, setOnlyDeals] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isLink = /^https?:\/\//i.test(query.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/ui/watches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind,
        query,
        target,
        margin: margin === '' ? null : margin,
        stores: isLink ? null : chosen,
        onlyDeals,
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError('Sem conexão. Tente de novo.');
    const body = (await res.json().catch(() => ({}))) as { id?: number; error?: string };
    if (!res.ok || !body.id) return setError(body.error ?? 'Não foi possível salvar.');
    props.onCreated(body.id);
  }

  function toggle(id: string) {
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="field">
        <span className="sr-only">Tipo</span>
        <div className="segmented" role="group" aria-label="Tipo de busca">
          <button type="button" aria-pressed={kind === 'produto'} onClick={() => setKind('produto')}>
            Produto
          </button>
          <button type="button" aria-pressed={kind === 'categoria'} onClick={() => setKind('categoria')}>
            Categoria
          </button>
        </div>
        <span className="hint">
          {kind === 'produto'
            ? 'O título precisa ter todas as palavras. Um aviso por oferta.'
            : 'Tudo até o teto, num resumo com os mais baratos. Aceita termo ou link de categoria da loja.'}
        </span>
      </div>

      <div className="field">
        <label htmlFor="q">{kind === 'produto' ? 'Produto' : 'Termo ou link da categoria'}</label>
        <input
          id="q"
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={kind === 'produto' ? 'ex.: force one kabuto -almofada' : 'ex.: placa de video rtx 4060'}
          autoCapitalize="none"
          required
        />
        <span className="hint">Use -palavra para excluir títulos com essa palavra.</span>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="t">{kind === 'produto' ? 'Preço alvo (R$)' : 'Teto (R$)'}</label>
          <input id="t" className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="300" required />
        </div>
        <div className="field">
          <label htmlFor="m">Margem (%)</label>
          <input
            id="m"
            className="input"
            inputMode="decimal"
            value={margin}
            onChange={(e) => setMargin(e.target.value)}
            placeholder={kind === 'produto' ? '15' : '0'}
          />
        </div>
      </div>

      {!isLink && (
        <fieldset className="field">
          <legend>Lojas</legend>
          <span className="hint">Nenhuma marcada = todas as lojas ligadas.</span>
          <div className="checks">
            {props.stores
              .filter((s) => s.enabled)
              .map((s) => (
                <label key={s.id} className="check">
                  <input type="checkbox" checked={chosen.includes(s.id)} onChange={() => toggle(s.id)} />
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
          <small>Só avisa ofertas com preço de/por (riscado) ou com prazo de fim. O menor preço continua aparecendo aqui.</small>
        </span>
      </label>

      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar busca'}
        </button>
      </div>
    </form>
  );
}
