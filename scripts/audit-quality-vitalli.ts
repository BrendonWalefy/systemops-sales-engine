#!/usr/bin/env tsx
/**
 * Auditoria de Qualidade Vitalli — Detectar erros de composição de resposta
 * Procura por:
 * - Duplicação de saudação ("Boa noite" 2x)
 * - Quebras de tom
 * - Respostas truncadas
 * - Repetição de conteúdo
 */
import "dotenv/config";
import { db } from "../src/infrastructure/db/client";
import { conversations, messages, leads } from "../src/infrastructure/db/schema";
import { eq, desc } from "drizzle-orm";
import fs from "fs";

const CLINIC_ID = "d24a584a-faac-4a46-9750-a718d0f8e686"; // Vitalli

interface ConversationData {
  conversationId: string;
  leadName: string;
  leadPhone: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    author: string;
    text: string;
    createdAt: Date;
  }>;
}

interface QualityIssue {
  conversationId: string;
  leadName: string;
  issueType: string;
  severity: "low" | "medium" | "high";
  description: string;
  example: string;
}

async function extractConversations(): Promise<ConversationData[]> {
  const convs = await db.query.conversations.findMany({
    where: eq(conversations.clinicId, CLINIC_ID),
    orderBy: [desc(conversations.updatedAt)],
    limit: 20,
  });

  const result: ConversationData[] = [];

  for (const conv of convs) {
    const lead = await db.query.leads.findFirst({
      where: eq(leads.id, conv.leadId),
      columns: { name: true },
    });

    const msgs = await db.query.messages.findMany({
      where: eq(messages.conversationId, conv.id),
      orderBy: [desc(messages.createdAt)],
    });

    result.push({
      conversationId: conv.id,
      leadName: lead?.name || "Unknown",
      leadPhone: conv.leadPhone,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messages: msgs.map((m) => ({
        author: m.author,
        text: m.text,
        createdAt: m.createdAt,
      })),
    });
  }

  return result;
}

function analyzeQuality(conversations: ConversationData[]): QualityIssue[] {
  const issues: QualityIssue[] = [];

  for (const conv of conversations) {
    // Pegar mensagens da IA
    const aiMessages = conv.messages.filter((m) => m.author === "agent");

    for (const msg of aiMessages) {
      const text = msg.text || "";
      if (!text) continue;

      // 1. Detectar "Boa noite" duplicado
      const bnoiteMatches = text.match(/boa noite/gi);
      if (bnoiteMatches && bnoiteMatches.length > 1) {
        issues.push({
          conversationId: conv.conversationId,
          leadName: conv.leadName,
          issueType: "DUPLICATED_GREETING",
          severity: "high",
          description: `"Boa noite" aparece ${bnoiteMatches.length}x na mesma resposta`,
          example: text.substring(0, 200),
        });
      }

      // 2. Detectar saudação genérica em pergunta de negócio
      const leadLastMsg = conv.messages.find(
        (m, i) => m.author === "lead" && i === conv.messages.length - 1,
      );
      if (leadLastMsg) {
        const isBusinessQuestion =
          /prec|custo|valor|prço|trat|consulta|agendar|marcar|quando|lentes|faceta|manutenção|garant/i.test(
            leadLastMsg.text,
          );

        const hasGenericGreeting =
          /boa noite|bom dia|olá|oi|tudo bem|como você está/i.test(text);

        if (isBusinessQuestion && hasGenericGreeting) {
          issues.push({
            conversationId: conv.conversationId,
            leadName: conv.leadName,
            issueType: "GREETING_ON_BUSINESS",
            severity: "medium",
            description:
              "Saudação genérica em resposta a pergunta de negócio (P0.1 deveria prevenir)",
            example: `Lead: "${leadLastMsg.text.substring(0, 60)}"`,
          });
        }
      }

      // 3. Detectar fragmentos muito curtos (possível truncamento)
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length === 1 && text.length < 50) {
        issues.push({
          conversationId: conv.conversationId,
          leadName: conv.leadName,
          issueType: "TRUNCATED_RESPONSE",
          severity: "medium",
          description: "Resposta muito curta (possível truncamento)",
          example: text,
        });
      }

      // 4. Detectar repetição de phrases
      const phrases = text
        .split(/[.!?\n]+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 10);

      const phraseCounts: Record<string, number> = {};
      for (const phrase of phrases) {
        const normalized = phrase.toLowerCase().substring(0, 50);
        phraseCounts[normalized] = (phraseCounts[normalized] || 0) + 1;
      }

      for (const [phrase, count] of Object.entries(phraseCounts)) {
        if (count > 1) {
          issues.push({
            conversationId: conv.conversationId,
            leadName: conv.leadName,
            issueType: "REPETITIVE_CONTENT",
            severity: "low",
            description: `Frase repetida ${count}x: "${phrase}"`,
            example: text.substring(0, 150),
          });
          break; // Um issue por mensagem
        }
      }

      // 5. Detectar estrutura "Nós somos" repetida
      const weAreMatches = text.match(/nós somos|nós trabalhamos/gi);
      if (weAreMatches && weAreMatches.length > 1) {
        issues.push({
          conversationId: conv.conversationId,
          leadName: conv.leadName,
          issueType: "REPETITIVE_STRUCTURE",
          severity: "medium",
          description: "Estrutura com Nos repetida múltiplas vezes",
          example: text.substring(0, 200),
        });
      }
    }
  }

  return issues;
}

