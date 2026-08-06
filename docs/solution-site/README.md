# Site da arquitetura da solução

Site estático publicado pelo workflow
`.github/workflows/github-pages.yml`. A fonte não possui dependências de runtime,
não acessa banco e não contém dados de clínicas.

A leitura foi organizada para ser autoexplicativa: visão geral, fluxo principal,
diagramas, responsabilidades, stack, features e glossário. Cada diagrama mostra
uma perspectiva específica para evitar cruzamento excessivo de linhas.

## Gerar localmente

```bash
node scripts/build-solution-site.mjs
python3 -m http.server 4173 --directory .site-build
```

Depois abra `http://127.0.0.1:4173`.

## Atualizar os diagramas

```bash
node docs/architecture/diagrams/_gen_systemops_current_drawio.mjs
drawio --disable-update -x -f svg -p 1 -o docs/solution-site/assets/architecture-01.svg docs/architecture/diagrams/systemops-current-architecture.drawio
drawio --disable-update -x -f svg -p 2 -o docs/solution-site/assets/architecture-02.svg docs/architecture/diagrams/systemops-current-architecture.drawio
drawio --disable-update -x -f svg -p 3 -o docs/solution-site/assets/architecture-03.svg docs/architecture/diagrams/systemops-current-architecture.drawio
drawio --disable-update -x -f svg -p 4 -o docs/solution-site/assets/architecture-04.svg docs/architecture/diagrams/systemops-current-architecture.drawio
```

## Publicação e privacidade

O repositório é privado, mas um GitHub Pages criado em repositório privado de
conta pessoal é publicado na internet quando o plano oferece essa feature. O
site deve permanecer sanitizado e nunca incluir credenciais, prompts reais,
telefones, nomes de leads ou dados de clínicas.
