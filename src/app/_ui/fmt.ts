// Formatação usada nos componentes do painel (roda no navegador).

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function money(n: number | null | undefined): string {
  return typeof n === 'number' ? brl.format(n).replace(/ /g, ' ') : '—';
}

const dt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dt.format(d).replace(',', ' às');
}

export function shortDay(day: string): string {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'nunca';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

export const STATUS_LABEL: Record<string, string> = {
  abaixo: '🔥 abaixo do alvo',
  margem: '👀 na margem',
  acima: 'acima do teto',
  sem_dados: 'sem preço ainda',
};
