'use client';

import type { ReactNode } from 'react';

const TABS = [
  { href: '/', label: 'Buscas', id: 'buscas' },
  { href: '/cupons', label: 'Cupons', id: 'cupons' },
  { href: '/canais', label: 'Canais', id: 'canais' },
] as const;

/** Topo comum: marca, ações da página, sair e navegação entre Buscas · Cupons · Canais. */
export function Shell(props: { username: string; active: (typeof TABS)[number]['id']; actions?: ReactNode; children: ReactNode }) {
  async function logout() {
    await fetch('/api/ui/logout', { method: 'POST' }).catch(() => null);
    window.location.replace('/login');
  }
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            Promo Bot<small className="only-wide">{props.username}</small>
          </div>
          {props.actions}
          <button className="btn" onClick={logout} title="Sair">
            Sair
          </button>
        </div>
        <nav className="mainnav" aria-label="Seções">
          {TABS.map((t) => (
            <a key={t.id} href={t.href} className="navlink" aria-current={props.active === t.id ? 'page' : undefined}>
              {t.label}
            </a>
          ))}
        </nav>
      </header>
      {props.children}
    </>
  );
}
