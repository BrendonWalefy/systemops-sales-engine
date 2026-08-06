# Portal da arquitetura

Site estático publicado em <https://brendonwalefy.github.io/systemops-sales-engine/> pelo workflow `.github/workflows/github-pages.yml`.

O portal apresenta visão geral, cinco diagramas, fluxo, stack, patterns, features, arquitetura alvo, gatilhos e custos. Não acessa banco e não possui dependências de runtime.

## Gerar localmente

```bash
node scripts/build-solution-site.mjs
python3 -m http.server 4173 --directory .site-build
```

Abra `http://127.0.0.1:4173`.

## Atualizar diagramas

Consulte [diagramas/README.md](../architecture/diagrams/README.md). O build exige os cinco SVGs e copia o `.drawio` canônico para download.

## Privacidade

O repositório e o Pages são públicos. Nunca inclua credenciais, prompts reais, conversas, telefones, nomes, snapshots, mídia ou qualquer dado de cliente. Estimativas publicadas devem usar apenas premissas genéricas.