async function main() {
  console.log("🔍 Auditando qualidade de respostas Vitalli...\n");

  const conversations = await extractConversations();
  console.log(`📊 Extraídas ${conversations.length} conversas\n`);

  const issues = analyzeQuality(conversations);

  console.log(`⚠️  Encontrados ${issues.length} problemas potenciais\n`);
  console.log("━".repeat(80));

  // Agrupar por tipo
  const byType: Record<string, QualityIssue[]> = {};
  for (const issue of issues) {
    if (!byType[issue.issueType]) byType[issue.issueType] = [];
    byType[issue.issueType].push(issue);
  }

  for (const [issueType, issueList] of Object.entries(byType)) {
    console.log(
      `\n❌ ${issueType} (${issueList.length} ocorrências)`,
    );
    console.log("─".repeat(80));

    // Mostrar primeiras 3
    for (const issue of issueList.slice(0, 3)) {
      console.log(
        `\n  Lead: ${issue.leadName}`,
      );
      console.log(
        `  Severity: ${issue.severity === "high" ? "🔴 ALTA" : issue.severity === "medium" ? "🟠 MÉDIA" : "🟡 BAIXA"}`,
      );
      console.log(
        `  Descrição: ${issue.description}`,
      );
      console.log(
        `  Exemplo: ${issue.example.substring(0, 100)}...`,
      );
    }

    if (issueList.length > 3) {
      console.log(`\n  ... e ${issueList.length - 3} mais`);
    }
  }

  console.log("\n" + "━".repeat(80));

  // Salvar JSON completo
  fs.writeFileSync(
    "/tmp/vitalli-quality-audit.json",
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        totalConversations: conversations.length,
        totalIssues: issues.length,
        issuesByType: Object.fromEntries(
          Object.entries(byType).map(([type, list]) => [type, list.length]),
        ),
        allIssues: issues,
      },
      null,
      2,
    ),
  );

  console.log(
    "\n✅ Audit completo salvo em /tmp/vitalli-quality-audit.json",
  );

  // Resumo crítico
  const highSeverity = issues.filter((i) => i.severity === "high");
  if (highSeverity.length > 0) {
    console.log(
      `\n🚨 ATENÇÃO: ${highSeverity.length} problemas CRÍTICOS encontrados!`,
    );
    for (const issue of highSeverity) {
      console.log(`   • ${issue.leadName}: ${issue.description}`);
    }
  }
}

main().catch(console.error);
