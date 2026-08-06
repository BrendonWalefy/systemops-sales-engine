/**
 * Validação de qualidade das conversas da clínica demo — roda o pipeline REAL
 * (IntentClassifier + ResponseComposer) em conversas representativas e imprime a
 * transcrição, para revisar se ficou coerente/UAU antes de seedar em produção.
 *
 * Faz chamadas reais à OpenAI (uns centavos). NÃO escreve no banco.
 *
 * Uso: npx dotenv -e .env.local -- npx tsx scripts/validate-demo-convos.ts
 */
import "dotenv/config";
import { ClinicTimezone } from "../src/core/scheduling/ClinicTimezone";
import { generateDemoThread, type DemoClinicContext } from "../src/application/demo/generate-demo-conversation";
import { DEMO_CONVERSATIONS } from "../src/application/demo/demo-conversation-scripts";

const ctx: DemoClinicContext = {
  clinicName: "Odonto Marques",
  specialty: "Odontologia estética e reabilitação oral",
  toneOfVoice: "Consultivo, acolhedor, elegante e objetivo. Trata por você, com cordialidade premium.",
  playbook:
    "Procedimentos e valores: avaliação R$150; lentes de resina a partir de R$950 por dente; " +
    "lentes de porcelana a partir de R$1.800 por dente; prótese dentária a partir de R$2.400; " +
    "remoção de dentes a partir de R$650; botox a partir de R$890; clareamento a partir de R$690; " +
    "implante a partir de R$2.900; alinhadores a partir de R$350/mês; limpeza R$220. " +
    "Valores sempre 'a partir de', após avaliação. " +
    "Objeção de preço: parcelamos no cartão e o plano é montado na avaliação. Especialista comercial: Marina.",
  commercialPolicy:
    "Valores sempre 'a partir de', pois dependem de avaliação. Lentes por dente. " +
    "Prótese, remoção de dentes e botox dependem de avaliação. Parcelamos no cartão. Avaliação prévia R$150.",
  receptionistName: "Marina",
  timezone: new ClinicTimezone("America/Sao_Paulo"),
};

const SAMPLE_KEYS = [
  "lentes-resina-noiva",
  "protese-protocolo-indicacao",
  "implante-follow-up-resgate",
  "handoff-caso-complexo",
  "alinhadores-fora-horario",
];

async function main(): Promise<void> {
  process.env.DISABLE_REAL_OPENAI = ""; // força IA real
  for (const key of SAMPLE_KEYS) {
    const conv = DEMO_CONVERSATIONS.find((c) => c.key === key);
    if (!conv) {
      console.log(`\n[!] roteiro '${key}' não encontrado`);
      continue;
    }
    console.log(`\n\n═════ ${conv.key} · ${conv.treatment} · ${conv.status} ═════`);
    const msgs = await generateDemoThread(ctx, conv.turns);
    for (const m of msgs) {
      const who = m.author === "lead" ? "👤 LEAD  " : m.author === "clinic_user" ? "🧑‍⚕️ EQUIPE" : "💬 MARINA";
      const flags = [m.voice ? "🔊" : "", m.media ? `[${m.media}]` : ""].filter(Boolean).join(" ");
      console.log(`${who}${flags ? " " + flags : ""}: ${m.body.replace(/\n/g, " ")}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
