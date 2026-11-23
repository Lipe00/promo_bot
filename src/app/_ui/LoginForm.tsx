'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

export function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ui/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        window.location.replace('/');
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'Não foi possível entrar.');
    } catch {
      setError('Sem conexão. Tente de novo.');
    }
    setBusy(false);
  }

  return (
    <main className="login">
      <form className="login-box form" onSubmit={submit}>
        <div>
          <h1>Promo Bot</h1>
          <p>Entre para ver suas buscas e promoções.</p>
        </div>
        <div className="field">
          <label htmlFor="u">Usuário</label>
          <input
            id="u"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="p">Senha</label>
          <input
            id="p"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
