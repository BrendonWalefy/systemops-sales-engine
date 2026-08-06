import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");
const SITE_SOURCE = join(REPOSITORY_ROOT, "docs", "solution-site");
const DIAGRAM_SOURCE = join(
  REPOSITORY_ROOT,
  "docs",
  "architecture",
  "diagrams",
  "systemops-current-architecture.drawio",
);
const OUTPUT = join(REPOSITORY_ROOT, ".site-build");

const REQUIRED_SITE_FILES = [
  "index.html",
  "styles.css",
  "app.js",
  "assets/architecture-01.svg",
  "assets/architecture-02.svg",
  "assets/architecture-03.svg",
  "assets/architecture-04.svg",
];

for (const relativePath of REQUIRED_SITE_FILES) {
  const absolutePath = join(SITE_SOURCE, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Arquivo obrigatório ausente no site de arquitetura: ${relativePath}`);
  }
}

if (!existsSync(DIAGRAM_SOURCE)) {
  throw new Error("O arquivo Draw.io canônico não foi encontrado.");
}

rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(OUTPUT, { recursive: true });
cpSync(SITE_SOURCE, OUTPUT, { recursive: true });

const assetsDirectory = join(OUTPUT, "assets");
const downloadsDirectory = join(OUTPUT, "downloads");
mkdirSync(assetsDirectory, { recursive: true });
mkdirSync(downloadsDirectory, { recursive: true });

copyFileSync(
  join(REPOSITORY_ROOT, "public", "brand", "systemops-wordmark-text.png"),
  join(assetsDirectory, "systemops-wordmark-text.png"),
);
copyFileSync(
  join(REPOSITORY_ROOT, "public", "favicon.svg"),
  join(assetsDirectory, "favicon.svg"),
);
copyFileSync(
  DIAGRAM_SOURCE,
  join(downloadsDirectory, "systemops-current-architecture.drawio"),
);

writeFileSync(join(OUTPUT, ".nojekyll"), "", "utf8");

const outputFiles = readdirSync(OUTPUT, { recursive: true })
  .map(String)
  .filter((relativePath) => statSync(join(OUTPUT, relativePath)).isFile());

console.log(`Site de arquitetura gerado em ${OUTPUT}`);
console.log(`${outputFiles.length} arquivos prontos para publicação.`);
