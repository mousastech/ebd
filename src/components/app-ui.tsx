/** Componentes visuais no padrão de aplicativo (cartão de destaque, barras, chips, gráfico de linha). */
import type { ReportStatus } from "@/lib/abac";

export function Hero({
  eyebrow,
  value,
  caption,
  stats,
  icon,
}: {
  eyebrow?: string;
  value: React.ReactNode;
  caption?: string;
  stats?: { label: string; value: React.ReactNode }[];
  icon?: React.ReactNode;
}) {
  return (
    <section className="hero">
      {eyebrow && <div className="hero-eyebrow">{eyebrow}</div>}
      <div className="hero-main">
        {icon && <div className="hero-icon" aria-hidden="true">{icon}</div>}
        <span className="hero-value">{value}</span>
        {caption && <span className="hero-caption">{caption}</span>}
      </div>
      {stats && (
        <div className="hero-stats">
          {stats.map((s) => (
            <div key={s.label}><strong>{s.value}</strong><span>{s.label}</span></div>
          ))}
        </div>
      )}
    </section>
  );
}

export function Progress({ value, max, tone }: { value: number; max: number; tone?: "ok" | "warn" | "bad" | "brand" }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <span className={`tone-${tone ?? "brand"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Avatar({ name, photo }: { name: string; photo?: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (photo) return <img src={`/arquivos/${photo}`} alt="" className="avatar-sm" loading="lazy" />;
  const ini = name.replace(/^(Pr|Pb|Ev|Dc|Ir)\.\s+/i, "").split(" ").filter(Boolean);
  const txt = ((ini[0]?.[0] ?? "") + (ini.length > 1 ? ini[ini.length - 1][0] : "")).toUpperCase();
  return <span className="avatar-sm" aria-hidden="true">{txt}</span>;
}

const CHIP: Record<ReportStatus | "nao", { label: string; cls: string }> = {
  nao: { label: "Não iniciada", cls: "" },
  pendente: { label: "Lançada", cls: "brand" },
  enviada: { label: "Enviada", cls: "brand" },
  devolvida: { label: "Devolvida", cls: "bad" },
  validada: { label: "Validada", cls: "ok" },
};

export function LessonChip({ recorded, status }: { recorded: boolean; status: ReportStatus }) {
  const c = !recorded && status === "pendente" ? CHIP.nao : CHIP[status];
  return <span className={`chip ${c.cls}`}><i aria-hidden="true" />{c.label}</span>;
}

export const pctTone = (p: number | null): "ok" | "warn" | "bad" | "brand" =>
  p === null ? "brand" : p >= 75 ? "ok" : p >= 50 ? "warn" : "bad";

/** Gráfico de linha com área (SVG puro). */
export function LineChart({ points, height = 170 }: { points: { label: string; value: number | null }[]; height?: number }) {
  const W = 340, H = height, padX = 14, padTop = 22, padBottom = 26;
  const vals = points.map((p) => p.value ?? 0);
  const max = Math.max(1, ...vals);
  const x = (i: number) => padX + (points.length > 1 ? (i * (W - 2 * padX)) / (points.length - 1) : (W - 2 * padX) / 2);
  const y = (v: number) => padTop + (1 - v / max) * (H - padTop - padBottom);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value ?? 0).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - padBottom} L${x(0).toFixed(1)},${H - padBottom} Z`;
  const every = Math.ceil(points.length / 6);
  return (
    <svg className="linechart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Presentes por aula">
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <line key={g} x1={padX} x2={W - padX} y1={y(max * g)} y2={y(max * g)} className="grid" />
      ))}
      {points.length > 0 && <path d={area} className="area" />}
      {points.length > 0 && <path d={line} className="line" />}
      {points.map((p, i) => (
        <g key={p.label + i}>
          <circle cx={x(i)} cy={y(p.value ?? 0)} r="3.5" className="dot" />
          <text x={x(i)} y={y(p.value ?? 0) - 8} textAnchor="middle" className="val">{p.value ?? "–"}</text>
          {i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" className="lbl">{p.label}</text>}
        </g>
      ))}
    </svg>
  );
}
