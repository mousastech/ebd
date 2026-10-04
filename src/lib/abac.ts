/**
 * Motor ABAC da EBD.
 *
 * A decisão é calculada a partir de atributos:
 *  - do SUJEITO: função (role), pessoa, classes em que atua/está matriculado/é secretário
 *  - do RECURSO: tipo, classes a que pertence, pessoa dona, professor escalado,
 *    situação do relatório da aula, se a classe tem secretário e se ele está ausente
 *  - da AÇÃO: read, create, update, delete, read_sensitive
 *
 * Fluxo do relatório de cada aula:
 *   pendente ──(secretário da sala, ou professor na ausência dele, envia)──▶ enviada
 *   enviada  ──(secretaria geral valida)──▶ validada     ou  ──(devolve)──▶ devolvida
 *   devolvida: volta a ser editável por quem preenche e pode ser reenviada.
 *
 * Regra geral: negado por padrão. Só passa se alguma regra permitir.
 * Este módulo não depende do banco, para poder ser testado isoladamente.
 */

export const ROLES = [
  "pastor",
  "supervisor",
  "superintendente",
  "coordenador",
  "secretaria",
  "professor",
  "colaborador",
  "aluno",
] as const;
export type Role = (typeof ROLES)[number];

/** "Secretaria" é a secretaria geral da EBD; o secretário de sala é um atributo da classe. */
export const ROLE_LABEL: Record<Role, string> = {
  pastor: "Pastor / Presidente",
  supervisor: "Supervisor regional",
  superintendente: "Superintendente",
  coordenador: "Coordenador",
  secretaria: "Secretaria geral",
  professor: "Professor",
  colaborador: "Colaborador",
  aluno: "Aluno",
};

export type ReportStatus = "pendente" | "enviada" | "validada" | "devolvida";

export const REPORT_LABEL: Record<ReportStatus, string> = {
  pendente: "Pendente",
  enviada: "Aguardando validação",
  validada: "Validada",
  devolvida: "Devolvida para correção",
};

export type Action = "read" | "create" | "update" | "delete" | "read_sensitive";

export type ResourceType =
  | "class" // classe (turma)
  | "person" // cadastro de pessoa
  | "enrollment" // matrícula do aluno na classe
  | "schedule" // escala de professores
  | "lesson" // aula (dados gerais)
  | "attendance" // presença
  | "diary" // diário de classe
  | "birthday" // aniversariantes
  | "material" // catálogo de revistas
  | "material_order" // revista de um aluno
  | "payment" // pagamento da revista
  | "report" // relatório da aula: read = ver, create = enviar, update = validar/devolver, delete = reabrir validada
  | "consolidated" // relatório consolidado da EBD
  | "substitution" // marcar o secretário como ausente (professor assume)
  | "user" // usuários e funções
  | "congregation" // congregações (sede e filiais)
  | "settings" // dados da igreja (timbre, logo)
  | "backup" // cópias de segurança do banco
  | "visitor" // visitantes e funil de conversão
  | "finance" // caixa da EBD (entradas e saídas)
  | "staff_attendance" // chamada da equipe (colaboradores)
  | "announcement" // comunicados
  | "post" // mural (fotos, testemunhos, pedidos de oração)
  | "event" // agenda de eventos
  | "curriculum" // lições do trimestre (revista)
  | "plan" // plano de aula
  | "quiz" // quizzes e pontuação
  | "library" // biblioteca (materiais e acervo)
  | "loan" // empréstimos do acervo
  | "certificate"; // certificados

export interface Subject {
  userId: number;
  personId: number;
  role: Role;
  /** classes em que a pessoa é coordenadora */
  coordinates: number[];
  /** classes em que a pessoa é professora */
  teaches: number[];
  /** classes em que a pessoa é colaboradora */
  assists: number[];
  /** classes em que a pessoa é a secretária da sala (vale para qualquer função) */
  secretaryOf: number[];
  /** classes em que a pessoa está matriculada como aluna */
  enrolled: number[];
  /** congregações que o usuário alcança; null = todas (Pastor/Presidente) */
  congregations?: number[] | null;
  /** classes das congregações alcançadas; null = todas */
  allowedClasses?: number[] | null;
  /** congregação "de casa" do usuário */
  home?: number;
  /** congregação selecionada para visualização (filtro de tela, não de segurança); null = consolidado */
  view?: number | null;
}

