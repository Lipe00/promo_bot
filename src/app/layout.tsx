import type { ReactNode } from 'react';

export const metadata = { title: 'Promo Bot' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem' }}>{children}</body>
    </html>
  );
}
