import type { DailyPoint } from '../../lib/dashboard.ts';
import { money, shortDay } from './fmt.ts';

/** Gráfico simples em SVG: menor preço por dia, com linhas tracejadas no alvo e no teto. */
export function PriceChart(props: { daily: DailyPoint[]; target: number; ceiling: number }) {
  const { daily, target, ceiling } = props;
  const W = 520;
  const H = 220;
  const pad = { l: 56, r: 12, t: 14, b: 26 };
  const values = [...daily.map((d) => d.min), target, ceiling];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1) {
    hi += 1;
    lo -= 1;
  }
  const span = hi - lo;
  lo = Math.max(0, lo - span * 0.08);
  hi = hi + span * 0.08;

  const x = (i: number) => pad.l + (daily.length <= 1 ? (W - pad.l - pad.r) / 2 : (i / (daily.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const path = daily.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.min).toFixed(1)}`).join(' ');
  const ticks = [lo, (lo + hi) / 2, hi];
  const labelEvery = Math.max(1, Math.ceil(daily.length / 6));

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Histórico do menor preço por dia">
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end">
            {money(t).replace(',00', '')}
          </text>
        </g>
      ))}
      <line className="ref ceiling" x1={pad.l} x2={W - pad.r} y1={y(ceiling)} y2={y(ceiling)} />
      <line className="ref target" x1={pad.l} x2={W - pad.r} y1={y(target)} y2={y(target)} />
      {daily.length > 1 && <path className="line" d={path} />}
      {daily.map((d, i) => (
        <circle key={d.day} className="dot" cx={x(i)} cy={y(d.min)} r={daily.length > 40 ? 1.8 : 3.2}>
          <title>{`${shortDay(d.day)}: ${money(d.min)} (${d.store})`}</title>
        </circle>
      ))}
      {daily.map((d, i) => {
        const last = i === daily.length - 1;
        // Rótulos espaçados; o último sempre aparece, sem encostar no anterior nem sair da borda.
        const show = last || (i % labelEvery === 0 && daily.length - 1 - i >= Math.max(1, labelEvery / 2));
        if (!show) return null;
        return (
          <text key={`l-${d.day}`} x={x(i)} y={H - 8} textAnchor={last && daily.length > 1 ? 'end' : 'middle'}>
            {shortDay(d.day)}
          </text>
        );
      })}
    </svg>
  );
}
