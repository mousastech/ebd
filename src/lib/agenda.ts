/**
 * Agenda da EBD: eventos com público-alvo, confirmação de presença (vou / talvez / não vou),
 * arquivo .ics por evento, link "Adicionar ao Google Agenda" e assinatura do calendário (feed ICS pessoal).
 */
import crypto from "node:crypto";
import { authorize, can, ForbiddenError, type Subject } from "./abac";
import { audienceResource, describeAudience, matchesAudience, parseAudience, type Audience } from "./audience";
import { db } from "./db";
import { notifyUsers, usersWhere } from "./notify";
import { UserError } from "./repo";
import { loadSubject } from "./subject";

type Id = number;
export type Rsvp = "sim" | "nao" | "talvez";
export interface EventRow extends Audience {
  id: Id;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  rsvp: number;
  audienceLabel: string;
  mine: Rsvp | null;
  counts: { sim: number; talvez: number; nao: number; guests: number };
  canEdit: boolean;
}

const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function rawEvent(id: Id) {
  const e = db().prepare(`SELECT * FROM events WHERE id=?`).get(id) as (Audience & { id: Id; title: string; rsvp: number; starts_at: string }) | undefined;
  if (!e) throw new UserError("Evento não encontrado.");
  return e;
}

function visible(u: Subject, e: Audience): boolean {
  return (u.view == null || e.congregation_id === null || e.congregation_id === u.view) &&
    can(u, "read", audienceResource("event", e)) && matchesAudience(u, e);
}

export function listEvents(u: Subject, opts: { from?: string; past?: boolean } = {}): EventRow[] {
  const now = opts.from ?? new Date().toISOString().slice(0, 16);
  const rows = db()
    .prepare(`SELECT e.*,
                (SELECT answer FROM event_rsvps r WHERE r.event_id=e.id AND r.person_id=?) AS mine,
                (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id=e.id AND r.answer='sim') AS c_sim,
                (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id=e.id AND r.answer='talvez') AS c_talvez,
                (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id=e.id AND r.answer='nao') AS c_nao,
                (SELECT COALESCE(SUM(guests),0) FROM event_rsvps r WHERE r.event_id=e.id AND r.answer='sim') AS c_guests
              FROM events e WHERE ${opts.past ? "COALESCE(e.ends_at, e.starts_at) < ?" : "COALESCE(e.ends_at, e.starts_at) >= ?"}
              ORDER BY e.starts_at ${opts.past ? "DESC" : "ASC"} LIMIT 200`)
    .all(u.personId, now) as (Omit<EventRow, "audienceLabel" | "counts" | "canEdit"> & { c_sim: number; c_talvez: number; c_nao: number; c_guests: number })[];
  return rows
    .filter((e) => visible(u, e))
    .map(({ c_sim, c_talvez, c_nao, c_guests, ...e }) => ({
      ...e,
      audienceLabel: describeAudience(e),
      counts: { sim: c_sim, talvez: c_talvez, nao: c_nao, guests: c_guests },
      canEdit: can(u, "update", audienceResource("event", e)) && (e.congregation_id !== null || u.role === "pastor"),
    }));
}