export interface Resource {
  type: ResourceType;
  /** classes às quais o recurso pertence (uma aula tem uma; uma pessoa pode ter várias) */
  classIds?: number[];
  /** pessoa a quem o recurso se refere (ex.: o aluno de uma presença ou pagamento) */
  personId?: number;
  /** professor escalado (aulas, escala e diário) */
  teacherId?: number | null;
  /** situação do relatório da aula */
  reportStatus?: ReportStatus;
  /** a classe tem secretário designado? */
  hasSecretary?: boolean;
  /** o secretário foi marcado como ausente nesta aula? */
  secretaryAbsent?: boolean;
  /** congregação do recurso (pessoas, Escalas, usuários, congregações) */
  congregationId?: number | null;
}

interface Rule {
  id: string;
  roles: Role[];
  resources: ResourceType[];
  actions: Action[];
  /** condição adicional sobre atributos; ausente = vale sempre para a função */
  when?: (s: Subject, r: Resource) => boolean;
  description: string;
}

/** Classes que a função do sujeito "enxerga" como suas (inclui as que ele secretaria). */
export function scopeOf(s: Subject): number[] {
  let base: number[] = [];
  switch (s.role) {
    case "coordenador":
      base = s.coordinates;
      break;
    case "professor":
      base = s.teaches;
      break;
    case "colaborador":
      base = s.assists;
      break;
    case "aluno":
      base = s.enrolled;
      break;
  }
  return [...new Set([...base, ...s.secretaryOf])];
}

const touches = (ids: number[], r: Resource): boolean => (r.classIds ?? []).some((c) => ids.includes(c));
const inScope = (s: Subject, r: Resource): boolean => touches(scopeOf(s), r);
const isSelf = (s: Subject, r: Resource): boolean => r.personId !== undefined && r.personId === s.personId;
const isScheduledTeacher = (s: Subject, r: Resource): boolean =>
  r.teacherId !== undefined && r.teacherId !== null && r.teacherId === s.personId;

/** O relatório ainda pode ser editado por quem preenche (falha fechada se o status não vier). */
const editable = (r: Resource): boolean => r.reportStatus === "pendente" || r.reportStatus === "devolvida";

const isRoomSecretary = (s: Subject, r: Resource): boolean => touches(s.secretaryOf, r);
const secretaryMayFill = (s: Subject, r: Resource): boolean => isRoomSecretary(s, r) && editable(r);

/** Professor escalado assume o preenchimento quando a classe não tem secretário ou ele está ausente. */
const professorSubstitutes = (s: Subject, r: Resource): boolean =>
  touches(s.teaches, r) &&
  isScheduledTeacher(s, r) &&
  (r.hasSecretary === false || r.secretaryAbsent === true) &&
  editable(r);

const ALL_RESOURCES: ResourceType[] = [
  "class", "person", "enrollment", "schedule", "lesson", "attendance", "diary", "birthday",
  "material", "material_order", "payment", "report", "consolidated", "substitution", "user",
  "congregation", "settings", "backup", "visitor", "finance", "staff_attendance",
  "announcement", "post", "event",
  "curriculum", "plan", "quiz", "library", "loan", "certificate",
];
const ALL_ACTIONS: Action[] = ["read", "create", "update", "delete", "read_sensitive"];

