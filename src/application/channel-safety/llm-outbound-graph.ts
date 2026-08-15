import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Descoberta estrutural dos caminhos "LLM → canal externo".
 *
 * Existe porque a auditoria do Ciclo B mediu a coisa errada: contou chamadores
 * de `ResponseComposer.compose()` e concluiu que a superfície estava fechada.
 * `cron/recovery-campaign` escrevia o próprio prompt, chamava a OpenAI direto e
 * enfileirava para o lead sem tocar naquela classe — invisível para a métrica.
 *
 * A resposta não é auditar de novo daqui a três meses. É derivar a superfície do
 * grafo de imports, a cada `npm test`, e comparar contra um registro declarado.
 * Caminho novo que gere texto e envie ao lead quebra o CI até alguém declarar,
 * por escrito, em qual categoria ele entra.
 *
 * Alcance por imports é aproximação conservadora: superestima (um módulo pode
 * importar o gerador e nunca chamá-lo) e nunca subestima, que é o lado seguro
 * para uma proteção. Falso positivo custa uma linha no registro; falso negativo
 * custa uma mensagem inventada no WhatsApp de um lead.
 */
export type LlmOutboundPath = {
  /** Caminho relativo à raiz do repo. */
  module: string;
  /** Como esse módulo alcança geração de texto. */
  llmVia: string[];
  /** Sinks externos chamados diretamente por ele. */
  sinks: string[];
  /** Se ele importa a fronteira aprovada. */
  usesPlanner: boolean;
};

/** Pacotes e módulos que produzem texto de modelo. */
const LLM_PACKAGES = ["openai", "@anthropic-ai/sdk"];

/** Chamadas que colocam texto num canal externo ao produto. */
const OUTBOUND_SINK_CALLS = [
  "enqueueOutboundMessage(",
  "sendTextMessage(",
  "sendMediaMessage(",
  "sendButtonListMessage(",
  "sendEmail(",
];

/** A fronteira aprovada: plano → gerador → validador → fallback. */
const PLANNER_MODULE = "core/conversation/ConversationResponsePlanner";

export function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

/** Especificadores importados por um arquivo, resolvidos para caminho de repo quando internos. */
export function readImports(file: string, repoRoot: string): {
  internal: string[];
  external: string[];
} {
  const source = readFileSync(file, "utf-8");
  const internal: string[] = [];
  const external: string[] = [];
  const importRe = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g;
  const dynamicRe = /import\(\s*["']([^"']+)["']\s*\)/g;

  for (const re of [importRe, dynamicRe]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const specifier = match[1]!;
      if (specifier.startsWith("@/")) {
        internal.push(specifier.slice(2));
      } else if (specifier.startsWith(".")) {
        const resolved = path.relative(
          path.join(repoRoot, "src"),
          path.resolve(path.dirname(file), specifier),
        );
        internal.push(resolved);
      } else {
        external.push(specifier);
      }
    }
  }
  return { internal, external };
}

/** Um módulo "alcança LLM" se ele, ou algo que ele importa, importa um pacote de modelo. */
export function buildLlmOutboundPaths(repoRoot: string): LlmOutboundPath[] {
  const srcRoot = path.join(repoRoot, "src");
  const files = collectSourceFiles(srcRoot);

  const keyOf = (file: string) =>
    path.relative(srcRoot, file).replace(/\.tsx?$/, "");

  const imports = new Map<string, { internal: string[]; external: string[] }>();
  const sinksByModule = new Map<string, string[]>();
  for (const file of files) {
    const key = keyOf(file);
    imports.set(key, readImports(file, repoRoot));
    const source = readFileSync(file, "utf-8");
    const sinks = OUTBOUND_SINK_CALLS.filter((call) => source.includes(call)).map((call) =>
      call.replace("(", ""),
    );
    if (sinks.length > 0) sinksByModule.set(key, sinks);
  }

  // Alcance de geração de texto, com memo e proteção contra ciclo de imports.
  const reachCache = new Map<string, string[] | null>();
  const resolveReach = (key: string, seen: Set<string>): string[] | null => {
    if (reachCache.has(key)) return reachCache.get(key)!;
    if (seen.has(key)) return null;
    seen.add(key);

    const entry = imports.get(key);
    if (!entry) return null;

    const direct = entry.external.filter((pkg) => LLM_PACKAGES.includes(pkg));
    if (direct.length > 0) {
      reachCache.set(key, direct);
      return direct;
    }
    for (const dependency of entry.internal) {
      const via = resolveReach(dependency, seen);
      if (via) {
        const result = [dependency];
        reachCache.set(key, result);
        return result;
      }
    }
    reachCache.set(key, null);
    return null;
  };

  const paths: LlmOutboundPath[] = [];
  for (const [module, sinks] of sinksByModule) {
    const llmVia = resolveReach(module, new Set());
    if (!llmVia) continue;
    paths.push({
      module,
      llmVia,
      sinks,
      usesPlanner: (imports.get(module)?.internal ?? []).some((dependency) =>
        dependency.startsWith(PLANNER_MODULE),
      ),
    });
  }
  return paths.sort((left, right) => left.module.localeCompare(right.module));
}
