import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Versão do esquema. A base (v3) é criada de uma vez; daí em diante cada versão é uma MIGRAÇÃO que preserva os
 * dados (ver MIGRATIONS). Assim, atualizar o sistema nunca exige recriar o banco.
 */
const BASE_VERSION = 3;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  birth_date TEXT,            -- YYYY-MM-DD
  phone TEXT,
  guardian_name TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES people(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN
    ('superintendente','coordenador','secretaria','professor','colaborador','aluno'))
);

-- Escala = conjunto de classes que sai numa mesma folha de escala e tem UM coordenador (ex.: Escala 1).
CREATE TABLE IF NOT EXISTS class_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  coordinator_id INTEGER REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  age_range TEXT,
  group_id INTEGER REFERENCES class_groups(id),
  active INTEGER NOT NULL DEFAULT 1
);

-- Quem atua em cada classe (atributo usado pelo ABAC). O coordenador NÃO fica aqui: vem da Escala (class_groups).
-- A ordem de inserção dos professores define a ordem do rodízio da escala.
CREATE TABLE IF NOT EXISTS class_staff (
  class_id INTEGER NOT NULL REFERENCES classes(id),
  person_id INTEGER NOT NULL REFERENCES people(id),
  function TEXT NOT NULL CHECK (function IN ('professor','colaborador','secretario')),
  PRIMARY KEY (class_id, person_id, function)
);
-- Cada sala tem no máximo um secretário.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_secretary
  ON class_staff(class_id) WHERE function = 'secretario';

CREATE TABLE IF NOT EXISTS enrollments (
  class_id INTEGER NOT NULL REFERENCES classes(id),
  person_id INTEGER NOT NULL REFERENCES people(id),
  PRIMARY KEY (class_id, person_id)
);

-- Cada domingo de cada classe: escala (professor previsto), diário e situação do relatório.
-- kind = 'evento' marca domingo sem aula (ex.: Reunião de Obreiros): sem presença, diário nem relatório.
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  date TEXT NOT NULL,         -- YYYY-MM-DD (sempre um domingo)
  kind TEXT NOT NULL DEFAULT 'aula' CHECK (kind IN ('aula','evento')),
  event_label TEXT,
  teacher_id INTEGER REFERENCES people(id),
  topic TEXT,
  notes TEXT,
  visitors INTEGER NOT NULL DEFAULT 0,
  offering_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'escalada' CHECK (status IN ('escalada','realizada','cancelada')),
  -- substituição: o secretário da sala avisou/foi marcado como ausente; o professor escalado preenche
  secretary_absent INTEGER NOT NULL DEFAULT 0,
  -- fluxo do relatório da aula
  report_status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (report_status IN ('pendente','enviada','validada','devolvida')),
  submitted_by INTEGER REFERENCES people(id),
  submitted_at TEXT,
  validated_by INTEGER REFERENCES people(id),
  validated_at TEXT,
  return_note TEXT,
  UNIQUE (class_id, date)
);