export const RULES: Rule[] = [
  // ───────────── Pastor/Presidente: acesso total em todas as congregações
  {
    id: "pastor.tudo",
    roles: ["pastor"],
    resources: ALL_RESOURCES,
    actions: ALL_ACTIONS,
    description: "O Pastor/Presidente tem acesso total a todas as congregações, inclusive criar filiais e supervisores.",
  },

  // ───────────── Supervisor regional: acompanha (somente leitura) as congregações da sua região
  {
    id: "sup.leitura",
    roles: ["supervisor"],
    resources: ALL_RESOURCES.filter((r) => r !== "user" && r !== "settings" && r !== "backup"),
    actions: ["read", "read_sensitive"],
    description: "O supervisor regional consulta tudo das congregações da sua região, sem alterar.",
  },

  // ───────────── Superintendente: acesso total na sua congregação
  {
    id: "super.tudo",
    roles: ["superintendente"],
    resources: ALL_RESOURCES.filter((r) => r !== "congregation"),
    actions: ALL_ACTIONS,
    description: "O superintendente tem acesso total na sua congregação, incluindo usuários, funções e reabertura de relatórios.",
  },
  {
    id: "super.congregacao",
    roles: ["superintendente"],
    resources: ["congregation"],
    actions: ["read"],
    description: "O superintendente vê a própria congregação.",
  },

  // ───────────── Secretaria geral: valida e consolida; opera cadastros, material e pagamentos
  {
    id: "sec.pessoas",
    roles: ["secretaria"],
    resources: ["person"],
    actions: ["read", "create", "update", "read_sensitive"],
    description: "A secretaria geral cadastra e atualiza pessoas, com acesso aos contatos.",
  },
  {
    id: "sec.matriculas",
    roles: ["secretaria"],
    resources: ["enrollment"],
    actions: ["read", "create", "delete"],
    description: "A secretaria geral matricula e remove alunos das classes.",
  },
  {
    id: "sec.leitura",
    roles: ["secretaria"],
    resources: ["class", "schedule", "lesson", "birthday", "attendance", "diary", "consolidated"],
    actions: ["read"],
    description: "A secretaria geral consulta classes, escala, presença, diário e o consolidado.",
  },
  {
    id: "sec.correcao",
    roles: ["secretaria"],
    resources: ["attendance", "diary"],
    actions: ["create", "update"],
    when: (_s, r) => r.reportStatus !== undefined && r.reportStatus !== "validada",
    description: "A secretaria geral corrige presença e diário enquanto o relatório não foi validado.",
  },
  {
    id: "sec.relatorios",
    roles: ["secretaria"],
    resources: ["report"],
    actions: ["read", "create", "update"],
    description: "A secretaria geral valida ou devolve os relatórios enviados pelas salas.",
  },
  {
    id: "sec.gestao",
    roles: ["secretaria"],
    resources: ["visitor", "finance", "staff_attendance"],
    actions: ["read", "create", "update", "delete"],
    description: "A secretaria geral cuida dos visitantes, do caixa da EBD e da chamada da equipe.",
  },
  {
    id: "sec.comunicacao",
    roles: ["secretaria"],
    resources: ["announcement", "post", "event"],
    actions: ["read", "create", "update", "delete"],
    description: "A secretaria geral publica comunicados e eventos e modera o mural.",
  },
  {
    id: "sec.ensino",
    roles: ["secretaria"],
    resources: ["curriculum", "library", "loan", "certificate", "quiz"],
    actions: ["read", "create", "update", "delete"],
    description: "A secretaria geral cadastra as lições, cuida da biblioteca e dos empréstimos e emite certificados.",
  },
  {
    id: "sec.planos",
    roles: ["secretaria"],
    resources: ["plan"],
    actions: ["read"],
    description: "A secretaria geral acompanha os planos de aula.",
  },
  {
    id: "sec.substituicao",
    roles: ["secretaria"],
    resources: ["substitution"],
    actions: ["update"],
    description: "A secretaria geral pode registrar a ausência do secretário de uma sala.",
  },
  {
    id: "sec.materiais",
    roles: ["secretaria"],
    resources: ["material", "material_order"],
    actions: ["read", "create", "update"],
    description: "A secretaria geral cadastra revistas e os pedidos dos alunos.",
  },
  {
    id: "sec.pagamentos",
    roles: ["secretaria"],
    resources: ["payment"],
    actions: ["read", "create"],
    description: "A secretaria geral registra e consulta pagamentos do material didático.",
  },

  // ───────────── Coordenador: acompanha e organiza as suas classes (não preenche)
  {
    id: "coord.classe",
    roles: ["coordenador"],
    resources: ["class"],
    actions: ["read", "update"],
    when: inScope,
    description: "O coordenador vê e edita as classes que coordena.",
  },
  {
    id: "coord.pessoas",
    roles: ["coordenador"],
    resources: ["person", "birthday"],
    actions: ["read", "read_sensitive"],
    when: inScope,
    description: "O coordenador vê as pessoas e os contatos das suas classes.",
  },
  {
    id: "coord.matriculas",
    roles: ["coordenador"],
    resources: ["enrollment"],
    actions: ["read", "create", "delete"],
    when: inScope,
    description: "O coordenador gerencia matrículas das suas classes.",
  },
  {
    id: "coord.escala",
    roles: ["coordenador"],
    resources: ["schedule", "lesson"],
    actions: ["read", "create", "update", "delete"],
    when: inScope,
    description: "O coordenador monta a escala de professores das suas classes.",
  },
  {
    id: "coord.acompanha",
    roles: ["coordenador"],
    resources: ["attendance", "diary", "report", "consolidated"],
    actions: ["read"],
    when: inScope,
    description: "O coordenador acompanha presença, diário, relatórios e consolidado das suas classes.",
  },
  {
    id: "coord.visitantes",
    roles: ["coordenador"],
    resources: ["visitor"],
    actions: ["read", "create", "update"],
    when: inScope,
    description: "O coordenador acompanha e registra os visitantes das suas classes.",
  },
  {
    id: "coord.gestao-leitura",
    roles: ["coordenador"],
    resources: ["finance"],
    actions: ["read"],
    when: inScope,
    description: "O coordenador consulta o caixa das suas classes.",
  },
  {
    id: "coord.equipe-leitura",
    roles: ["coordenador"],
    resources: ["staff_attendance"],
    actions: ["read"],
    description: "O coordenador consulta a presença da equipe da sua congregação.",
  },
  {
    id: "coord.comunicacao",
    roles: ["coordenador"],
    resources: ["announcement", "event", "post"],
    actions: ["create", "update", "delete"],
    when: inScope,
    description: "O coordenador publica comunicados e eventos para a sua Escala/classes e modera o mural delas.",
  },
  {
    id: "coord.ensino",
    roles: ["coordenador"],
    resources: ["curriculum", "quiz", "library", "certificate"],
    actions: ["read", "create", "update", "delete"],
    when: inScope,
    description: "O coordenador cadastra as lições, quizzes e materiais das suas classes e emite certificados delas.",
  },
  {
    id: "coord.planos",
    roles: ["coordenador"],
    resources: ["plan"],
    actions: ["read"],
    when: inScope,
    description: "O coordenador acompanha os planos de aula da sua Escala.",
  },
  {
    id: "coord.substituicao",
    roles: ["coordenador"],
    resources: ["substitution"],
    actions: ["update"],
    when: inScope,
    description: "O coordenador pode registrar a ausência do secretário das suas classes.",
  },
  {
    id: "coord.financeiro",
    roles: ["coordenador"],
    resources: ["material_order", "payment"],
    actions: ["read"],
    when: inScope,
    description: "O coordenador consulta a situação das revistas da sua classe (sem lançar pagamento).",
  },
  {
    id: "coord.catalogo",
    roles: ["coordenador"],
    resources: ["material"],
    actions: ["read"],
    description: "O coordenador consulta o catálogo de revistas.",
  },

  // ───────────── Professor: consulta; assume o preenchimento só na ausência do secretário
  {
    id: "prof.leitura",
    roles: ["professor"],
    resources: ["class", "person", "schedule", "lesson", "birthday", "attendance", "report"],
    actions: ["read"],
    when: inScope,
    description: "O professor consulta a sua classe, os alunos, a escala, a presença e os relatórios.",
  },
  {
    id: "prof.diario-leitura",
    roles: ["professor"],
    resources: ["diary"],
    actions: ["read"],
    when: (s, r) => inScope(s, r) && isScheduledTeacher(s, r),
    description: "O professor lê o diário das aulas em que está escalado.",
  },
  {
    id: "prof.substitui",
    roles: ["professor"],
    resources: ["attendance", "diary"],
    actions: ["create", "update"],
    when: professorSubstitutes,
    description:
      "O professor escalado preenche presença e diário somente se a classe não tem secretário ou ele está ausente.",
  },
  {
    id: "prof.envia",
    roles: ["professor"],
    resources: ["report"],
    actions: ["create"],
    when: professorSubstitutes,
    description: "O professor que assumiu o preenchimento envia o relatório para validação.",
  },
  {
    id: "prof.marca-ausencia",
    roles: ["professor"],
    resources: ["substitution"],
    actions: ["update"],
    when: (s, r) => touches(s.teaches, r) && isScheduledTeacher(s, r) && r.hasSecretary === true && editable(r),
    description: "O professor escalado registra a ausência do secretário para assumir o preenchimento.",
  },

  {
    id: "prof.comunicacao",
    roles: ["professor"],
    resources: ["announcement", "event"],
    actions: ["create", "update", "delete"],
    when: (s, r) => touches(s.teaches, r),
    description: "O professor publica comunicados e eventos para a classe em que leciona.",
  },
  {
    id: "prof.plano",
    roles: ["professor"],
    resources: ["plan"],
    actions: ["read", "update"],
    when: (s, r) => touches(s.teaches, r) && isScheduledTeacher(s, r),
    description: "O professor escreve o plano das aulas em que está escalado.",
  },
  {
    id: "prof.ensino",
    roles: ["professor"],
    resources: ["quiz", "library"],
    actions: ["read", "create", "update", "delete"],
    when: (s, r) => touches(s.teaches, r),
    description: "O professor cria quizzes e compartilha materiais da classe em que leciona.",
  },
  {
    id: "prof.licoes",
    roles: ["professor"],
    resources: ["curriculum"],
    actions: ["read"],
    when: inScope,
    description: "O professor consulta as lições do trimestre.",
  },
  {
    id: "prof.visitantes",
    roles: ["professor"],
    resources: ["visitor"],
    actions: ["read", "create"],
    when: inScope,
    description: "O professor registra e vê os visitantes da sua classe.",
  },

  // ───────────── Colaborador: apenas consulta (preenche somente se for o secretário da sala)
  {
    id: "colab.leitura",
    roles: ["colaborador"],
    resources: ["class", "person", "schedule", "lesson", "birthday", "attendance"],
    actions: ["read"],
    when: inScope,
    description: "O colaborador consulta a classe em que apoia.",
  },

  // ───────────── Secretário da sala (atributo da classe, vale para qualquer função)
  {
    id: "salasec.leitura",
    roles: [...ROLES],
    resources: ["class", "schedule", "lesson", "attendance", "diary", "report", "curriculum"],
    actions: ["read"],
    when: isRoomSecretary,
    description: "O secretário da sala consulta a sala, a escala, a presença, o diário e o relatório.",
  },
  {
    id: "salasec.preenche",
    roles: [...ROLES],
    resources: ["attendance", "diary"],
    actions: ["create", "update"],
    when: secretaryMayFill,
    description: "O secretário da sala preenche presença e diário enquanto o relatório está pendente ou devolvido.",
  },
  {
    id: "salasec.envia",
    roles: [...ROLES],
    resources: ["report"],
    actions: ["create"],
    when: secretaryMayFill,
    description: "O secretário da sala envia o relatório da aula para validação.",
  },
  {
    id: "salasec.visitantes",
    roles: [...ROLES],
    resources: ["visitor"],
    actions: ["read", "create"],
    when: isRoomSecretary,
    description: "O secretário da sala registra os visitantes da aula.",
  },
  {
    id: "salasec.marca-ausencia",
    roles: [...ROLES],
    resources: ["substitution"],
    actions: ["update"],
    when: (s, r) => isRoomSecretary(s, r) && editable(r),
    description: "O secretário da sala pode avisar que não comparecerá, liberando o professor.",
  },

  // ───────────── Comunicação: todos leem (o público-alvo é filtrado na consulta) e todos podem postar no mural
  {
    id: "todos.comunicacao",
    roles: [...ROLES],
    resources: ["announcement", "event", "post"],
    actions: ["read"],
    description: "Todos leem os comunicados, a agenda e o mural destinados a eles.",
  },
  {
    id: "todos.ensino-leitura",
    roles: [...ROLES],
    resources: ["library"],
    actions: ["read"],
    description: "Todos consultam a biblioteca (materiais marcados como da equipe ficam só para a equipe).",
  },
  {
    id: "todos.emprestimo-proprio",
    roles: [...ROLES],
    resources: ["loan"],
    actions: ["read"],
    when: isSelf,
    description: "Cada pessoa vê os próprios empréstimos de livros.",
  },
  {
    id: "todos.mural",
    roles: [...ROLES],
    resources: ["post"],
    actions: ["create"],
    description: "Todos podem enviar fotos, testemunhos e pedidos de oração ao mural (alunos passam por aprovação).",
  },

  // ───────────── Aluno: vê apenas o que é seu
  {
    id: "aluno.classe",
    roles: ["aluno"],
    resources: ["class", "schedule", "lesson", "birthday"],
    actions: ["read"],
    when: inScope,
    description: "O aluno vê a própria classe, a escala e os aniversariantes dela.",
  },
  {
    id: "aluno.proprio",
    roles: ["aluno"],
    resources: ["person", "attendance", "material_order", "payment"],
    actions: ["read"],
    when: isSelf,
    description: "O aluno vê apenas o próprio cadastro, presença, revista e pagamentos.",
  },
  {
    id: "aluno.ensino",
    roles: ["aluno"],
    resources: ["curriculum", "quiz"],
    actions: ["read"],
    when: inScope,
    description: "O aluno vê as lições e responde aos quizzes da sua classe.",
  },
  {
    id: "aluno.certificado",
    roles: ["aluno"],
    resources: ["certificate", "loan"],
    actions: ["read"],
    when: isSelf,
    description: "O aluno vê os próprios certificados e empréstimos.",
  },
  {
    id: "aluno.proprio-sensivel",
    roles: ["aluno"],
    resources: ["person"],
    actions: ["read_sensitive"],
    when: isSelf,
    description: "O aluno vê os próprios dados de contato.",
  },
];

