'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import type { AccountDialog } from '../../lib/channels/reader.ts';
import type { TgChannel } from '../../lib/types.ts';
import { ago } from './fmt.ts';
import { Panel } from './Panel.tsx';
import { Shell } from './Shell.tsx';

type Dialog = AccountDialog & { added: boolean };

export function Channels(props: { username: string; initial: TgChannel[]; accountConfigured: boolean }) {
  const [channels, setChannels] = useState(props.initial);
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<Dialog[] | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  async function reload() {
    const res = await fetch('/api/ui/channels', { cache: 'no-store' });
    if (res.status === 401) return window.location.replace('/login');
    if (res.ok) setChannels(((await res.json()) as { channels: TgChannel[] }).channels);
  }

  async function addPublic(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/ui/channels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: input }),
    }).catch(() => null);
    setBusy(false);
    const body = (await res?.json().catch(() => ({}))) as { error?: string; channel?: TgChannel } | undefined;
    if (!res?.ok) return setMsg({ text: body?.error ?? 'Não foi possível adicionar.', error: true });
    setInput('');
    setMsg({ text: `Canal adicionado: ${body?.channel?.title}. As mensagens novas começam a ser lidas na próxima rodada (a cada 10 min).` });
    await reload();
  }

  async function openPicker() {
    setPicker([]);
    setPickerError(null);
    const res = await fetch('/api/ui/channels/available', { cache: 'no-store' }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { dialogs?: Dialog[]; error?: string } | undefined;
    if (!res?.ok || !body?.dialogs) {
      setPickerError(body?.error ?? 'Não consegui listar os canais da sua conta.');
      return;
    }
    setPicker(body.dialogs);
  }

  async function addFromAccount(d: Dialog) {
    const res = await fetch('/api/ui/channels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tgId: d.tgId, accessHash: d.accessHash, peerType: d.peerType, title: d.title, username: d.username }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    if (!res?.ok) return setPickerError(body?.error ?? 'Não foi possível adicionar.');
    setPicker((list) => list?.map((x) => (x.tgId === d.tgId ? { ...x, added: true } : x)) ?? null);
    await reload();
  }

  async function toggle(c: TgChannel) {
    await fetch(`/api/ui/channels/${c.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !c.enabled }),
    }).catch(() => null);
    await reload();
  }

  async function remove(c: TgChannel) {
    if (!window.confirm(`Parar de monitorar “${c.title || c.username}”?`)) return;
    await fetch(`/api/ui/channels/${c.id}`, { method: 'DELETE' }).catch(() => null);
    await reload();
  }

  const shown = (picker ?? []).filter((d) => !query || d.title.toLowerCase().includes(query.toLowerCase()));

  return (
    <Shell username={props.username} active="canais">
      <main className="wrap">
        <p className="muted small" style={{ marginTop: 16 }}>
          O bot lê as mensagens novas a cada 10 minutos. Posts que batem com suas buscas e cupons novos chegam no seu Telegram. Os posts ficam guardados por 48h.
        </p>

        <form className="addrow" onSubmit={addPublic}>
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="@canal ou t.me/canal (público)"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="Canal público"
          />
          <button className="btn btn-primary" disabled={busy || !input.trim()}>
            {busy ? 'Conferindo…' : '+ Público'}
          </button>
          <button type="button" className="btn" onClick={openPicker} disabled={!props.accountConfigured} title={props.accountConfigured ? '' : 'Conecte sua conta do Telegram (veja o README)'}>
            + Da minha conta
          </button>
        </form>
        {!props.accountConfigured && (
          <p className="muted small">Canais privados e grupos: conecte sua conta do Telegram (passo a passo no README, “Canais do Telegram”).</p>
        )}
        {msg && <div className={`notice${msg.error ? ' error' : ''}`}>{msg.text}</div>}

        {channels.length === 0 ? (
          <div className="empty">
            <p>Nenhum canal monitorado ainda.</p>
          </div>
        ) : (
          <ul className="channel-list">
            {channels.map((c) => {
              const icon = !c.enabled ? '⏸️' : c.last_error ? '⚠️' : c.last_checked_at ? '✅' : '⏳';
              return (
                <li key={c.id} className={`channel${c.enabled ? '' : ' paused'}`}>
                  <div className="channel-main">
                    <strong>
                      {icon} {c.title || (c.username ? `@${c.username}` : `#${c.id}`)}
                    </strong>
                    <span className="muted small">
                      {c.source === 'conta' ? 'pela sua conta' : 'público'}
                      {c.username ? ` · @${c.username}` : ''} · lido {ago(c.last_checked_at)}
                    </span>
                    {c.last_error && <span className="error-text small">{c.last_error}</span>}
                  </div>
                  <div className="channel-actions">
                    <button className="btn" onClick={() => toggle(c)}>
                      {c.enabled ? 'Pausar' : 'Retomar'}
                    </button>
                    <button className="btn btn-danger" onClick={() => remove(c)} aria-label={`Remover ${c.title}`}>
                      Remover
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {picker !== null && (
        <Panel title="Canais e grupos da sua conta" onClose={() => setPicker(null)}>
          {pickerError && <div className="notice error">{pickerError}</div>}
          {!pickerError && picker.length === 0 && <p className="muted">Carregando…</p>}
          {picker.length > 0 && (
            <>
              <input className="input" placeholder="Filtrar" value={query} onChange={(e) => setQuery(e.target.value)} style={{ marginBottom: 12 }} />
              <ul className="channel-list">
                {shown.map((d) => (
                  <li key={d.tgId} className="channel">
                    <div className="channel-main">
                      <strong>{d.title}</strong>
                      <span className="muted small">
                        {d.kind}
                        {d.username ? ` · @${d.username}` : ' · privado'}
                      </span>
                    </div>
                    <div className="channel-actions">
                      <button className="btn" disabled={d.added} onClick={() => addFromAccount(d)}>
                        {d.added ? 'Monitorando ✓' : 'Monitorar'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      )}
    </Shell>
  );
}
