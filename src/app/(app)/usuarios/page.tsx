import { changeRoleAction, createUserAction, resetPasswordAction } from "@/app/actions";
import { ROLES, ROLE_LABEL } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { guarded, type Flash } from "@/lib/guard";
import { listPeople, listUsers } from "@/lib/repo";
import { FlashMessage } from "@/components/ui";

export default async function UsersPage({ searchParams }: { searchParams: Promise<Flash> }) {
  const user = await requireUser();
  const flash = await searchParams;
  const users = guarded(() => listUsers(user));
  const withLogin = new Set(users.map((u) => u.person_id));
  const candidates = listPeople(user).filter((p) => !withLogin.has(p.id));
  // funções de alcance global só podem ser concedidas pelo Pastor/Presidente
  const roles = ROLES.filter((r) => user.role === "pastor" || (r !== "pastor" && r !== "supervisor"));
  const multi = new Set(users.map((u) => u.congregation_id)).size > 1 || user.role === "pastor";

  return (
    <>
      <h1>Usuários e funções</h1>
      <p className="muted">
        A função define o que cada pessoa pode fazer. O coordenador age nas classes da Escala que coordena; professor e
        colaborador, nas classes em que estão na equipe; o secretário de sala é designado na página de cada classe.
        Veja a matriz completa em <a href="/admin?aba=acessos">Painel → Controle de acesso</a>.
      </p>
      <FlashMessage flash={flash} />

      <div className="card table-wrap">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th>{multi && <th>Congregação</th>}<th>Função</th><th>Senha</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                {multi && <td className="small">{u.congregation}</td>}
                <td>
                  <form action={changeRoleAction} className="row" style={{ flexWrap: "nowrap" }}>
                    <input type="hidden" name="user_id" value={u.id} />
                    <select name="role" defaultValue={u.role} aria-label={`Função de ${u.name}`} style={{ maxWidth: 190 }}>
                      {(roles.includes(u.role) ? roles : [u.role]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                    {roles.includes(u.role) && <button className="ghost small" type="submit">Alterar</button>}
                  </form>
                </td>
                <td>
                  <details>
                    <summary className="small">Redefinir</summary>
                    <form action={resetPasswordAction} className="row" style={{ flexWrap: "nowrap", marginTop: ".4rem" }}>
                      <input type="hidden" name="user_id" value={u.id} />
                      <input name="password" type="password" minLength={8} required autoComplete="new-password"
                        placeholder="nova senha" aria-label={`Nova senha de ${u.name}`} style={{ maxWidth: 160 }} />
                      <button className="ghost small" type="submit">Salvar</button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={createUserAction} className="card">
        <h2 style={{ marginTop: 0 }}>Novo acesso</h2>
        <div className="form-grid">
          <div>
            <label htmlFor="up">Pessoa</label>
            <select id="up" name="person_id" required>
              <option value="">Selecione…</option>
              {candidates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div><label htmlFor="ue">E-mail</label><input id="ue" name="email" type="email" required /></div>
          <div><label htmlFor="us">Senha inicial</label><input id="us" name="password" type="password" minLength={8} required autoComplete="new-password" /></div>
          <div>
            <label htmlFor="ur">Função</label>
            <select id="ur" name="role" defaultValue="professor">
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <button type="submit">Criar acesso</button>
        </div>
      </form>
    </>
  );
}
