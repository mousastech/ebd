import { redirect } from "next/navigation";
import { ForbiddenError } from "./abac";

/** Se a leitura for negada pelo ABAC, volta ao início com aviso (em vez de erro 500). */
export function guarded<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ForbiddenError) redirect(`/?erro=${encodeURIComponent(e.message)}`);
    throw e;
  }
}

export type Flash = { ok?: string; erro?: string };
