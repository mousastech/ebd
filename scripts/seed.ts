/**
 * Dados de demonstração. Todas as contas usam a senha "ebd123".
 *
 * A ESCALA do 4º trimestre de 2026 reproduz a planilha das 11 classes (nomes de classes e de professores
 * como constam nela) e é gravada pelo próprio código do sistema (gerar domingos + salvar escala), o que
 * também exercita as regras de conflito. Alunos, coordenadores, secretários, telefones e datas de
 * nascimento são FICTÍCIOS.
 *
 * Uso: npm run seed   (recria o banco do zero)
 */
import fs from "node:fs";
import path from "node:path";
import type { Subject } from "../src/lib/abac";
import { openDb } from "../src/lib/db";
import { quarterRange, sundaysOfQuarter } from "../src/lib/format";
import { hashPassword } from "../src/lib/password";
import * as repo from "../src/lib/repo";
import * as f from "../src/lib/finance";
import * as sc from "../src/lib/staffcall";
import * as v from "../src/lib/visitors";
import * as ann from "../src/lib/announcements";
import * as ag from "../src/lib/agenda";
import * as lib from "../src/lib/library";
import * as quiz from "../src/lib/quiz";
import * as teach from "../src/lib/teaching";

const file = path.resolve(process.cwd(), process.env.EBD_DB_PATH ?? "data/ebd.db");
for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
const db = openDb(file);
globalThis.__ebdDb = db; // o repo usa este mesmo banco
const PASSWORD_HASH = hashPassword("ebd123");

// ───────────── helpers de cadastro
const addPerson = db.prepare(`INSERT INTO people (name, birth_date, phone, guardian_name) VALUES (?, ?, ?, ?)`);
const person = (name: string, birth: string | null = null, phone: string | null = null, guardian: string | null = null) =>
  Number(addPerson.run(name, birth, phone, guardian).lastInsertRowid);
const addUser = db.prepare(`INSERT INTO users (person_id, email, password_hash, role) VALUES (?, ?, ?, ?)`);
const user = (personId: number, email: string, role: string) => addUser.run(personId, email, PASSWORD_HASH, role);
const staff = (classId: number, personId: number, fn: string) =>
  db.prepare(`INSERT OR IGNORE INTO class_staff (class_id, person_id, function) VALUES (?, ?, ?)`).run(classId, personId, fn);
const enroll = (classId: number, personId: number) =>
  db.prepare(`INSERT INTO enrollments (class_id, person_id) VALUES (?, ?)`).run(classId, personId);

const subject = (personId: number, role: Subject["role"]): Subject => ({
  userId: 0, personId, role, coordinates: [], teaches: [], assists: [], secretaryOf: [], enrolled: [],
});

// ───────────── a escala do 4º trimestre (planilha): outubro (4 domingos), novembro (5), dezembro (4)
const OBREIROS = "e:Reunião de Obreiros";
const rows = (oct: string[], nov: string[], dec: string[]) => [...oct, ...nov, ...dec];

interface ClassSpec {
  name: string;
  age: string | null;
  /** faixa de idade (em anos) usada para gerar alunos fictícios */
  ages: [number, number];
  priceCents: number;
  /** 13 entradas (domingos de out–dez); null = classe remanejada o trimestre inteiro */
  q4: string[] | null;
}