export interface Decision {
  allowed: boolean;
  ruleId?: string;
  reason: string;
}

/**
 * Barreira de congregação: antes de qualquer regra, um usuário restrito a certas congregações nunca alcança
 * recursos de outra (nem pela classe, nem pela congregação do recurso). Pastor/Presidente não tem restrição.
 */
function outsideCongregation(s: Subject, r: Resource): boolean {
  if (s.congregations === null || s.congregations === undefined) return false;
  if (r.congregationId !== undefined && r.congregationId !== null && !s.congregations.includes(r.congregationId)) return true;
  if (s.allowedClasses && r.classIds && r.classIds.length > 0 && !r.classIds.some((c) => s.allowedClasses!.includes(c))) return true;
  return false;
}

export function decide(s: Subject, action: Action, r: Resource): Decision {
  if (outsideCongregation(s, r)) return { allowed: false, reason: "Recurso de outra congregação." };
  for (const rule of RULES) {
    if (!rule.roles.includes(s.role)) continue;
    if (!rule.resources.includes(r.type)) continue;
    if (!rule.actions.includes(action)) continue;
    if (rule.when && !rule.when(s, r)) continue;
    return { allowed: true, ruleId: rule.id, reason: rule.description };
  }
  return { allowed: false, reason: "Nenhuma regra permite esta ação (negado por padrão)." };
}

