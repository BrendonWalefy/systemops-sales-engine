/**
 * Updates the pilot clinic with real playbook and business info.
 * Run: npx tsx scripts/update-clinic-playbook.ts
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { clinics } from "../src/infrastructure/db/schema";
import { eq } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("DATABASE_URL not set"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

const CLINIC_ID = "c9137774-e783-4461-ac2b-e2f01be739a6";

const playbook = `
ESPECIALIDADES OFERECIDAS:
- Implante dentário (substituição de dentes perdidos)
- Próteses dentárias (fixa e removível)
- Alinhadores invisíveis (correção ortodôntica sem aparelho metálico)
- Clareamento dental (a laser e com moldeiras)
- Harmonização orofacial (botox, preenchimento labial, bichectomia)
- Tratamento de canal
- Limpeza e prevenção

AVALIAÇÃO GRATUITA:
Toda consulta começa com avaliação gratuita. O dentista examina, entende o objetivo do paciente e só então orienta sobre o tratamento adequado. Isso evita orçamentos errados e gera confiança.

COMO CONDUZIR A CONVERSA:
1. Acolher com o nome da clínica na primeira mensagem.
2. Perguntar qual é o objetivo ou interesse do lead (o que o trouxe até a clínica).
3. Validar o interesse e posicionar a avaliação gratuita como melhor primeiro passo.
4. Perguntar preferência de horário: manhã ou tarde? Qual dia da semana?
5. Informar que a equipe vai confirmar o melhor horário disponível em breve.
6. Se o lead confirmar interesse em agendar, marcar stage como ready_to_schedule.

OBJEÇÕES COMUNS E COMO RESPONDER:
- "Quanto custa?" → "O valor varia conforme a avaliação. A consulta inicial é gratuita e o Dr. vai te orientar pessoalmente."
- "Preciso pensar" → "Claro! A avaliação é gratuita e sem compromisso — só uma conversa com o doutor."
- "Fica longe?" → Perguntar onde fica o lead e dizer que a equipe pode confirmar o endereço completo.
- "Tenho medo de dentista" → Empatia + mencionar que o ambiente é acolhedor e sem pressa.

TOM DE VOZ:
Acolhedor, próximo, sem pressa. Nunca pressionar. Nunca usar termos técnicos sem explicar. Tratar o lead como alguém que precisa de orientação, não de venda.
`.trim();

async function main() {
  await db.update(clinics).set({
    specialty: "odontologia",
    city: null,
    toneOfVoice: "Acolhedor, próximo, sem pressa. Nunca pressionar.",
    commercialPolicy: "Avaliação gratuita como primeiro passo. Nunca informar valores por mensagem.",
    businessHours: "Segunda a sexta das 8h às 18h. Sábado das 8h às 13h.",
    playbook,
    updatedAt: new Date(),
  }).where(eq(clinics.id, CLINIC_ID));

  console.log("✅ Playbook da Ximendes Odontologia atualizado.");
  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