const CLASSES: ClassSpec[] = [
  {
    name: "Cordeirinhos de Jesus", age: "até 3 anos", ages: [1, 3], priceCents: 1490,
    q4: rows(["Jafia", "Socorro", "Suely", "Jafia"], ["Socorro", "Suely", "Jafia", "Socorro", "Suely"], ["Jafia", "Socorro", "Suely", "Jafia"]),
  },
  {
    name: "Sementinhas de Jesus", age: "4 a 6 anos", ages: [4, 6], priceCents: 1590,
    q4: rows(["Cidinha", "Viviane", "Camille", "Cidinha"], ["Cidinha", "Viviane", "Camille", "Cidinha", "Viviane"], ["Camille", "Cidinha", "Camille", "Viviane"]),
  },
  { name: "Amiguinhos de Jesus", age: "7 a 8 anos", ages: [7, 8], priceCents: 1590, q4: null },
  {
    name: "Soldados do Rei", age: "9 a 11 anos", ages: [9, 11], priceCents: 1690,
    q4: rows(["Hosana", "Dilmara", "Nilda", "Silmara"], ["Hosana", "Dilmara", "Nilda", "Silmara", "Hosana"], ["Nilda", "Dilmara", "Silmara", "Hosana"]),
  },
  {
    name: "Campeões de Cristo", age: "12 a 14 anos", ages: [12, 14], priceCents: 1790,
    q4: rows(["Júlia", "Tânia", "Vinicius", "Patricia"], ["Júlia", "Tânia", "Vinicius", "Patricia", "Júlia"], ["Tânia", "Vinicius", "Júlia", "Patricia"]),
  },
  {
    name: "Guerreiros de Deus", age: "15 a 17 anos", ages: [15, 17], priceCents: 1790,
    q4: rows(["Rosana", "Sônia", "Udson", "Rosana"], ["Sônia", "Udson", "Rosana", "Sônia", "Udson"], ["Rosana", "Sônia", "Udson", "Rosana"]),
  },
  {
    name: "Heróis da Fé", age: "maior de 18 anos", ages: [18, 40], priceCents: 1990,
    q4: rows(["Pr. Diego", "Alan", "Patricia", "Wiliiam"], ["Pr. Diego", "Alan", "Patricia", "Wiliiam", "Pr. Diego"], ["Alan", "Patricia", "Wiliiam", "Pr. Diego"]),
  },
  {
    name: "Betel", age: null, ages: [30, 70], priceCents: 2190,
    q4: rows(["Pb. Adilson", OBREIROS, "Pr. Almir", "Pr. Sergio Shigueo"], ["Pb. Adilson", OBREIROS, "Pr. Almir", "Pr. Sergio Shigueo", "Pb. Adilson"], ["Pr. Almir", OBREIROS, "Pr. Sergio Shigueo", "Pb. Adilson"]),
  },
  {
    name: "Atalaias", age: null, ages: [30, 70], priceCents: 2190,
    q4: rows(["Luiz Cunha", "Gevanil", "Moisés", "Luiz Cunha"], ["Gevanil", "Moisés", "Luiz Cunha", "Gevanil", "Moisés"], ["Luiz Cunha", "Gevanil", "Moisés", "Luiz Cunha"]),
  },
  {
    name: "Ebenézer", age: null, ages: [30, 70], priceCents: 2190,
    q4: rows(["Suzette", "Vasti", "Mirian", "Eliane"], ["Suzette", "Vasti", "Mirian", "Eliane", "Suzette"], ["Vasti", "Suzette", "Mirian", "Eliane"]),
  },
  {
    name: "Unidos em Amor", age: null, ages: [30, 70], priceCents: 2190,
    q4: rows(["Assis", "Levi", "Pr. Amaro", "Assis"], ["Pr. Amaro", "Levi", "Assis", "Pr. Amaro", "Levi"], ["Assis", "Levi", "Pr. Amaro", "Assis"]),
  },
];

// ───────────── equipe geral e contas de demonstração (fictícias)
const superint = person("Roberto Almeida", "1972-03-14", "(11) 91111-0001");
user(superint, "super@ebd.local", "superintendente");
const secGeral = person("Marta Ferreira", "1985-10-09", "(11) 91111-0002");
user(secGeral, "secretaria@ebd.local", "secretaria");

// Coordenadores das Escalas (nomes informados; sem telefone nem nascimento inventados)
const rivanildo = person("Rivanildo");
user(rivanildo, "coord.escala1@ebd.local", "coordenador");
const jaasiel = person("Jaasiel");
user(jaasiel, "coord.escala2@ebd.local", "coordenador");
const wanclezia = person("Wanclezia");
user(wanclezia, "coord.escala3@ebd.local", "coordenador");

// Escala = folha de escala com um conjunto de classes e UM coordenador.
// (Assumido pela ordem das folhas recebidas: 1 = classes de adultos, 2 = adolescentes e jovens, 3 = crianças.)
const addGroup = db.prepare(`INSERT INTO class_groups (name, coordinator_id) VALUES (?, ?)`);
const escala1 = Number(addGroup.run("Escala 1", rivanildo).lastInsertRowid);
const escala2 = Number(addGroup.run("Escala 2", jaasiel).lastInsertRowid);
const escala3 = Number(addGroup.run("Escala 3", wanclezia).lastInsertRowid);
const groupOf: Record<string, number> = {
  Betel: escala1, Atalaias: escala1, Ebenézer: escala1, "Unidos em Amor": escala1,
  "Campeões de Cristo": escala2, "Guerreiros de Deus": escala2, "Heróis da Fé": escala2,
  "Cordeirinhos de Jesus": escala3, "Sementinhas de Jesus": escala3, "Amiguinhos de Jesus": escala3, "Soldados do Rei": escala3,
};

// professores: uma pessoa por nome (a Patricia leciona em duas classes)
const teacherIds = new Map<string, number>();
const teacher = (name: string) => {
  if (!teacherIds.has(name)) teacherIds.set(name, person(name));
  return teacherIds.get(name)!;
};