export const can = (s: Subject, action: Action, r: Resource): boolean => decide(s, action, r).allowed;

export class ForbiddenError extends Error {
  constructor(message = "Você não tem permissão para esta ação.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function authorize(s: Subject, action: Action, r: Resource): void {
  if (!can(s, action, r)) throw new ForbiddenError();
}

/** Filtra a lista de classes para as que o sujeito pode acessar com a ação dada. */
export function allowedClassIds(s: Subject, type: ResourceType, action: Action, allClassIds: number[]): number[] {
  return allClassIds.filter((id) => can(s, action, { type, classIds: [id] }));
}

/** Itens de menu: o que cada função enxerga na navegação. */
export interface NavItem {
  href: string;
  label: string;
  type: ResourceType;
  /** ação mínima exigida para mostrar o item (padrão: read) */
  action?: Action;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Início", type: "class" },
  { href: "/admin", label: "Painel (BI)", type: "consolidated" },
  { href: "/classes", label: "Classes", type: "class" },
  { href: "/presenca", label: "Presença", type: "attendance" },
  { href: "/escala", label: "Escala", type: "schedule" },
  { href: "/diario", label: "Diário", type: "diary" },
  { href: "/validacao", label: "Validação", type: "report", action: "update" },
  { href: "/relatorio", label: "Relatório", type: "consolidated" },
  { href: "/visitantes", label: "Visitantes", type: "visitor" },
  { href: "/colaboradores", label: "Chamada da equipe", type: "staff_attendance", action: "create" },
  { href: "/financeiro", label: "Financeiro", type: "finance" },
  { href: "/comunicados", label: "Comunicados", type: "announcement" },
  { href: "/agenda", label: "Agenda", type: "event" },
  { href: "/mural", label: "Mural", type: "post" },
  { href: "/licoes", label: "Lições", type: "curriculum" },
  { href: "/quiz", label: "Quiz", type: "quiz" },
  { href: "/biblioteca", label: "Biblioteca", type: "library" },
  { href: "/certificados", label: "Certificados", type: "certificate", action: "create" },
  { href: "/aniversariantes", label: "Aniversariantes", type: "birthday" },
  { href: "/materiais", label: "Materiais", type: "material_order" },
  { href: "/pessoas", label: "Pessoas", type: "person" },
  { href: "/usuarios", label: "Usuários", type: "user" },
  { href: "/congregacoes", label: "Congregações", type: "congregation" },
  { href: "/configuracoes", label: "Configurações", type: "settings", action: "update" },
];

/**
 * Para o menu basta saber se a função tem ALGUMA permissão do tipo, em qualquer classe;
 * a autorização real é sempre refeita na página/ação.
 */
export function canSeeSomething(s: Subject, type: ResourceType, action: Action = "read"): boolean {
  if (can(s, action, { type })) return true;
  if (action !== "read") return false; // ações de escrita dependem de atributos da aula
  const classIds = [...scopeOf(s)];
  if (classIds.some((id) => can(s, action, { type, classIds: [id], teacherId: s.personId }))) return true;
  return can(s, action, { type, personId: s.personId, classIds, teacherId: s.personId });
}

/** Rótulos para a matriz de acesso do painel administrativo. */
export const RESOURCE_LABEL: Record<ResourceType, string> = {
  class: "Classes", person: "Cadastro de pessoas", enrollment: "Matrículas", schedule: "Escala", lesson: "Aulas",
  attendance: "Presença", diary: "Diário", birthday: "Aniversariantes", material: "Catálogo de revistas",
  material_order: "Revistas dos alunos", payment: "Pagamentos", report: "Relatório da aula",
  consolidated: "Relatório consolidado / BI", substitution: "Ausência do secretário", user: "Usuários e funções",
  congregation: "Congregações", settings: "Dados da igreja", backup: "Cópias de segurança",
  visitor: "Visitantes", finance: "Caixa da EBD", staff_attendance: "Chamada da equipe",
  announcement: "Comunicados", post: "Mural", event: "Agenda",
  curriculum: "Lições do trimestre", plan: "Plano de aula", quiz: "Quizzes", library: "Biblioteca",
  loan: "Empréstimos", certificate: "Certificados",
};

export const ACTION_LABEL: Record<Action, string> = {
  read: "ver", create: "criar", update: "alterar", delete: "excluir", read_sensitive: "ver contatos",
};

export type MatrixCell = { action: Action; conditional: boolean; rules: string[] }[];

/**
 * Matriz função × recurso derivada diretamente das regras (fonte única de verdade).
 * `conditional` = a permissão depende de atributos (escopo da classe, professor escalado, situação do relatório...).
 * A permissão "secretário da sala" aparece em todas as funções, sempre condicional.
 */
export function permissionMatrix(): Record<Role, Record<ResourceType, MatrixCell>> {
  const out = {} as Record<Role, Record<ResourceType, MatrixCell>>;
  for (const role of ROLES) {
    out[role] = {} as Record<ResourceType, MatrixCell>;
    for (const res of ALL_RESOURCES) {
      const cell: MatrixCell = [];
      for (const action of ALL_ACTIONS) {
        const rules = RULES.filter((r) => r.roles.includes(role) && r.resources.includes(res) && r.actions.includes(action));
        if (rules.length === 0) continue;
        cell.push({ action, conditional: rules.every((r) => r.when !== undefined), rules: rules.map((r) => r.description) });
      }
      out[role][res] = cell;
    }
  }
  return out;
}

export const ALL_RESOURCE_TYPES = ALL_RESOURCES;
