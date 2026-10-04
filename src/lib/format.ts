const TZ = "America/Sao_Paulo";

/** Data de hoje (YYYY-MM-DD) no fuso de São Paulo. */
export function todayISO(now = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: TZ });
}

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export const monthName = (m: number): string => MONTHS[m - 1] ?? "";

/** 2026-10-04 → 04/10/2026 (sem conversão de fuso). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** 2026-10-04 → dom, 04/10 */
export function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

export const brl = (cents: number): string =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "18,90" ou "1.234,50" → 1890 / 123450. Retorna null se inválido. */
export function parseMoney(input: string): number | null {
  const clean = input.trim().replace(/\s/g, "").replace(/^R\$/, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(parseFloat(clean) * 100);
}

export const isISODate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

// ───────────── trimestres: T1 jan–mar, T2 abr–jun, T3 jul–set, T4 out–dez
export interface Quarter {
  year: number;
  q: 1 | 2 | 3 | 4;
}

export const quarterOf = (iso: string): Quarter => {
  const [y, m] = iso.split("-").map(Number);
  return { year: y, q: (Math.floor((m - 1) / 3) + 1) as Quarter["q"] };
};

/** Meses (1–12) do trimestre. */
export const quarterMonths = (q: Quarter["q"]): [number, number, number] => [q * 3 - 2, q * 3 - 1, q * 3];

export const quarterLabel = ({ year, q }: Quarter): string => `${q}º trimestre ${year}`;

/** Primeiro e último dia do trimestre (YYYY-MM-DD). */
export function quarterRange({ year, q }: Quarter): { from: string; to: string } {
  const [m1, , m3] = quarterMonths(q);
  const last = new Date(Date.UTC(year, m3, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return { from: `${year}-${p(m1)}-01`, to: `${year}-${p(m3)}-${p(last)}` };
}

/** Todos os domingos entre duas datas (inclusive), em ordem. */
export function sundaysBetween(from: string, to: string): string[] {
  const [y, m, d] = from.split("-").map(Number);
  const cur = new Date(Date.UTC(y, m - 1, d));
  cur.setUTCDate(cur.getUTCDate() + ((7 - cur.getUTCDay()) % 7));
  const out: string[] = [];
  for (; cur.toISOString().slice(0, 10) <= to; cur.setUTCDate(cur.getUTCDate() + 7)) {
    out.push(cur.toISOString().slice(0, 10));
  }
  return out;
}

export const sundaysOfQuarter = (q: Quarter): string[] => {
  const { from, to } = quarterRange(q);
  return sundaysBetween(from, to);
};

export const isSunday = (iso: string): boolean => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
};

/** Interpreta "2026-4" (ano-trimestre); devolve o trimestre atual se inválido. */
export function parseQuarter(input: string | undefined, today = todayISO()): Quarter {
  const m = /^(\d{4})-([1-4])$/.exec(input ?? "");
  return m ? { year: Number(m[1]), q: Number(m[2]) as Quarter["q"] } : quarterOf(today);
}

export const quarterKey = ({ year, q }: Quarter): string => `${year}-${q}`;

export function shiftQuarter({ year, q }: Quarter, delta: 1 | -1): Quarter {
  const n = year * 4 + (q - 1) + delta;
  return { year: Math.floor(n / 4), q: ((n % 4) + 1) as Quarter["q"] };
}

/** Idade completada em `onISO` (padrão: hoje). */
export function ageOn(birthISO: string, onISO = todayISO()): number {
  const [by, bm, bd] = birthISO.split("-").map(Number);
  const [y, m, d] = onISO.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
