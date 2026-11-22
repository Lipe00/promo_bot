import { timingSafeEqual } from 'node:crypto';

/** Comparação de segredos em tempo constante. Segredo vazio nunca confere. */
export function safeEqual(received: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
