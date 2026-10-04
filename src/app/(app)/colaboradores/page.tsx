import Link from "next/link";
import { saveStaffAttendanceAction } from "@/app/actions-gestao";
import { requireUser } from "@/lib/auth";
import { congregationName } from "@/lib/church";
import { fmtDate, fmtDay, isISODate, todayISO } from "@/lib/format";
import { guarded, type Flash } from "@/lib/guard";
import { staffCongregation, staffRoster } from "@/lib/staffcall";
import { StaffCall } from "@/components/StaffCall";
import { Empty, FlashMessage } from "@/components/ui";

/** Último domingo até a data informada. */
function lastSunday(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export default async function StaffCallPage({ searchParams }: { searchParams: Promise<Flash & { d?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const date = sp.d && isISODate(sp.d) ? sp.d : lastSunday(todayISO());
  const cong = staffCongregation(user);
  if (cong === null) {
    return (
      <>
        <h1>Chamada da equipe</h1>
        <Empty>Escolha uma congregação para fazer a chamada da equipe.</Empty>
        <Link className="btn" href="/congregacoes">Escolher congregação</Link>
      </>
    );
  }
  const roster = guarded(() => staffRoster(user, cong, date));

  return (
    <>
      <div className="pagehead">
        <div><h1>Chamada da equipe</h1><p className="muted small">{fmtDay(date)} · {congregationName(cong)}</p></div>
      </div>
      <FlashMessage flash={sp} />
      <nav className="chips" aria-label="Domingos">
        {[-21, -14, -7, 0, 7].map((n) => addDays(lastSunday(todayISO()), n)).map((d) => (
          <Link key={d} href={`/colaboradores?d=${d}`} className={d === date ? "active" : ""}>{fmtDate(d).slice(0, 5)}</Link>
        ))}
      </nav>
      {roster.people.length === 0 ? <Empty>Nenhuma pessoa na equipe desta congregação.</Empty> : (
        <form action={saveStaffAttendanceAction}>
          <input type="hidden" name="congregation_id" value={cong} />
          <input type="hidden" name="date" value={date} />
          <StaffCall people={roster.people} disabled={!roster.canEdit} />
        </form>
      )}
    </>
  );
}