// ───────────── classes, equipe e alunos fictícios
const FIRST = ["Miguel", "Alice", "Davi", "Sofia", "Heitor", "Laura", "Pedro", "Beatriz", "Rafael", "Isabela", "Enzo", "Clara",
  "Thiago", "Camila", "Gabriel", "Larissa", "Mateus", "Júlio", "Samuel", "Marina", "José", "Maria", "Antônio", "Rosa", "Carlos", "Neusa"];
const LAST = ["Andrade", "Barros", "Cardoso", "Duarte", "Esteves", "Fontes", "Gomes", "Haddad", "Ibrahim", "Jardim", "Klein", "Lacerda",
  "Moura", "Neves", "Oliveira", "Pacheco", "Queiroz", "Rangel", "Teixeira", "Uchoa", "Vieira", "Wanderley", "Xavier", "Yamamoto"];

const classId: Record<string, number> = {};
const studentsOf: Record<number, number[]> = {};
let counter = 0;
CLASSES.forEach((c, ci) => {
  const id = Number(
    db.prepare(`INSERT INTO classes (name, age_range, group_id) VALUES (?, ?, ?)`).run(c.name, c.age, groupOf[c.name]).lastInsertRowid,
  );
  classId[c.name] = id;
  for (const n of c.q4 ?? []) if (!n.startsWith("e:")) staff(id, teacher(n), "professor"); // ordem = ordem do rodízio
  studentsOf[id] = [];
  const count = c.q4 === null ? 0 : c.ages[0] >= 30 ? 6 : 5;
  for (let i = 0; i < count; i++) {
    const age = c.ages[0] + ((i + ci) % (c.ages[1] - c.ages[0] + 1));
    const month = ((i * 5 + ci * 3) % 12) + 1;
    const day = ((i * 7 + ci * 11) % 27) + 1;
    const birth = `${2026 - age - (month > 10 ? 1 : 0)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const name = `${FIRST[(counter * 7 + i) % FIRST.length]} ${LAST[(counter * 5 + ci + i * 3) % LAST.length]}`;
    const minor = c.ages[0] < 18;
    const pid = person(name, birth, `(11) 92222-${String(1000 + counter).slice(-4)}`, minor ? `Responsável de ${name.split(" ")[0]}` : null);
    enroll(id, pid);
    studentsOf[id].push(pid);
    counter++;
  }
});

// ───────────── contas de demonstração ligadas às classes
const atalaias = classId["Atalaias"];
const campeoes = classId["Campeões de Cristo"];

const bruna = person("Bruna Siqueira", "1999-10-12", "(11) 91111-0006"); // secretária de sala (função Colaborador)
user(bruna, "sec.atalaias@ebd.local", "colaborador");
staff(atalaias, bruna, "secretario");

const larissa = studentsOf[campeoes][0]; // secretária de sala que é aluna (atributo vale para qualquer função)
user(larissa, "sec.campeoes@ebd.local", "aluno");
staff(campeoes, larissa, "secretario");

user(teacher("Luiz Cunha"), "prof.atalaias@ebd.local", "professor");
user(teacher("Júlia"), "prof.campeoes@ebd.local", "professor");

const paulo = person("Paulo Brandão", "1980-06-06", "(11) 91111-0007");
user(paulo, "colab.atalaias@ebd.local", "colaborador");
staff(atalaias, paulo, "colaborador");

user(studentsOf[atalaias][1], "aluno.atalaias@ebd.local", "aluno");

const U = { super: subject(superint, "superintendente"), sec: subject(secGeral, "secretaria") };
const secretaryOf = (cid: number): number | null =>
  cid === atalaias ? bruna : cid === campeoes ? larissa : null;

// ───────────── histórico: 1º, 2º e 3º trimestres de 2026 (rodízio automático; no 3º, relatórios em vários estágios)
const TOPICS = ["A Criação e a Queda", "O Chamado de Abraão", "A Libertação do Egito", "A Aliança no Sinai", "A Conquista de Canaã",
  "Os Juízes de Israel", "O Reino Unido", "A Sabedoria de Salomão", "Os Profetas", "O Exílio", "O Retorno", "O Nascimento de Jesus", "O Sermão do Monte"];

const setLesson = db.prepare(
  `UPDATE lessons SET topic=?, notes=?, visitors=?, offering_cents=?, status='realizada', report_status=?,
          submitted_by=?, submitted_at=?, validated_by=?, validated_at=?, return_note=? WHERE id=?`,
);
const addAtt = db.prepare(`INSERT INTO attendance (lesson_id, person_id, present) VALUES (?, ?, ?)`);

/** absentEvery: 1 falta a cada N registros (N maior = frequência maior), para a tendência do painel. */
function history(Q: { year: number; q: 1 | 2 | 3 }, absentEvery: number, offeringBase: number, stages: boolean) {
  const { from, to } = quarterRange(Q);
  CLASSES.forEach((c, ci) => {
    if (c.q4 === null) return; // classe remanejada: sem histórico
    const cid = classId[c.name];
    repo.generateQuarterSchedule(U.super, cid, Q, "rodizio");
    const lessons = db.prepare(`SELECT id, date, teacher_id FROM lessons WHERE class_id=? AND date BETWEEN ? AND ? ORDER BY date`)
      .all(cid, from, to) as { id: number; date: string; teacher_id: number | null }[];

    // Reunião de Obreiros: 2º domingo de cada mês na Betel
    if (c.name === "Betel") {
      const months = [...new Set(lessons.map((l) => l.date.slice(5, 7)))];
      const second = (m: string) => lessons.filter((l) => l.date.slice(5, 7) === m)[1];
      repo.saveQuarterSchedule(U.super, cid, months.map((m) => ({ lessonId: second(m).id, value: OBREIROS })));
    }
    const events = new Set(
      (db.prepare(`SELECT id FROM lessons WHERE class_id=? AND kind='evento'`).all(cid) as { id: number }[]).map((r) => r.id),
    );

    lessons.forEach((l, di) => {
      if (events.has(l.id)) return;
      const filler = secretaryOf(cid) ?? l.teacher_id ?? secGeral;
      let stage: "validada" | "devolvida" | "enviada" | "pendente" = "validada";
      if (stages) {
        if (l.date === "2026-09-20" && c.name === "Campeões de Cristo") stage = "devolvida";
        if (l.date === "2026-09-27") stage = ["Atalaias", "Soldados do Rei", "Betel"].includes(c.name) ? "enviada" : c.name === "Campeões de Cristo" ? "pendente" : "validada";
      }
      if (stage === "pendente") return; // aula realizada, mas nada lançado ainda

      studentsOf[cid].forEach((sid, si) => addAtt.run(l.id, sid, (si * 3 + di * 5 + ci) % absentEvery === 0 ? 0 : 1));
      if (l.teacher_id) addAtt.run(l.id, l.teacher_id, (di + ci) % 11 === 0 ? 0 : 1);

      const sent = `${l.date}T18:00:00.000Z`;
      setLesson.run(
        TOPICS[di % TOPICS.length], "Boa participação da classe.", (di + ci) % 3, offeringBase + ((di * 7 + ci * 13) % 9) * 250,
        stage, filler, sent,
        stage === "validada" ? secGeral : null, stage === "validada" ? sent : null,
        stage === "devolvida" ? "Faltou conferir a oferta e os visitantes." : null, l.id,
      );
    });
  });
}

history({ year: 2026, q: 1 }, 4, 1100, false);
history({ year: 2026, q: 2 }, 5, 1300, false);
history({ year: 2026, q: 3 }, 7, 1500, true);

// ───────────── 4º trimestre: a planilha, gravada pelo código do sistema
const Q4 = { year: 2026, q: 4 as const };
const q4Dates = sundaysOfQuarter(Q4);
for (const c of CLASSES) {
  const cid = classId[c.name];
  if (c.q4 === null) {
    repo.generateQuarterSchedule(U.super, cid, Q4, "remanejada");
    continue;
  }
  repo.generateQuarterSchedule(U.super, cid, Q4, "vazia");
  const byDate = new Map(
    (db.prepare(`SELECT id, date FROM lessons WHERE class_id=? AND date BETWEEN ? AND ?`).all(cid, "2026-10-01", "2026-12-31") as {
      id: number; date: string;
    }[]).map((l) => [l.date, l.id]),
  );
  repo.saveQuarterSchedule(
    U.super, cid,
    q4Dates.map((date, i) => {
      const entry = c.q4![i];
      return { lessonId: byDate.get(date)!, value: entry.startsWith("e:") ? entry : `p:${teacherIds.get(entry)}` };
    }),
  );
}

// ───────────── material didático do trimestre, com pagamentos parciais
CLASSES.forEach((c, ci) => {
  if (c.q4 === null) return;
  repo.createMaterial(U.sec, { title: `Revista ${c.name}`, period: "4º trimestre 2026", priceCents: c.priceCents, classId: classId[c.name] });
  const orders = db.prepare(`SELECT id, price_cents FROM material_orders WHERE class_id=? ORDER BY id`).all(classId[c.name]) as {
    id: number; price_cents: number;
  }[];
  orders.forEach((o, si) => {
    const mode = (si + ci) % 4;
    if (mode === 0) repo.registerPayment(U.sec, o.id, o.price_cents, "pix", "2026-09-20");
    else if (mode === 1) repo.registerPayment(U.sec, o.id, Math.round(o.price_cents / 2), "dinheiro", "2026-09-27");
  });
});

// ───────────── filiais de exemplo (FICTÍCIAS) — para demonstrar várias congregações
const addCong = db.prepare(`INSERT INTO congregations (name, kind, region, address) VALUES (?, 'filial', ?, ?)`);
const filiais = [
  { name: "Congregação Monte Sião", region: "Região Norte", classes: ["Adultos", "Jovens", "Crianças"] },
  { name: "Congregação Jardim das Oliveiras", region: "Região Norte", classes: ["Adultos", "Juniores"] },
].map((f, fi) => {
  const cid = Number(addCong.run(f.name, f.region, `Rua Exemplo, ${100 + fi * 50}`).lastInsertRowid);
  const p = (name: string, birth: string | null = null, phone: string | null = null) => {
    const id = person(name, birth, phone);
    db.prepare(`UPDATE people SET congregation_id=? WHERE id=?`).run(cid, id);
    return id;
  };
  const sup = p(fi === 0 ? "Ezequiel Prado" : "Débora Lins", "1978-05-20", `(11) 93333-000${fi}`);
  user(sup, fi === 0 ? "super.montesiao@ebd.local" : "super.oliveiras@ebd.local", "superintendente");
  const coord = p(fi === 0 ? "Natanael Rocha" : "Priscila Melo");
  const g = Number(db.prepare(`INSERT INTO class_groups (name, coordinator_id, congregation_id) VALUES ('Escala 1', ?, ?)`).run(coord, cid).lastInsertRowid);
  const ids = f.classes.map((name, ci) => {
    const clsId = Number(db.prepare(`INSERT INTO classes (name, group_id, congregation_id) VALUES (?, ?, ?)`).run(name, g, cid).lastInsertRowid);
    const t1 = p(`Prof. ${["Abner", "Raquel", "Simeão", "Lídia", "Josué"][(fi * 3 + ci) % 5]}`);
    const t2 = p(`Prof. ${["Ana", "Calebe", "Ester", "Gideão", "Rute"][(fi * 3 + ci) % 5]}`);
    staff(clsId, t1, "professor");
    staff(clsId, t2, "professor");
    studentsOf[clsId] = [];
    for (let i = 0; i < 6 - ci; i++) {
      const sid = p(`${FIRST[(fi * 9 + ci * 4 + i) % FIRST.length]} ${LAST[(fi * 7 + ci * 3 + i * 5) % LAST.length]}`,
        `${1960 + ((fi * 13 + ci * 7 + i * 5) % 50)}-${String(((i + ci) % 12) + 1).padStart(2, "0")}-${String(((i * 3 + fi) % 27) + 1).padStart(2, "0")}`,
        `(11) 94444-${String(1000 + fi * 100 + ci * 10 + i).slice(-4)}`);
      enroll(clsId, sid);
      studentsOf[clsId].push(sid);
    }
    return clsId;
  });
  // histórico validado do 3º trimestre e escala do 4º
  for (const [k, clsId] of ids.entries()) {
    repo.generateQuarterSchedule(U.super, clsId, { year: 2026, q: 3 }, "rodizio");
    repo.generateQuarterSchedule(U.super, clsId, Q4, "rodizio");
    const ls = db.prepare(`SELECT id, date, teacher_id FROM lessons WHERE class_id=? AND date BETWEEN '2026-07-01' AND '2026-09-30' ORDER BY date`)
      .all(clsId) as { id: number; date: string; teacher_id: number | null }[];
    ls.forEach((l, di) => {
      studentsOf[clsId].forEach((sid, si) => addAtt.run(l.id, sid, (si + di + k + fi) % (fi === 0 ? 3 : 6) === 0 ? 0 : 1));
      if (l.teacher_id) addAtt.run(l.id, l.teacher_id, 1);
      const sent = `${l.date}T18:00:00.000Z`;
      setLesson.run(TOPICS[di % TOPICS.length], null, di % 2, 800 + di * 50, "validada", sup, sent, sup, sent, null, l.id);
    });
  }
  return cid;
});

// Pastor/Presidente (todas as congregações) e supervisor regional (as duas filiais)
const pastor = person("Pr. Presidente (exemplo)", "1960-01-10", "(11) 90000-0001");
user(pastor, "pastor@ebd.local", "pastor");
const supervisor = person("Supervisor Regional (exemplo)", "1970-04-04", "(11) 90000-0002");
user(supervisor, "supervisor@ebd.local", "supervisor");
const supUser = (db.prepare(`SELECT id FROM users WHERE email='supervisor@ebd.local'`).get() as { id: number }).id;
for (const cid of filiais) db.prepare(`INSERT INTO user_congregations (user_id, congregation_id) VALUES (?, ?)`).run(supUser, cid);

// dados da igreja (timbre) — exemplo; ajuste em Configurações
for (const [k, v] of Object.entries({
  church_name: "Igreja Evangélica Assembleia de Deus", church_short: "EBD", city: "São Paulo · SP", president: "",
})) db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run(k, v);

// ───────────── visitantes, caixa e chamada da equipe (FICTÍCIOS)
{
  const sedeU = { ...U.sec, congregations: null, view: 1 };
  const names = ["Renata Lopes", "Fábio Nunes", "Cíntia Prates", "Diego Mota", "Elaine Sá", "Gustavo Reis", "Helena Brito", "Igor Paiva", "Joana Leal"];
  const howList = ["Convite de membro", "Familiar", "Rede social", "Passou na frente", "Evento da igreja"];
  const visitClasses = ["Atalaias", "Heróis da Fé", "Guerreiros de Deus", "Ebenézer", "Unidos em Amor"];
  names.forEach((name, i) => {
    const cls = classId[visitClasses[i % visitClasses.length]];
    const first = ["2026-07-12", "2026-07-26", "2026-08-09", "2026-08-23", "2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04"][i];
    const id = v.createVisitor(sedeU, { name, phone: `(11) 95555-${String(1000 + i)}`, classId: cls, date: first, howFound: howList[i % 5], invitedBy: i % 2 ? "Bruna Siqueira" : "", notes: "" });
    if (i % 3 !== 2 && first < "2026-09-27") v.addVisit(sedeU, id, "2026-09-27");
    if (i === 0 || i === 4) v.enrollVisitor(sedeU, id, cls, "1990-05-05");
    if (i === 8) v.setVisitorStatus(sedeU, id, "perdido");
  });
  const entries: [string, string, number, string, string | null][] = [
    ["saida", "Compra de revistas", 98000, "2026-09-25", null],
    ["saida", "Lanche / confraternização", 18500, "2026-08-30", null],
    ["saida", "Premiação / brindes", 7500, "2026-09-27", "Soldados do Rei"],
    ["saida", "Material didático", 4200, "2026-07-19", "Cordeirinhos de Jesus"],
    ["entrada", "Doação", 30000, "2026-08-16", null],
    ["entrada", "Cantina", 12750, "2026-09-13", null],
    ["saida", "Eventos", 25000, "2026-10-04", null],
  ];
  for (const [kind, category, cents, date, cls] of entries)
    f.createFinanceEntry(sedeU, { kind, category, description: "", amountCents: cents, date, classId: cls ? classId[cls] : null, method: "pix" });
  for (const date of ["2026-09-13", "2026-09-20", "2026-09-27"]) {
    const r = sc.staffRoster(sedeU, 1, date);
    sc.saveStaffAttendance(sedeU, 1, date, Object.fromEntries(r.people.map((p, i) => [p.id, (i + date.length + Number(date.slice(8))) % 7 !== 0])));
  }
}

// ───────────── comunicação: comunicados, agenda e mural (FICTÍCIOS)
{
  const sedeSec = { ...U.sec, congregations: [1], view: 1, home: 1 };
  ann.createAnnouncement(sedeSec, { audience: "todos", title: "Revistas do 4º trimestre chegaram", body: "Retire a sua com o secretário da sua sala. Quem ainda não pagou pode acertar por Pix ou em dinheiro.", pinned: true, expiresAt: "", notify: false });
  ann.createAnnouncement(sedeSec, { audience: "grupo:equipe", title: "Reunião de professores", body: "Sábado, 10/10, às 16h, na sala da EBD. Vamos alinhar as lições do trimestre.", pinned: false, expiresAt: "2026-10-10", notify: false });
  ann.createAnnouncement(sedeSec, { audience: `classe:${classId["Atalaias"]}`, title: "Atalaias: lição 2 com dinâmica", body: "Tragam a Bíblia e um caderno. Teremos atividade em grupo.", pinned: false, expiresAt: "", notify: false });
  ag.createEvent(sedeSec, { audience: "todos", title: "Confraternização da EBD", description: "Encerramento do ano com louvor, testemunhos e lanche. Cada família traz um prato.", location: "Salão social", startsAt: "2026-12-13T18:00", endsAt: "2026-12-13T21:00", rsvp: true, notify: false });
  ag.createEvent(sedeSec, { audience: "grupo:equipe", title: "Treinamento de professores", description: "Didática e uso do sistema da EBD.", location: "Sala 3", startsAt: "2026-10-17T09:00", endsAt: "2026-10-17T12:00", rsvp: true, notify: false });
  const evId = (db.prepare(`SELECT id FROM events ORDER BY id LIMIT 1`).get() as { id: number }).id;
  for (const pid of [bruna, paulo, superint, secGeral, teacher("Luiz Cunha")]) db.prepare(`INSERT INTO event_rsvps (event_id, person_id, answer, guests, updated_at) VALUES (?, ?, 'sim', 1, ?)`).run(evId, pid, new Date().toISOString());
  const post = (author: number, kind: string, body: string, cls: string | null) =>
    db.prepare(`INSERT INTO posts (congregation_id, class_id, author_id, kind, body, status, created_at) VALUES (1, ?, ?, ?, ?, 'publicado', ?)`)
      .run(cls ? classId[cls] : null, author, kind, body, new Date(Date.now() - Math.random() * 6 * 86400000).toISOString());
  post(bruna, "testemunho", "Domingo passado tivemos 3 visitantes na Atalaias e um deles já voltou! Deus é fiel. 🙌", "Atalaias");
  post(teacher("Júlia"), "oracao", "Peço oração pela família de um aluno dos Campeões que está passando por um momento difícil.", "Campeões de Cristo");
  post(secGeral, "aviso", "Lembrete: o relatório de cada sala deve ser enviado até o fim do culto de domingo. Obrigada, secretários!", null);
  const pending = studentsOf[classId["Atalaias"]][1];
  db.prepare(`INSERT INTO posts (congregation_id, class_id, author_id, kind, body, status, created_at) VALUES (1, ?, ?, 'testemunho', ?, 'pendente', ?)`)
    .run(classId["Atalaias"], pending, "Agradeço a Deus pela cura da minha mãe. Obrigado a todos pelas orações!", new Date().toISOString());
}

// ───────────── ensino: lições do 4º trimestre, planos, quizzes, biblioteca (FICTÍCIOS)
{
  const sedeSec = { ...U.sec, congregations: [1], view: 1, home: 1 };
  const Q4L = [
    "O propósito da Escola Bíblica | Dt 6.1-9 | Ensina a criança no caminho em que deve andar. Pv 22.6",
    "A Bíblia, Palavra de Deus | 2 Tm 3.14-17 | Toda a Escritura é divinamente inspirada. 2 Tm 3.16",
    "Deus, o Criador | Gn 1.1-31 | No princípio, criou Deus os céus e a terra. Gn 1.1",
    "A queda e a promessa | Gn 3.1-15 | Porei inimizade entre ti e a mulher. Gn 3.15",
    "Noé, um homem justo | Gn 6.9-22 | Noé, porém, achou graça aos olhos do Senhor. Gn 6.8",
    "Abraão, o amigo de Deus | Gn 12.1-9 | Creu Abraão em Deus. Rm 4.3",
    "José e a fidelidade | Gn 39.1-23 | O Senhor estava com José. Gn 39.2",
    "Moisés e a libertação | Êx 3.1-15 | Eu sou o que sou. Êx 3.14",
    "Os Dez Mandamentos | Êx 20.1-17 | Amarás o Senhor teu Deus de todo o teu coração. Dt 6.5",
    "Josué e a conquista | Js 1.1-9 | Sê forte e corajoso. Js 1.9",
    "Davi, um coração segundo Deus | 1 Sm 16.1-13 | O Senhor olha para o coração. 1 Sm 16.7",
    "O nascimento de Jesus | Lc 2.1-20 | Hoje vos nasceu o Salvador. Lc 2.11",
    "Revisão do trimestre | Sl 119.97-105 | Lâmpada para os meus pés é tua palavra. Sl 119.105",
  ].map((l, i) => `${i + 1}. ${l}`).join("\n");
  for (const c of CLASSES) if (c.q4 !== null) teach.saveCurriculum(sedeSec, classId[c.name], Q4, Q4L);

  // planos de aula de quem está escalado no próximo domingo (alguns já entregues)
  const next = db.prepare(`SELECT l.id, l.teacher_id, c.name FROM lessons l JOIN classes c ON c.id=l.class_id WHERE l.date='2026-10-11' AND l.kind='aula' AND c.congregation_id=1`).all() as { id: number; teacher_id: number | null; name: string }[];
  next.forEach((l, i) => {
    if (i % 3 === 2 || !l.teacher_id) return;
    db.prepare(`UPDATE lessons SET plan=?, plan_updated_at=? WHERE id=?`).run(
      "Objetivo: compreender que a Bíblia é a Palavra de Deus.\nIntrodução: pergunta para a turma (5 min).\nDesenvolvimento: leitura de 2 Tm 3.14-17 e discussão.\nAplicação: plano de leitura semanal.\nRecursos: Bíblia, quadro, revista.",
      new Date().toISOString(), l.id);
  });

  // quiz da classe Atalaias com respostas dos alunos
  const luiz = teacher("Luiz Cunha");
  const profSubj = { ...subject(luiz, "professor"), teaches: [classId["Atalaias"]], congregations: [1], view: 1, home: 1 };
  const qz = quiz.createQuiz(profSubj, { classId: classId["Atalaias"], title: "Lição 1 — O propósito da Escola Bíblica", openUntil: "2026-10-31", questions: [
    { text: "Segundo Dt 6.7, onde devemos ensinar a Palavra?", options: ["Só no templo", "Em casa e pelo caminho", "Só aos domingos"], correct: 1 },
    { text: "Qual livro diz 'Ensina a criança no caminho em que deve andar'?", options: ["Provérbios", "Salmos", "Eclesiastes"], correct: 0 },
    { text: "A EBD existe para…", options: ["Entreter", "Ensinar a Palavra e formar discípulos", "Arrecadar ofertas"], correct: 1 },
  ] });
  studentsOf[classId["Atalaias"]].slice(0, 4).forEach((sid, i) => {
    const ans = [[1, 0, 1], [1, 0, 1], [0, 0, 1], [1, 2, 1]][i];
    db.prepare(`INSERT INTO quiz_attempts (quiz_id, person_id, answers, score, total, created_at) VALUES (?, ?, ?, ?, 3, ?)`)
      .run(qz, sid, JSON.stringify(ans), ans.filter((a, k) => a === [1, 0, 1][k]).length, new Date().toISOString());
  });

  // biblioteca
  const L = (kind: string, title: string, extra: Partial<{ url: string; author: string; copies: number; audience: string; description: string; cls: string }>) =>
    lib.createLibraryItem(sedeSec, { kind, title, description: extra.description ?? "", author: extra.author ?? "", url: extra.url ?? "", copies: extra.copies ?? 1,
      audience: extra.audience ?? "todos", classId: extra.cls ? classId[extra.cls] : null });
  L("link", "Bíblia online (ARC)", { url: "https://www.bibliaonline.com.br/arc", description: "Para consultar as leituras da lição." });
  L("link", "Guia do professor: como preparar a aula", { url: "https://www.youtube.com/results?search_query=como+preparar+aula+ebd", audience: "equipe", description: "Vídeos de apoio à didática." });
  const b1 = L("livro", "Manual do Professor de Escola Dominical", { author: "Autor exemplo", copies: 2 });
  L("livro", "Dicionário Bíblico", { author: "Autor exemplo", copies: 1 });
  L("livro", "Histórias da Bíblia para crianças", { author: "Autor exemplo", copies: 3, cls: "Sementinhas de Jesus" });
  lib.lendItem(sedeSec, b1, teacher("Gevanil"), "2026-10-18");
  db.prepare(`INSERT INTO loans (item_id, person_id, loaned_at, due_at) VALUES (?, ?, '2026-09-01', '2026-09-15')`).run(b1, teacher("Suzette"));
}

const count = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
const by = (s: string) => (db.prepare(`SELECT COUNT(*) c FROM lessons WHERE ${s}`).get() as { c: number }).c;
console.log(
  `Seed ok: ${count("classes")} classes, ${count("people")} pessoas, ${count("users")} contas, ${count("lessons")} domingos na escala ` +
    `(${by("kind='evento'")} sem aula), ${count("attendance")} presenças, ${count("material_orders")} revistas, ${count("payments")} pagamentos.`,
);
console.log(`Escalas: ${count("class_groups")} (coordenadores: Rivanildo, Jaasiel, Wanclezia).`);
console.log(
  `Relatórios: ${by("report_status='validada'")} validados, ${by("report_status='enviada'")} aguardando validação, ` +
    `${by("report_status='devolvida'")} devolvido(s), ${by("report_status='pendente' AND date<'2026-10-04' AND kind='aula'")} pendente(s) passado(s).`,
);
console.log(`Visitantes: ${count("visitors")} · lançamentos no caixa: ${count("finance_entries")} · chamada da equipe: ${count("staff_attendance")}.`);
console.log(`Comunicados: ${count("announcements")} · eventos: ${count("events")} · mural: ${count("posts")}.`);
console.log(`Lições: ${count("curriculum")} · quizzes: ${count("quizzes")} · biblioteca: ${count("library_items")} itens, ${count("loans")} empréstimos.`);
console.log(`Congregações: ${count("congregations")} (Sede + ${filiais.length} filiais de exemplo).`);
console.log("Senha de todas as contas de demonstração: ebd123");
