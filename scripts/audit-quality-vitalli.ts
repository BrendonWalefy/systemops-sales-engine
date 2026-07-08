#!/usr/bin/env tsx
/**
 * Auditoria de Qualidade Vitalli — Detectar erros de composição de resposta
 * pós-deploy P0.1-P0.6 (18:52 08/07/2026).
 *
 * Procura por:
 * - Duplicação de saudação ("Boa noite" 2x)
 * - Saudação genérica em pergunta de negócio (P0.1 deveria prevenir)
 * - Respostas truncadas
 * - Repetição de conteúdo/estrutura
 */
import "dotenv/config";
import { db } from "../src/infrastructure/db/client";
import { conversations, messages, leads } from "../src/infrastructure/db/schema";
import { eq, desc } from "drizzle-orm";
import fs from "fs";

const CLINIC_ID = "d24a584a-faac-4a46-9750-a718d0f8e686"; // Vitalli
const DEPLOY_TIMESTAMP = new Date("2026-07-08T18:52:00Z");

interface ConversationData {
  conversationId: string;
  leadName: string;
  leadPhone: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    author: string;
    body: string;
    intent: string | null;
    createdAt: Date;
  }>;
}

interface QualityIssue {
  conversationId: string;
  leadName: string;
  period: "ANTES" | "DEPOIS";
  issueType: string;
  severity: "low" | "medium" | "high";
  description: string;
  example: string;
}

async function extractConversations(): Promise<ConversationData[]> {
  const convs = await db.query.conversations.findMany({
    where: eq(conversations.clinicId, CLINIC_ID),
    orderBy: [desc(conversations.updatedAt)],
    limit: 40,
  });

  const result: ConversationData[] = [];

  for (const conv of convs) {
    const lead = await db.query.leads.findFirst({
      where: eq(leads.id, conv.leadId),
      columns: { name: true, phone: true },
    });

    const msgs = await db.query.messages.findMany({
      where: eq(messages.conversationId, conv.id),
      orderBy: [desc(messages.createdAt)],
    });

    result.push({
      conversationId: conv.id,
      leadName: lead?.name || "Unknown",
      leadPhone: lead?.phone || null,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messages: msgs
        .slice()
        .reverse() // ordem cronológica
        .map((m) => ({
          author: m.author,
          body: m.body,
          intent: m.intent,
          createdAt: m.createdAt,
        })),
    });
  }

  return result;
}

function analyzeQuality(conversations: ConversationData[]): QualityIssue[] {
  const issues: QualityIssue[] = [];

  for (const conv of conversations) {
    const period: "ANTES" | "DEPOIS" =
      conv.updatedAt >= DEPLOY_TIMESTAMP ? "DEPOIS" : "ANTES";

    // Pegar mensagens da IA (author = "agent")
    const aiMessages = conv.messages.filter((m) => m.author === "agent");

    for (let i = 0; i < aiMessages.length; i++) {
      const msg = aiMessages[i];
      const text = msg.body || "";
      if (!text) continue;

      // 1. Detectar "Boa noite"/"Bom dia" duplicado na MESMA mensagem
      const greetingMatches = text.match(/boa noite|bom dia|boa tarde/gi);
      if (greetingMatches && greetingMatches.length > 1) {
        issues.push({
          conversationId: conv.conversationId,
          leadName: conv.leadName,
          period,
          issueType: "DUPLICATED_GREETING",
          severity: "high",
          description: `Saudação repetida ${greetingMatches.length}x na mesma resposta`,
          example: text.substring(0, 250),
        });
      }

      // 2. Detectar saudação genérica em resposta a pergunta de negócio
      // Olha a mensagem do lead imediatamente anterior a esta resposta da IA
      const msgIndex = conv.messages.indexOf(msg);
      const precedingLeadMsg = [...conv.messages.slice(0, msgIndex)]
        .reverse()
        .find((m) => m.author === "lead");

      if (precedingLeadMsg) {
        const isBusinessQuestion =
          /prec|custo|valor|preço|trat|consulta|agendar|marcar|quando|lentes|faceta|manutenção|garant/i.test(
            precedingLeadMsg.body,
          );

        const startsWithGreeting =
          /^\s*(boa noite|bom dia|boa tarde|olá|oi)[,!.]?\s/i.test(text);

        if (isBusinessQuestion && startsWithGreeting) {
          issues.push({
            conversationId: conv.conversationId,
            leadName: conv.leadName,
            period,
            issueType: "GREETING_ON_BUSINESS",
            severity: "medium",
            description:
              "Resposta abre com saudação genérica em vez de ir direto à pergunta de negócio (P0.1)",
            example: `Lead: "${precedingLeadMsg.body.substring(0, 80)}" → IA: "${text.substring(0, 100)}"`,
          });
        }
      }

      // 3. Detectar fragmentos muito curtos (possível truncamento)
      if (text.length < 15) {
        issues.push({
          conversationId: conv.conversationId,
          leadName: conv.leadName,
          period,
          issueType: "TRUNCATED_RESPONSE",
          severity: "medium",
          description: "Resposta muito curta (possível truncamento)",
          example: text,
        });
      }

      // 4. Detectar repetição de frases dentro da mesma mensagem
      const phrases = text
        .split(/[.!?\n]+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 15);

      const phraseCounts: Record<string, number> = {};
      for (const phrase of phrases) {
        const normalized = phrase.toLowerCase().substring(0, 60);
        phraseCounts[normalized] = (phraseCounts[normalized] || 0) + 1;
      }

      for (const [phrase, count] of Object.entries(phraseCounts)) {
        if (count > 1) {
          issues.push({
            conversationId: conv.conversationId,
            leadName: conv.leadName,
            period,
            issueType: "REPETITIVE_CONTENT",
            severity: "low",
            description: `Frase repetida ${count}x: "${phrase}"`,
            example: text.substring(0, 200),
          });
          break;
        }
      }

      // 5. Detectar resposta vazia enviada (P0.6 deveria ter interceptado)
      if (text.trim().length === 0) {
        issues.push({
          conversationId: conv.conversationId,
          leadName: conv.leadName,
          period,
          issueType: "EMPTY_RESPONSE_SENT",
          severity: "high",
          description: "Mensagem vazia foi enviada ao lead (P0.6 deveria ter capturado)",
          example: "(vazio)",
        });
      }
    }

    // 6. Handoff sem resposta prévia da IA (possível crash silencioso não capturado)
    const hasHandoffIntent = conv.messages.some(
      (m) => m.author === "agent" && m.intent === "needs_human",
    );
    if (hasHandoffIntent) {
      const lastAgentMsg = [...aiMessages].pop();
      if (lastAgentMsg && lastAgentMsg.body.trim().length === 0) {
        issues.push({
          conversationId: conv.conversationId,
          leadName: conv.leadName,
          period,
          issueType: "SILENT_HANDOFF_DETECTED",
          severity: "low",
          description: "Handoff silencioso detectado (comportamento esperado do P0.6)",
          example: "(sem mensagem ao lead — needs_human ativado)",
        });
      }
    }
  }

  return issues;
}

