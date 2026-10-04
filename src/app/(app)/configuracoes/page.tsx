import { backupNowAction, removeLogoAction, saveSettingsAction, uploadLogoAction } from "@/app/actions-church";
import { authorize, can } from "@/lib/abac";
import { requireUser } from "@/lib/auth";
import { listBackups } from "@/lib/backup";
import { getSettings, sedeId } from "@/lib/church";
import { guarded, type Flash } from "@/lib/guard";
import { Letterhead } from "@/components/Letterhead";
import { Empty, FlashMessage } from "@/components/ui";

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/** Dados da igreja (timbre dos relatórios e certificados), logotipo e cópias de segurança. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<Flash> }) {
  const user = await requireUser();
  const flash = await searchParams;
  const sede = sedeId();
  guarded(() => authorize(user, "update", { type: "settings", congregationId: sede }));
  const s = getSettings();
  const backups = can(user, "read", { type: "backup", congregationId: sede }) ? listBackups(user) : null;

  return (
    <>
      <div className="pagehead"><div><h1>Configurações</h1><p className="muted small">Identidade da igreja, logotipo e cópias de segurança.</p></div></div>
      <FlashMessage flash={flash} />

      <h3 className="section-label">Como sai no papel</h3>
      <div className="card"><Letterhead title="Relatório da EBD" subtitle="exemplo de timbre" /></div>

      <form action={saveSettingsAction} className="card">
        <h3>Dados da igreja</h3>
        <div className="form-grid">
          <div><label htmlFor="cn">Nome da igreja</label><input id="cn" name="church_name" defaultValue={s.church_name} required /></div>
          <div><label htmlFor="cs">Sigla / nome curto</label><input id="cs" name="church_short" defaultValue={s.church_short} placeholder="ex.: ADMSBC" /></div>
          <div><label htmlFor="pp">Pastor presidente</label><input id="pp" name="president" defaultValue={s.president} /></div>
          <div><label htmlFor="ad">Endereço</label><input id="ad" name="address" defaultValue={s.address} /></div>
          <div><label htmlFor="ci">Cidade / UF</label><input id="ci" name="city" defaultValue={s.city} /></div>
          <div><label htmlFor="cj">CNPJ</label><input id="cj" name="cnpj" defaultValue={s.cnpj} /></div>
          <div><label htmlFor="le">Lema da EBD</label><input id="le" name="lema" defaultValue={s.lema} /></div>
          <button type="submit">Salvar</button>
        </div>
      </form>

      <div className="card">
        <h3>Logotipo</h3>
        <div className="row">
          {s.logo ? <img src={`/arquivos/${s.logo}`} alt="Logotipo atual" style={{ width: 72, height: 72, objectFit: "contain" }} /> : <span className="muted">Sem logotipo.</span>}
          <form action={uploadLogoAction} className="row">
            <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" required aria-label="Arquivo do logotipo" />
            <button type="submit" className="small">Enviar</button>
          </form>
          {s.logo && <form action={removeLogoAction}><button type="submit" className="danger small">Remover</button></form>}
        </div>
        <p className="muted small">PNG com fundo transparente fica melhor. Até 2 MB.</p>
      </div>

      {backups && (
        <div className="card">
          <div className="row between">
            <h3 style={{ margin: 0 }}>Cópias de segurança</h3>
            <form action={backupNowAction}><button type="submit" className="small">Fazer cópia agora</button></form>
          </div>
          <p className="muted small">O sistema faz uma cópia automática por dia e guarda as 30 mais recentes. Baixe uma de vez em quando e guarde fora do servidor.</p>
          {backups.length === 0 ? <Empty>Nenhuma cópia ainda.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Data</th><th>Tipo</th><th>Tamanho</th><th></th></tr></thead>
              <tbody>
                {backups.slice(0, 10).map((b) => (
                  <tr key={b.name}>
                    <td className="nowrap">{new Date(b.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                    <td>{b.name.includes("-auto") ? "Automática" : "Manual"}</td>
                    <td>{kb(b.size)}</td>
                    <td className="right"><a className="btn ghost small" href={`/configuracoes/backup/${b.name}`}>Baixar</a></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}
    </>
  );
}
