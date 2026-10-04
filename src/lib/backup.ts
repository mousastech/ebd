/**
 * Cópias de segurança do banco (SQLite). Uma cópia automática por dia, guardando as 30 mais recentes,
 * e cópia manual pelo painel. A cópia usa a API de backup do SQLite (consistente mesmo com o sistema em uso).
 */
import fs from "node:fs";
import path from "node:path";
import { authorize, type Subject } from "./abac";
import { db } from "./db";
import { sedeId } from "./church";

const KEEP = Number(process.env.EBD_BACKUP_KEEP ?? 30);
export const BACKUP_DIR = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.EBD_BACKUP_DIR ?? "data/backups");

export interface BackupFile {
  name: string;
  size: number;
  at: string; // ISO
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

export async function runBackup(reason: "auto" | "manual" = "manual"): Promise<BackupFile> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `ebd-${stamp()}-${reason}.db`;
  const dest = path.join(/*turbopackIgnore: true*/ BACKUP_DIR, name);
  await db().backup(dest);
  prune();
  const st = fs.statSync(dest);
  return { name, size: st.size, at: st.mtime.toISOString() };
}

function prune() {
  const files = listFiles();
  for (const f of files.slice(KEEP)) fs.rmSync(path.join(/*turbopackIgnore: true*/ BACKUP_DIR, f.name), { force: true });
}

function listFiles(): BackupFile[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((n) => /^ebd-[\dT-]+-(auto|manual)\.db$/.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(/*turbopackIgnore: true*/ BACKUP_DIR, name));
      return { name, size: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function listBackups(u: Subject): BackupFile[] {
  authorize(u, "read", { type: "backup", congregationId: sedeId() });
  return listFiles();
}

export function backupPath(u: Subject, name: string): string | null {
  authorize(u, "read", { type: "backup", congregationId: sedeId() });
  if (!/^ebd-[\dT-]+-(auto|manual)\.db$/.test(name)) return null;
  const full = path.join(/*turbopackIgnore: true*/ BACKUP_DIR, name);
  return fs.existsSync(full) ? full : null;
}

export async function manualBackup(u: Subject): Promise<BackupFile> {
  authorize(u, "create", { type: "backup", congregationId: sedeId() });
  return runBackup("manual");
}

/** Faz a cópia automática se a última tiver mais de 20 horas. Chamado ao abrir o banco e pelo script diário. */
export function autoBackupIfDue(): void {
  if (process.env.EBD_AUTO_BACKUP === "0") return;
  const last = listFiles()[0];
  if (last && Date.now() - new Date(last.at).getTime() < 20 * 3600 * 1000) return;
  runBackup("auto").catch((e) => console.error("[backup] falhou:", e));
}
