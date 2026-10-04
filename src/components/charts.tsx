/** Gráficos simples em SVG/CSS, renderizados no servidor (sem dependências externas). */

export function HBars({
  rows,
  format = (v) => String(v),
  max,
  unit,
}: {
  rows: { label: string; value: number | null; sub?: string; tone?: "ok" | "warn" | "bad" | "brand" }[];
  format?: (v: number) => string;
  max?: number;
  unit?: string;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <div className="hbars" role="table">
      {rows.map((r) => (
        <div className="hbar" role="row" key={r.label}>
          <div className="hbar-label" role="cell">
            {r.label}
            {r.sub && <span className="muted small"> · {r.sub}</span>}
          </div>
          <div className="hbar-track" role="cell" aria-label={`${r.label}: ${r.value === null ? "sem dados" : format(r.value)}`}>
            <span className={`tone-${r.tone ?? "brand"}`} style={{ width: `${r.value === null ? 0 : Math.max(1.5, (r.value / top) * 100)}%` }} />
          </div>
          <div className="hbar-value" role="cell">{r.value === null ? "—" : format(r.value)}{r.value !== null && unit ? unit : ""}</div>
        </div>
      ))}
    </div>
  );
}

/** Colunas verticais para séries curtas (ex.: tendência por trimestre). */
export function Columns({
  points,
  format = (v) => String(v),
  height = 120,
}: {
  points: { label: string; value: number | null }[];
  format?: (v: number) => string;
  height?: number;
}) {
  const top = Math.max(1, ...points.map((p) => p.value ?? 0));
  return (
    <div className="cols" style={{ height: height + 44 }}>
      {points.map((p, i) => (
        <div className="col" key={p.label}>
          <div className="col-value small">{p.value === null ? "—" : format(p.value)}</div>
          <div className="col-bar" style={{ height: p.value === null ? 2 : Math.max(3, (p.value / top) * height), opacity: i === points.length - 1 ? 1 : 0.55 }} />
          <div className="col-label small muted">{p.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Barra empilhada para composição (ex.: situação dos relatórios). */
export function Stacked({ parts }: { parts: { label: string; value: number; tone: "ok" | "warn" | "bad" | "brand" | "muted" }[] }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <div>
      <div className="stacked" aria-hidden>
        {parts.filter((p) => p.value > 0).map((p) => (
          <span key={p.label} className={`tone-${p.tone}`} style={{ width: `${(p.value / Math.max(total, 1)) * 100}%` }} />
        ))}
      </div>
      <ul className="legend small">
        {parts.map((p) => (
          <li key={p.label}><i className={`tone-${p.tone}`} /> {p.label}: <strong>{p.value}</strong></li>
        ))}
      </ul>
    </div>
  );
}