async function main() {
  console.log("🔍 Auditando qualidade de respostas Vitalli (pós-deploy P0.1-P0.6)...\n");
  console.log(`📅 Deploy timestamp: ${DEPLOY_TIMESTAMP.toISOString()}\n`);

  const conversationsData = await extractConversations();
  console.log(`📊 Extraídas ${conversationsData.length} conversas\n`);

  const antesConvs = conversationsData.filter((c) => c.updatedAt < DEPLOY_TIMESTAMP);
  const depoisConvs = conversationsData.filter((c) => c.updatedAt >= DEPLOY_TIMESTAMP);

  console.log(`  • ANTES do deploy: ${antesConvs.length} conversas`);
  console.log(`  • DEPOIS do deploy: ${depoisConvs.length} conversas\n`);

  const issues = analyzeQuality(conversationsData);

  const antesIssues = issues.filter((i) => i.period === "ANTES");
  const depoisIssues = issues.filter((i) => i.period === "DEPOIS");

  console.log("━".repeat(80));
  console.log(`⚠️  Total: ${issues.length} problemas | ANTES: ${antesIssues.length} | DEPOIS: ${depoisIssues.length}`);
  console.log("━".repeat(80));

  // Agrupar por tipo E período
  const byType: Record<string, QualityIssue[]> = {};
  for (const issue of issues) {
    if (!byType[issue.issueType]) byType[issue.issueType] = [];
    byType[issue.issueType].push(issue);
  }

  for (const [issueType, issueList] of Object.entries(byType)) {
    const antesCount = issueList.filter((i) => i.period === "ANTES").length;
    const depoisCount = issueList.filter((i) => i.period === "DEPOIS").length;

    console.log(`\n❌ ${issueType}`);
    console.log(`   ANTES: ${antesCount} | DEPOIS: ${depoisCount}`);
    console.log("─".repeat(80));

    for (const issue of issueList.slice(0, 4)) {
      console.log(`\n  [${issue.period}] Lead: ${issue.leadName}`);
      console.log(
        `  Severity: ${issue.severity === "high" ? "🔴 ALTA" : issue.severity === "medium" ? "🟠 MÉDIA" : "🟡 BAIXA"}`,
      );
      console.log(`  ${issue.description}`);
      console.log(`  Exemplo: ${issue.example.substring(0, 150)}`);
    }

    if (issueList.length > 4) {
      console.log(`\n  ... e ${issueList.length - 4} mais`);
    }
  }

  console.log("\n" + "━".repeat(80));

  fs.writeFileSync(
    "/tmp/vitalli-quality-audit.json",
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        deployTimestamp: DEPLOY_TIMESTAMP.toISOString(),
        totalConversations: conversationsData.length,
        antesConversations: antesConvs.length,
        depoisConversations: depoisConvs.length,
        totalIssues: issues.length,
        antesIssues: antesIssues.length,
        depoisIssues: depoisIssues.length,
        issuesByType: Object.fromEntries(
          Object.entries(byType).map(([type, list]) => [
            type,
            {
              total: list.length,
              antes: list.filter((i) => i.period === "ANTES").length,
              depois: list.filter((i) => i.period === "DEPOIS").length,
            },
          ]),
        ),
        allIssues: issues,
      },
      null,
      2,
    ),
  );

  console.log("\n✅ Audit completo salvo em /tmp/vitalli-quality-audit.json");

  const highSeverityDepois = depoisIssues.filter((i) => i.severity === "high");
  if (highSeverityDepois.length > 0) {
    console.log(`\n🚨 ATENÇÃO: ${highSeverityDepois.length} problemas CRÍTICOS pós-deploy!`);
    for (const issue of highSeverityDepois) {
      console.log(`   • ${issue.leadName}: ${issue.description}`);
    }
  } else {
    console.log(`\n✅ Nenhum problema crítico encontrado nas conversas pós-deploy.`);
  }
}

main().catch(console.error);
