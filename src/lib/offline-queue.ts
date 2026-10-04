/** Fila de chamadas feitas sem internet, guardada no aparelho (localStorage). Usada só no navegador. */
export interface QueuedCall {
  userId: number;
  lessonId: number;
  label: string;
  present: number[];
  visitors?: string;
  offering?: string;
  savedAt: string;
}

const KEY = "ebd-fila-chamadas";
export const QUEUE_EVENT = "ebd-fila-mudou";

export function readQueue(): QueuedCall[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueuedCall[];
  } catch {
    return [];
  }
}

export function writeQueue(q: QueuedCall[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* armazenamento indisponível */
  }
  window.dispatchEvent(new Event(QUEUE_EVENT));
}

/** Guarda (ou substitui) a chamada desta aula para envio posterior. */
export function enqueue(c: QueuedCall): void {
  writeQueue([...readQueue().filter((x) => !(x.lessonId === c.lessonId && x.userId === c.userId)), c]);
}
