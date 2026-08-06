# Diagramas de arquitetura

O arquivo canônico [systemops-current-architecture.drawio](systemops-current-architecture.drawio) possui cinco abas:

1. arquitetura técnica e integrações internas/externas;
2. microintegrações da conversa, LLMs e pipeline;
3. features, fontes de dados e funil da Home;
4. campanhas, ofertas e automações;
5. arquitetura alvo, gatilhos de escala e sequência de evolução.

Cada aba usa um recorte específico para evitar cruzamento excessivo de linhas. O arquivo é XML não comprimido, editável no [diagrams.net](https://app.diagrams.net/) e versionável no Git.

## Regenerar

```bash
node docs/architecture/diagrams/_gen_systemops_current_drawio.mjs

drawio --disable-update -x -f svg -p 1 \
  -o docs/solution-site/assets/architecture-01.svg \
  docs/architecture/diagrams/systemops-current-architecture.drawio

drawio --disable-update -x -f svg -p 2 \
  -o docs/solution-site/assets/architecture-02.svg \
  docs/architecture/diagrams/systemops-current-architecture.drawio

drawio --disable-update -x -f svg -p 3 \
  -o docs/solution-site/assets/architecture-03.svg \
  docs/architecture/diagrams/systemops-current-architecture.drawio

drawio --disable-update -x -f svg -p 4 \
  -o docs/solution-site/assets/architecture-04.svg \
  docs/architecture/diagrams/systemops-current-architecture.drawio

drawio --disable-update -x -f svg -p 5 \
  -o docs/solution-site/assets/architecture-05.svg \
  docs/architecture/diagrams/systemops-current-architecture.drawio
```

O mesmo Draw.io é copiado para download no [portal da arquitetura](https://brendonwalefy.github.io/systemops-sales-engine/).

## Regra de atualização

Mudança estrutural em componentes, integrações, fila, fontes da Home ou campanhas atualiza no mesmo PR:

- `docs/architecture/current.md`;
- o gerador e o `.drawio`;
- os SVGs do portal;
- a seção correspondente do GitHub Pages.
