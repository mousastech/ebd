import Link from "next/link";
import { authorize } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { guarded } from "@/lib/guard";
import { ImportPeople } from "@/components/ImportPeople";

export default async function ImportPage() {
  const user = await requireUser();
  guarded(() => authorize(user, "create", { type: "person", congregationId: user.view ?? user.home ?? 1 }));
  return (
    <>
      <div className="pagehead">
        <Link href="/pessoas" className="back" aria-label="Voltar">←</Link>
        <div><h1>Importar alunos por planilha</h1><p className="muted small">Cadastre e matricule muitos alunos de uma vez.</p></div>
      </div>
      <div className="hint">
        Use as colunas <strong>nome, nascimento, telefone, responsável, e-mail, classe</strong> (só “nome” é obrigatória).
        No Excel: <em>Arquivo → Salvar como → CSV</em>. <a href="/pessoas/importar/modelo">Baixar modelo</a>.
        Quem já está cadastrado (mesmo nome e nascimento) não é duplicado.
      </div>
      <ImportPeople />
    </>
  );
}