CREATE TABLE IF NOT EXISTS attendance (
  lesson_id INTEGER NOT NULL REFERENCES lessons(id),
  person_id INTEGER NOT NULL REFERENCES people(id),
  present INTEGER NOT NULL,
  PRIMARY KEY (lesson_id, person_id)
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  period TEXT,                -- ex.: 4º trimestre 2026
  price_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS material_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  person_id INTEGER NOT NULL REFERENCES people(id),
  class_id INTEGER REFERENCES classes(id),
  price_cents INTEGER NOT NULL,
  UNIQUE (material_id, person_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES material_orders(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_at TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'dinheiro',
  received_by INTEGER REFERENCES people(id)
);

CREATE INDEX IF NOT EXISTS idx_lessons_date ON lessons(date);
CREATE INDEX IF NOT EXISTS idx_lessons_report ON lessons(report_status);
CREATE INDEX IF NOT EXISTS idx_attendance_person ON attendance(person_id);
CREATE INDEX IF NOT EXISTS idx_orders_person ON material_orders(person_id);
`;

/** Migrações incrementais: a chave é a versão de destino. Cada uma roda numa transação. */
const MIGRATIONS: Record<number, string> = {
  // v4 — fundação: várias congregações, Pastor/Supervisor, dados da igreja, fotos, login Google
  4: `
    CREATE TABLE congregations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'filial' CHECK (kind IN ('sede','filial')),
      region TEXT,
      address TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO congregations (id, name, kind) VALUES (1, 'Sede', 'sede');

    ALTER TABLE classes ADD COLUMN congregation_id INTEGER NOT NULL DEFAULT 1 REFERENCES congregations(id);
    ALTER TABLE people ADD COLUMN congregation_id INTEGER NOT NULL DEFAULT 1 REFERENCES congregations(id);
    ALTER TABLE people ADD COLUMN photo TEXT;
    ALTER TABLE people ADD COLUMN email TEXT;

    -- o nome da Escala passa a ser único por congregação
    CREATE TABLE class_groups_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      coordinator_id INTEGER REFERENCES people(id),
      congregation_id INTEGER NOT NULL DEFAULT 1 REFERENCES congregations(id),
      UNIQUE (congregation_id, name)
    );
    INSERT INTO class_groups_new (id, name, coordinator_id) SELECT id, name, coordinator_id FROM class_groups;
    DROP TABLE class_groups;
    ALTER TABLE class_groups_new RENAME TO class_groups;

    -- novas funções: Pastor/Presidente (todas as congregações) e Supervisor regional
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL REFERENCES people(id),
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN
        ('pastor','supervisor','superintendente','coordenador','secretaria','professor','colaborador','aluno')),
      google_sub TEXT UNIQUE
    );
    INSERT INTO users_new (id, person_id, email, password_hash, role) SELECT id, person_id, email, password_hash, role FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;

    -- congregações acompanhadas por cada supervisor regional
    CREATE TABLE user_congregations (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      congregation_id INTEGER NOT NULL REFERENCES congregations(id),
      PRIMARY KEY (user_id, congregation_id)
    );

    -- identidade da igreja (timbre dos relatórios, certificados, PWA)
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);

    CREATE INDEX idx_classes_cong ON classes(congregation_id);
    CREATE INDEX idx_people_cong ON people(congregation_id);
  `,

  // v5 — gestão: visitantes (funil), financeiro geral, chamada dos colaboradores
  5: `
    CREATE TABLE visitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      congregation_id INTEGER NOT NULL REFERENCES congregations(id),
      class_id INTEGER REFERENCES classes(id),
      name TEXT NOT NULL,
      phone TEXT,
      how_found TEXT,          -- convite, rede social, passou na frente…
      invited_by TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'visitante' CHECK (status IN ('visitante','retornou','matriculado','perdido')),
      person_id INTEGER REFERENCES people(id),   -- preenchido ao matricular
      created_by INTEGER REFERENCES people(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE visitor_visits (
      visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      class_id INTEGER REFERENCES classes(id),
      PRIMARY KEY (visitor_id, date)
    );
    CREATE INDEX idx_visitors_cong ON visitors(congregation_id, status);

    -- lançamentos manuais do caixa da EBD (as ofertas validadas e os pagamentos de revistas entram automaticamente)
    CREATE TABLE finance_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      congregation_id INTEGER NOT NULL REFERENCES congregations(id),
      class_id INTEGER REFERENCES classes(id),
      kind TEXT NOT NULL CHECK (kind IN ('entrada','saida')),
      category TEXT NOT NULL,
      description TEXT,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      date TEXT NOT NULL,
      method TEXT,
      created_by INTEGER REFERENCES people(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_finance_cong_date ON finance_entries(congregation_id, date);

    -- presença da equipe (professores, secretários, colaboradores, coordenadores) por domingo
    CREATE TABLE staff_attendance (
      congregation_id INTEGER NOT NULL REFERENCES congregations(id),
      date TEXT NOT NULL,
      person_id INTEGER NOT NULL REFERENCES people(id),
      present INTEGER NOT NULL,
      recorded_by INTEGER REFERENCES people(id),
      PRIMARY KEY (congregation_id, date, person_id)
    );
  `,

  // v6 — comunicação: comunicados, mural, notificações (no app e push), agenda com confirmação de presença
  6: `
    -- público-alvo: todos | grupo (equipe, professores, alunos, lideranca) | escala (id) | classe (id)
    CREATE TABLE announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      congregation_id INTEGER REFERENCES congregations(id),   -- NULL = todas as congregações
      audience_kind TEXT NOT NULL DEFAULT 'todos' CHECK (audience_kind IN ('todos','grupo','escala','classe')),
      audience_value TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      created_by INTEGER REFERENCES people(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE announcement_reads (
      announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_at TEXT NOT NULL,
      PRIMARY KEY (announcement_id, user_id)
    );

    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      congregation_id INTEGER NOT NULL REFERENCES congregations(id),
      class_id INTEGER REFERENCES classes(id),
      author_id INTEGER NOT NULL REFERENCES people(id),
      kind TEXT NOT NULL DEFAULT 'foto' CHECK (kind IN ('foto','testemunho','aviso','oracao')),
      body TEXT,
      image TEXT,
      status TEXT NOT NULL DEFAULT 'publicado' CHECK (status IN ('publicado','pendente','oculto')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE post_reactions (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES people(id),
      PRIMARY KEY (post_id, person_id)
    );
    CREATE TABLE post_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES people(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_posts_cong ON posts(congregation_id, status, created_at);

    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT,
      url TEXT,
      created_at TEXT NOT NULL,
      read_at TEXT
    );
    CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);
    CREATE TABLE push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      congregation_id INTEGER REFERENCES congregations(id),   -- NULL = todas as congregações
      audience_kind TEXT NOT NULL DEFAULT 'todos' CHECK (audience_kind IN ('todos','grupo','escala','classe')),
      audience_value TEXT,
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      starts_at TEXT NOT NULL,      -- YYYY-MM-DDTHH:MM (horário local)
      ends_at TEXT,
      rsvp INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES people(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE event_rsvps (
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES people(id),
      answer TEXT NOT NULL CHECK (answer IN ('sim','nao','talvez')),
      guests INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (event_id, person_id)
    );
    CREATE INDEX idx_events_start ON events(starts_at);

    ALTER TABLE users ADD COLUMN calendar_token TEXT;
  `,

  // v7 — ensino: lições do trimestre, plano de aula, quiz com pontuação, biblioteca e empréstimos
  7: `
    CREATE TABLE curriculum (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL REFERENCES classes(id),
      quarter TEXT NOT NULL,             -- ex.: 2026-4
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      golden_text TEXT,                  -- texto áureo
      reading TEXT,                      -- leitura bíblica
      UNIQUE (class_id, quarter, number)
    );
    ALTER TABLE lessons ADD COLUMN curriculum_id INTEGER REFERENCES curriculum(id);
    ALTER TABLE lessons ADD COLUMN plan TEXT;              -- plano de aula do professor escalado
    ALTER TABLE lessons ADD COLUMN plan_updated_at TEXT;

    CREATE TABLE quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL REFERENCES classes(id),
      lesson_id INTEGER REFERENCES lessons(id),
      title TEXT NOT NULL,
      open_until TEXT,                   -- YYYY-MM-DD (inclusive)
      published INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES people(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE quiz_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      text TEXT NOT NULL,
      options TEXT NOT NULL,             -- JSON: ["A", "B", "C", "D"]
      correct INTEGER NOT NULL
    );
    CREATE TABLE quiz_attempts (
      quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES people(id),
      answers TEXT NOT NULL,             -- JSON: índices escolhidos
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (quiz_id, person_id)
    );

    CREATE TABLE library_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      congregation_id INTEGER NOT NULL REFERENCES congregations(id),
      class_id INTEGER REFERENCES classes(id),
      kind TEXT NOT NULL CHECK (kind IN ('arquivo','link','livro')),
      title TEXT NOT NULL,
      description TEXT,
      author TEXT,
      file TEXT,
      file_name TEXT,
      mime TEXT,
      size INTEGER,
      url TEXT,
      copies INTEGER NOT NULL DEFAULT 1,
      audience TEXT NOT NULL DEFAULT 'todos' CHECK (audience IN ('todos','equipe')),
      created_by INTEGER REFERENCES people(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES people(id),
      loaned_at TEXT NOT NULL,
      due_at TEXT NOT NULL,
      returned_at TEXT,
      created_by INTEGER REFERENCES people(id)
    );
    CREATE INDEX idx_loans_open ON loans(item_id, returned_at);
  `,
};

export const SCHEMA_VERSION = Math.max(BASE_VERSION, ...Object.keys(MIGRATIONS).map(Number));

declare global {
  // eslint-disable-next-line no-var
  var __ebdDb: Database.Database | undefined;
}

export function openDb(file: string): Database.Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  const hasTables = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='lessons'`).get();
  let version = db.pragma("user_version", { simple: true }) as number;
  if (hasTables && version < BASE_VERSION) {
    db.close();
    throw new Error(
      `O banco ${file} é anterior à versão ${BASE_VERSION} e não pode ser migrado automaticamente. ` +
        `Se for apenas demonstração, rode "npm run seed" para recriá-lo.`,
    );
  }
  if (version > SCHEMA_VERSION) {
    db.close();
    throw new Error(`O banco ${file} é de uma versão mais nova do sistema (v${version}). Atualize o sistema.`);
  }
  db.pragma("journal_mode = WAL");
  if (!hasTables) {
    db.exec(SCHEMA);
    version = BASE_VERSION;
    db.pragma(`user_version = ${version}`);
  }
  // migrações pendentes, em ordem; as chaves estrangeiras ficam desligadas durante a troca de tabelas
  db.pragma("foreign_keys = OFF");
  for (let v = version + 1; v <= SCHEMA_VERSION; v++) {
    const sql = MIGRATIONS[v];
    if (!sql) continue;
    db.transaction(() => {
      db.exec(sql);
      const bad = db.pragma("foreign_key_check") as unknown[];
      if (bad.length) throw new Error(`Migração v${v} deixou ${bad.length} referência(s) inválida(s).`);
      db.pragma(`user_version = ${v}`);
    })();
  }
  db.pragma("foreign_keys = ON");
  return db;
}

export function db(): Database.Database {
  if (!globalThis.__ebdDb) {
    globalThis.__ebdDb = openDb(
      path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.EBD_DB_PATH ?? "data/ebd.db"),
    );
    // rotinas diárias (cópia de segurança, aniversários, lembretes): verificadas a cada 30 minutos
    const tick = () => import("./jobs").then((m) => m.maybeRunDailyJobs()).catch((e) => console.error("[rotinas]", e));
    setTimeout(tick, 5000).unref?.();
    setInterval(tick, 30 * 60 * 1000).unref?.();
  }
  return globalThis.__ebdDb;
}

/** Somente para testes de migração: o esquema base (v3). */
export const BASE_SCHEMA_FOR_TESTS = SCHEMA;
