import { requireUser } from "@/lib/auth";
import { monthName, todayISO } from "@/lib/format";
import { guarded } from "@/lib/guard";
import { listBirthdays } from "@/lib/repo";
import Link from "next/link";
import { CATEGORIES, CATEGORY_LABEL, CATEGORY_SINGULAR, type Category } from "@/lib/labels";
import { Empty } from "@/components/ui";

export default async function BirthdaysPage({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tipo = CATEGORIES.find((c) => c === sp.tipo) as Category | undefined;
  const today = todayISO();
  const everyone = guarded(() => listBirthdays(user, today));
  const all = tipo ? everyone.filter((b) => b.categories.includes(tipo)) : everyone;
  const curMonth = Number(today.split("-")[1]);

  // ordena começando pelo mês atual
  const months = [...new Set(all.map((b) => b.month))].sort(
    (a, b) => ((a - curMonth + 12) % 12) - ((b - curMonth + 12) % 12),
  );

  return (
    <>
      <h1>Aniversariantes</h1>
      <div className="tabs">
        <Link href="/aniversariantes" className={!tipo ? "active" : ""}>Todos</Link>
        {CATEGORIES.filter((c) => everyone.some((b) => b.categories.includes(c))).map((c) => (
          <Link key={c} href={`/aniversariantes?tipo=${c}`} className={tipo === c ? "active" : ""}>{CATEGORY_LABEL[c]}</Link>
        ))}
      </div>
      {all.length === 0 && <Empty>Nenhum aniversariante visível para você.</Empty>}
      {months.map((m) => (
        <div className="card" key={m}>
          <h3 style={{ textTransform: "capitalize" }}>
            {monthName(m)} {m === curMonth && <span className="badge ok">este mês</span>}
          </h3>
          <table>
            <tbody>
              {all.filter((b) => b.month === m).map((b) => (
                <tr key={b.id}>
                  <td className="nowrap" style={{ width: "5rem" }}><strong>{String(b.day).padStart(2, "0")}/{String(b.month).padStart(2, "0")}</strong></td>
                  <td>{b.name} <span className="muted small">{b.categories.map((c) => CATEGORY_SINGULAR[c]).join(" · ")}</span> {b.isToday && <span className="badge ok">hoje 🎉</span>}</td>
                  <td className="muted">{b.classes.join(", ")}</td>
                  <td className="right muted">{b.turning} anos</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