export function createEvent(
  u: Subject,
  d: { audience: string; title: string; description: string; location: string; startsAt: string; endsAt: string; rsvp: boolean; allCongregations?: boolean; notify: boolean },
): Id {
  let a: Audience;
  try {
    a = parseAudience(d.audience, d.allCongregations ? null : u.view ?? u.home ?? 1);
  } catch {
    throw new UserError("Público inválido.");
  }
  if (a.congregation_id === null && u.role !== "pastor") throw new ForbiddenError("Só o Pastor/Presidente cria eventos para todas as congregações.");
  authorize(u, "create", audienceResource("event", a));
  if (!d.title.trim()) throw new UserError("Informe o título do evento.");
  if (!LOCAL_DT.test(d.startsAt)) throw new UserError("Informe data e hora de início.");
  if (d.endsAt && (!LOCAL_DT.test(d.endsAt) || d.endsAt < d.startsAt)) throw new UserError("O término deve ser depois do início.");
  const id = Number(
    db()
      .prepare(`INSERT INTO events (congregation_id, audience_kind, audience_value, title, description, location, starts_at, ends_at, rsvp, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(a.congregation_id, a.audience_kind, a.audience_value, d.title.trim().slice(0, 120), d.description.trim() || null, d.location.trim() || null,
        d.startsAt, d.endsAt || null, d.rsvp ? 1 : 0, u.personId, new Date().toISOString())
      .lastInsertRowid,
  );
  if (d.notify) {
    const when = `${d.startsAt.slice(8, 10)}/${d.startsAt.slice(5, 7)} às ${d.startsAt.slice(11)}`;
    notifyUsers(usersWhere((s) => s.userId !== u.userId && matchesAudience(s, a)), { title: `📅 ${d.title.trim()}`, body: `${when}${d.location ? ` · ${d.location}` : ""}`, url: "/agenda" });
  }
  return id;
}

export function deleteEvent(u: Subject, id: Id): void {
  const e = rawEvent(id);
  if (e.congregation_id === null && u.role !== "pastor") throw new ForbiddenError();
  authorize(u, "delete", audienceResource("event", e));
  db().prepare(`DELETE FROM events WHERE id=?`).run(id);
}

export function answerRsvp(u: Subject, eventId: Id, answer: Rsvp, guests: number): void {
  const e = rawEvent(eventId);
  if (!visible({ ...u, view: null }, e)) throw new ForbiddenError();
  if (!e.rsvp) throw new UserError("Este evento não pede confirmação.");
  if (!["sim", "nao", "talvez"].includes(answer)) throw new UserError("Resposta inválida.");
  const g = Math.max(0, Math.min(20, Math.trunc(guests || 0)));
  db()
    .prepare(`INSERT INTO event_rsvps (event_id, person_id, answer, guests, updated_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(event_id, person_id) DO UPDATE SET answer=excluded.answer, guests=excluded.guests, updated_at=excluded.updated_at`)
    .run(eventId, u.personId, answer, answer === "sim" ? g : 0, new Date().toISOString());
}

/** Lista de confirmados (para quem organiza). */
export function eventAttendees(u: Subject, eventId: Id) {
  const e = rawEvent(eventId);
  authorize(u, "update", audienceResource("event", e));
  return db()
    .prepare(`SELECT p.name, r.answer, r.guests FROM event_rsvps r JOIN people p ON p.id=r.person_id WHERE r.event_id=? ORDER BY r.answer, p.name`)
    .all(eventId) as { name: string; answer: Rsvp; guests: number }[];
}

// ───────────────────────────── calendário (ICS) e Google Agenda
const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);
const icsDate = (local: string) => local.replace(/[-:]/g, "") + "00"; // horário local (TZID)

function addHours(local: string, h: number): string {
  const d = new Date(`${local}:00Z`);
  d.setUTCHours(d.getUTCHours() + h);
  return d.toISOString().slice(0, 16);
}

export function eventsIcs(events: { id: Id; title: string; description: string | null; location: string | null; starts_at: string; ends_at: string | null }[], calName: string): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EBD//Agenda//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(calName)}`, "X-WR-TIMEZONE:America/Sao_Paulo",
    // Brasília: UTC−3 sem horário de verão desde 2019
    "BEGIN:VTIMEZONE", "TZID:America/Sao_Paulo", "BEGIN:STANDARD", "DTSTART:19700101T000000",
    "TZOFFSETFROM:-0300", "TZOFFSETTO:-0300", "TZNAME:-03", "END:STANDARD", "END:VTIMEZONE",
  ];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT", `UID:ebd-evento-${e.id}@ebd`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=America/Sao_Paulo:${icsDate(e.starts_at)}`,
      `DTEND;TZID=America/Sao_Paulo:${icsDate(e.ends_at ?? addHours(e.starts_at, 2))}`,
      `SUMMARY:${icsEscape(e.title)}`,
      ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
      ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function googleCalendarUrl(e: { title: string; description: string | null; location: string | null; starts_at: string; ends_at: string | null }): string {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${icsDate(e.starts_at)}/${icsDate(e.ends_at ?? addHours(e.starts_at, 2))}`,
    ctz: "America/Sao_Paulo",
    details: e.description ?? "",
    location: e.location ?? "",
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export function eventForIcs(u: Subject, id: Id) {
  const e = db().prepare(`SELECT * FROM events WHERE id=?`).get(id) as (Audience & { id: Id; title: string; description: string | null; location: string | null; starts_at: string; ends_at: string | null }) | undefined;
  if (!e || !visible({ ...u, view: null }, e)) return null;
  return e;
}

/** Token pessoal do feed do calendário (para assinar no Google Agenda / iPhone). */
export function calendarToken(u: Subject, rotate = false): string {
  const cur = (db().prepare(`SELECT calendar_token t FROM users WHERE id=?`).get(u.userId) as { t: string | null }).t;
  if (cur && !rotate) return cur;
  const t = crypto.randomBytes(18).toString("base64url");
  db().prepare(`UPDATE users SET calendar_token=? WHERE id=?`).run(t, u.userId);
  return t;
}

export function feedForToken(token: string): string | null {
  if (!/^[\w-]{20,40}$/.test(token)) return null;
  const row = db().prepare(`SELECT id FROM users WHERE calendar_token=?`).get(token) as { id: Id } | undefined;
  const s = row ? loadSubject(row.id) : null;
  if (!s) return null;
  const since = new Date(Date.now() - 60 * 86400 * 1000).toISOString().slice(0, 16);
  const evs = listEvents({ ...s, view: null }, { from: since });
  return eventsIcs(evs, "Agenda da EBD");
}
