import { Letterhead } from "@/components/Letterhead";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/church";
import { monthName, parseQuarter, quarterKey, quarterLabel } from "@/lib/format";
import { guarded } from "@/lib/guard";
import { getQuarterSchedule } from "@/lib/repo";
import { PrintButton } from "@/components/PrintButton";
import { Empty } from "@/components/ui";

/** A folha de uma Escala no formato da planilha: um bloco por classe, três meses lado a lado. */
export default async function PrintSchedule({ searchParams }: { searchParams: Promise<{ t?: string; g?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const quarter = parseQuarter(sp.t);
  const groupId = Number(sp.g);
  const classes = guarded(() => getQuarterSchedule(user, quarter)).filter((c) => c.group?.id === groupId);
  const rowsPerMonth = 5; // como na planilha: o mês com menos domingos ganha linhas em branco

  return (
    <>
      <div className="row noprint" style={{ marginBottom: "1rem" }}>
        <Link className="btn ghost small" href={`/escala?t=${quarterKey(quarter)}`}>← Voltar</Link>
        <PrintButton label="Imprimir / salvar em PDF" />
      </div>
      {classes.length === 0 ? (
        <Empty>Escala não encontrada ou sem acesso.</Empty>
      ) : (
        <div className="paper">
          <Letterhead title="Escala de professores" subtitle={quarterLabel(quarter)} congregationId={user.view} />
          {classes.map((c) => (
            <section key={c.cls.id} style={{ breakInside: "avoid" }}>
              <h2 className="ptitle">
                Classe {c.cls.name} - {quarterLabel(quarter)}
                {c.cls.age_range ? ` - ${c.cls.age_range}` : ""}
              </h2>
              <div className="quarter">
                {c.months.map((m) => (
                  <table key={m.month}>
                    <thead><tr><th colSpan={2}>{monthName(m.month)}</th></tr></thead>
                    <tbody>
                      {Array.from({ length: rowsPerMonth }, (_, i) => {
                        const r = m.rows[i];
                        return (
                          <tr key={i}>
                            <td className="day">{r ? Number(r.date.slice(8)) : ""}</td>
                            {r?.lesson?.kind === "evento" ? (
                              <td className="ev">{r.lesson.event_label}</td>
                            ) : (
                              <td>{r?.lesson?.teacher_name ?? ""}</td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ))}
              </div>
            </section>
          ))}
          <p className="lema">{getSettings().lema}</p>
        </div>
      )}
    </>
  );
}
