/**
 * SEED DEMO (CLI) — clínica fictícia premium "Odonto Marques" para conteúdo
 * de marketing. Fina camada sobre a lógica compartilhada em
 * `src/application/demo/seed-demo-clinic.ts` (a mesma usada pelo botão do
 * painel owner), para que script e UI nunca divirjam.
 *
 * Uso:
 *   npm run seed:demo
 *   # ou: npx dotenv -e .env.local -- npx tsx scripts/seed-demo.ts
 *
 * Requer DATABASE_URL no ambiente (ou .env.local). Idempotente: cada execução
 * reseta e re-data tudo, deixando o painel "fresco" no dia da gravação.
 */
import "dotenv/config";
import { seedDemoClinic } from "../src/application/demo/seed-demo-clinic";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definido (use .env.local).");
  process.exit(1);
}

seedDemoClinic()
  .then((r) => {
    console.log("\n✅ Clínica demo semeada: Odonto Marques");
    console.log(`   clinicId: ${r.clinicId}`);
    console.log(`   slug:     ${r.slug}`);
    console.log("\n   Login da clínica (para gravar como Dra. Helena):");
    console.log(`     email:  ${r.adminEmail}`);
    console.log(`     senha:  ${r.adminPassword}`);
    console.log("\n   Volume gerado:");
    console.log(`     leads:        ${r.counts.leads}`);
    console.log(`     conversas:    ${r.counts.conversations}`);
    console.log(
      `     mensagens:    ${r.counts.messages}  (IA: ${r.counts.agentMessages} → ~${r.counts.hoursSaved}h economizadas)`,
    );
    console.log(`     agendamentos: ${r.counts.appointments}`);
    console.log(`     follow-ups:   ${r.counts.followUps}`);
    console.log(`     msgs noturnas:${r.counts.afterHoursMessages}`);
    console.log("\n   Dica: rode de novo a qualquer momento para resetar e re-datar tudo.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Falha no seed-demo:", err);
    process.exit(1);
  });
