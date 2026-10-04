/** Roda as rotinas diárias agora (aniversários, lembretes, ausentes, cópia de segurança). */
import { runDailyJobs } from "../src/lib/jobs";

console.log("Rotinas executadas:", runDailyJobs());
process.exit(0);
