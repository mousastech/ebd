/** Faz uma cópia de segurança agora (útil para agendar no servidor: npm run backup). */
import { runBackup } from "../src/lib/backup";

runBackup("manual").then((b) => {
  console.log(`Cópia criada: ${b.name} (${Math.round(b.size / 1024)} KB)`);
  process.exit(0);
});
