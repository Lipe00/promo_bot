'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/** Painel sobreposto: gaveta lateral no desktop, tela cheia no celular. Esc ou clique fora fecha. */
export function Panel(props: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={props.title} ref={ref} tabIndex={-1}>
        <div className="sheet-head">
          <h2>{props.title}</h2>
          <button className="btn btn-icon" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="sheet-body">{props.children}</div>
      </div>
    </div>
  );
}
