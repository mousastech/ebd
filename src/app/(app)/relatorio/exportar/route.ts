import { ForbiddenError, canSeeSomething } from "@/lib/abac";
import { currentUser } from "@/lib/auth";
import { isISODate, parseQuarter, quarterKey, shiftQuarter } from "@/lib/format";
import { listFinance } from "@/lib/finance";
import { magazineSuggestion } from "@/lib/insights";
import { listVisitors } from "@/lib/visitors";
import { getBlankRoster, getConsolidated, getPersonFrequency, listAbsentees, listGroups, listOrders } from "@/lib/repo";
import { absenteesCsv, consolidatedCsv, financeCsv, frequencyCsv, materialsCsv, orderCsv, rosterCsv, visitorsCsv } from "@/lib/report-csv";

export const dynamic = "force-dynamic";

/**
 * Exportações em CSV (abre no Excel/Planilhas):
 *   ?tipo=consolidado (padrão) — por classe e mês;  ?tipo=frequencia — por pessoa;  ?tipo=materiais — revistas e saldo;
 *   ?tipo=chamada — lista de chamada em branco (&classe=ID opcional);  ?tipo=ausentes — faltas seguidas (&n=3).
 * Cada exportação respeita as mesmas permissões das telas.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Não autenticado.", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const quarter = parseQuarter(sp.get("t") ?? undefined);
  const tipo = sp.get("tipo") ?? "consolidado";
  const file = (name: string, body: string) =>
    new Response(body, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"` },
    });
  try {
    const names = new Map(listGroups(user).map((g) => [g.id, g.name]));
    const groupName = (id: number | null) => (id === null ? "Sem escala" : names.get(id) ?? "Sem escala");
    if (tipo === "chamada") {
      const only = Number(sp.get("classe")) || null;
      const sheets = getBlankRoster(user, quarter).filter((x) => !only || x.cls.id === only);
      if (sheets.length === 0) throw new ForbiddenError();
      return file(`lista-chamada-${quarterKey(quarter)}`, rosterCsv(sheets));
    }
    if (tipo === "ausentes") {
      if (!canSeeSomething(user, "consolidated")) throw new ForbiddenError();
      const n = Math.min(Math.max(Number(sp.get("n")) || 3, 2), 10);
      return file("ausentes-ebd", absenteesCsv(listAbsentees(user, n)));
    }
    if (tipo === "financeiro") {
      const de = sp.get("de") ?? "", ate = sp.get("ate") ?? "";
      if (!isISODate(de) || !isISODate(ate)) throw new ForbiddenError("Período inválido.");
      if (!canSeeSomething(user, "finance")) throw new ForbiddenError();
      return file(`caixa-ebd-${de}-a-${ate}`, financeCsv(listFinance(user, de, ate)));
    }
    if (tipo === "pedido") {
      const cur = parseQuarter(undefined);
      let base = cur;
      let s = magazineSuggestion(user, base);
      if (s.length && s.every((x) => x.mediaPresentes === null)) { base = shiftQuarter(cur, -1); s = magazineSuggestion(user, base); }
      if (s.length === 0) throw new ForbiddenError();
      return file(`pedido-revistas-${quarterKey(shiftQuarter(cur, 1))}`, orderCsv(s));
    }
    if (tipo === "visitantes") {
      if (!canSeeSomething(user, "visitor")) throw new ForbiddenError();
      return file("visitantes-ebd", visitorsCsv(listVisitors(user)));
    }
    if (tipo === "materiais" && !canSeeSomething(user, "material_order")) throw new ForbiddenError();
    if (tipo === "materiais") return file("revistas-ebd", materialsCsv(listOrders(user)));
    const consolidated = getConsolidated(user, quarter);
    if (tipo === "frequencia") {
      const items = consolidated.classes.flatMap((c) => {
        const f = getPersonFrequency(user, c.cls.id, quarter);
        const base = { escala: groupName(c.cls.group_id), classe: c.cls.name };
        return [
          ...f.alunos.map((p) => ({ ...base, tipo: "Aluno" as const, nome: p.name, presentes: p.presentes, total: p.total, pct: p.pct })),
          ...f.professores.map((p) => ({ ...base, tipo: "Professor" as const, nome: p.name, presentes: p.presentes, total: p.total, pct: p.pct })),
        ];
      });
      return file(`frequencia-ebd-${quarterKey(quarter)}`, frequencyCsv(items));
    }
    return file(`relatorio-ebd-${quarterKey(quarter)}`, consolidatedCsv(consolidated, groupName));
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response(e.message, { status: 403 });
    throw e;
  }
}
