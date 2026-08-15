import { writeFileSync } from "node:fs";
import { and, desc, eq } from "drizzle-orm";
import {
  redactCorpusText,
  type IdentityTerm,
} from "@/application/corpus/redact-corpus-text";
import { assertClinicAllowedForReplayExport } from "@/application/replay/replay-export-policy";
import { sanitizeReplayText } from "@/application/replay/sanitize-replay-text";
import { db } from "@/infrastructure/db/client";
import {
  mediaAssets,
  organizations,
  playbookVersions,
  treatments,
} from "@/infrastructure/db/schema";

/**
 * Enriquece a fixture de um tenant com os fatos que o sistema **poderia** saber.
 *
 * Só leitura. Cada fato carrega a coluna de onde veio, porque a pergunta que a
 * fixture existe para responder é "de onde o sistema poderia saber isso?" — e um
 * fato sem essa resposta não entra.
 *
 * Duas regras que moldam o formato:
 *
 * 1. **Valor não é o ponto; disponibilidade é.** Endereço e link de mapa entram
 *    como *registrados / não registrados*, nunca como texto. O revisor precisa
 *    saber se o sistema tinha de onde tirar o endereço — não qual é o endereço.
 *    Gravar o valor devolveria ao corpus a identidade de tenant que a auditoria
 *    de PII removeu, e não acrescentaria nada ao julgamento.
 * 2. **Ausente é um estado declarado, não silêncio.** `not_provided` é escrito
 *    na fixture. Sem isso, "o renderer não mostrou" e "o tenant não tem" ficam
 *    indistinguíveis, que foi exatamente o erro que a segunda revisão expôs.
 */

export type FactStatus = "known" | "not_provided" | "contradicted";

export type TenantFact = {
  status: FactStatus;
  /** O que o sistema sabe. Em fato sensível, a disponibilidade e não o valor. */
  value: string | null;
  /** Coluna, tabela ou arquivo de onde o fato vem. `null` só em not_provided. */
  source: string | null;
};

type Arguments = { clinicKey: string; ref: string; outputPath: string };

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  assertClinicAllowedForReplayExport(
    args.clinicKey,
    process.env.REPLAY_EXPORT_ALLOWED_CLINICS,
  );

  const [clinic] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      address: organizations.address,
      addressComplement: organizations.addressComplement,
      mapsUrl: organizations.mapsUrl,
      businessHours: organizations.businessHours,
      timezone: organizations.timezone,
      segment: organizations.segment,
    })
    .from(organizations)
    .where(eq(organizations.slug, args.clinicKey))
    .limit(1);
  if (!clinic) throw new Error(`clinic "${args.clinicKey}" not found`);

  const identityTerms: IdentityTerm[] = [
    ...(clinic.name ? [{ term: clinic.name, marker: "[NEGOCIO]" }] : []),
    ...(process.env.CORPUS_REDACT_PLACES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((term) => ({ term, marker: "[LOCAL]" })),
  ];
  const clean = (text: string): string =>
    redactCorpusText(sanitizeReplayText(text, null), identityTerms);

  const treatmentRows = await db
    .select({
      name: treatments.name,
      description: treatments.description,
      priceCents: treatments.priceCents,
      requiresEvaluationFirst: treatments.requiresEvaluationFirst,
    })
    .from(treatments)
    .where(eq(treatments.clinicId, clinic.id))
    .orderBy(treatments.name);

  const assets = await db
    .select({ type: mediaAssets.type, title: mediaAssets.title })
    .from(mediaAssets)
    .where(eq(mediaAssets.clinicId, clinic.id));

  const [playbook] = await db
    .select({ commercialPolicy: playbookVersions.commercialPolicy })
    .from(playbookVersions)
    .where(
      and(
        eq(playbookVersions.clinicId, clinic.id),
        eq(playbookVersions.status, "active"),
      ),
    )
    .orderBy(desc(playbookVersions.createdAt))
    .limit(1);

  const mediaByType = assets.reduce<Record<string, number>>((acc, asset) => {
    acc[asset.type] = (acc[asset.type] ?? 0) + 1;
    return acc;
  }, {});

  const facts: Record<string, TenantFact> = {
    address: clinic.address
      ? {
          status: "known",
          // Disponibilidade, não valor — ver regra 1 no topo.
          value: `endereço registrado na configuração do tenant${clinic.addressComplement ? ", com complemento" : ""}${clinic.mapsUrl ? ", com link de mapa" : ", sem link de mapa"}`,
          source: "organizations.address / address_complement / maps_url",
        }
      : { status: "not_provided", value: null, source: null },
    businessHours: clinic.businessHours
      ? {
          status: "known",
          value: clean(clinic.businessHours),
          source: "organizations.business_hours",
        }
      : { status: "not_provided", value: null, source: null },
    serviceAttributes: treatmentRows.some((row) => row.description)
      ? {
          status: "known",
          value: `${treatmentRows.filter((row) => row.description).length} de ${treatmentRows.length} serviços têm descrição cadastrada`,
          source: "treatments.description",
        }
      : { status: "not_provided", value: null, source: null },
    mediaLibrary:
      assets.length > 0
        ? {
            status: "known",
            value: Object.entries(mediaByType)
              .map(([type, count]) => `${count} ${type}`)
              .join(", "),
            source: "media_assets",
          }
        : { status: "not_provided", value: null, source: null },
    commercialPolicy: playbook?.commercialPolicy
      ? {
          status: "known",
          value: clean(playbook.commercialPolicy).slice(0, 600),
          source: "playbook_versions.commercial_policy (versão ativa)",
        }
      : { status: "not_provided", value: null, source: null },
  };

  const output = {
    ref: args.ref,
    segment: clinic.segment,
    timezone: clinic.timezone,
    facts,
    services: treatmentRows.map((row) => ({
      name: clean(row.name),
      priceCents: row.priceCents,
      ...(row.description
        ? { description: clean(row.description).slice(0, 300) }
        : {}),
      ...(row.requiresEvaluationFirst ? { requiresEvaluationFirst: true } : {}),
    })),
    provenance: {
      exportedAt: new Date().toISOString(),
      readOnly: true,
      note: "Fatos derivados da configuração do tenant por SELECT. Nenhum valor foi copiado de resposta de IA ou de operador.",
    },
  };

  writeFileSync(args.outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({
      outputPath: args.outputPath,
      ref: args.ref,
      known: Object.entries(facts).filter(([, f]) => f.status === "known").length,
      notProvided: Object.entries(facts).filter(
        ([, f]) => f.status === "not_provided",
      ).length,
      services: treatmentRows.length,
    }),
  );
}

export function parseArguments(argv: string[]): Arguments {
  return {
    clinicKey: required(argv, "--clinic"),
    ref: required(argv, "--ref"),
    outputPath: required(argv, "--out"),
  };
}

function required(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : null;
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

if (process.env.VITEST !== "true") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
