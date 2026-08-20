# Housekeeping do repositório — 2026-08-20

Sessão exclusiva de organização. Nenhuma mudança de comportamento, nenhum
deploy, nenhuma alteração em `main`, nenhum force-push, nenhuma linha de código
de produto escrita.

O objetivo era simples de enunciar e caro de garantir: **nenhum trabalho
importante podia continuar existindo só no disco local**. Ao entrar na sessão,
dois blocos de trabalho estavam nessa situação e um terceiro estava dentro de um
`detached HEAD`.

## Resumo do que mudou

| | Antes | Depois |
|---|---|---|
| Worktrees | 14 (2 órfãs em `/private/tmp`) | 3 |
| Branches locais | 57 | 24 |
| Commits que não existiam em nenhum remoto | 17 | 2 (ver nota) |
| Arquivos WIP soltos, em 3 worktrees | 17 | 0 |
| `develop` | presa por uma worktree 368 commits atrás | livre e sincronizada |

Os 17 arquivos soltos eram 12 na worktree primária (3 modificados + 9 novos), 4
modificados na `objectivity` e 1 não versionado na `replay-vitalli`.

**A nota dos 2 commits:** são os de `docs/systemops-rebuild-design`, mantidos
locais de propósito. A seção 7 prova que o conteúdo deles já está na `develop`
numa versão mais nova — não é trabalho em risco, é uma ref duplicada. Estão no
bundle. Todo o resto foi para o remoto.

---

## 1. Backup

Feito **antes** de qualquer operação destrutiva.

```
~/Dev/Projetos/_systemops-archive/systemops-pre-housekeeping-20260820-1350.bundle
```

- `git bundle create --all` — 43 MB, inclui todas as branches locais, todas as
  refs de `origin` e os `HEAD` de todas as 14 worktrees (inclusive o detached).
- `git bundle verify` → **"The bundle records a complete history."**

Bundle não captura arquivo não versionado, então o WIP solto foi arquivado à
parte, em `~/Dev/Projetos/_systemops-archive/systemops-uncommitted-20260820-1350/`:

| Arquivo | Conteúdo |
|---|---|
| `primary-tracked.patch` | diff de `.gitignore`, `README.md`, `package.json` |
| `primary-untracked.tar.gz` | os 8 arquivos de onboarding + os 3 testes rascunho |
| `objectivity-tracked.patch` | 524 linhas do WIP de objetividade |
| `replay-last-leads-shadow.ts` | o script de replay do detached HEAD |
| `worktree-local-files/` | 132 arquivos: `.superpowers/sdd/` de 5 worktrees + o `.env.local` da worktree `intent-eval` |

Os `.env.local` foram **copiados para o arquivo, nunca versionados**.

---

## 2. Estado do Git ao final

- `main` = `0d0015cfef0c0a13db92e4211b5f72739137133f` — **não foi tocada**
- `develop` = `d5ca7bd26428cae5f0973e0a72d2e0d45639d7a4`
- Divergência: `main...develop` = **0 / 16**. `develop` está 16 commits à frente,
  `main` não tem nada que `develop` não tenha. É um fast-forward limpo quando a
  promoção for decidida.

As refs locais `main` e `develop` foram atualizadas por fast-forward para
acompanhar o remoto (`git fetch origin main:main develop:develop`, que recusa
qualquer coisa que não seja fast-forward). Isso move ponteiros locais e **não
empurra nada**.

### Worktrees mantidas

| Caminho | Branch | Por quê |
|---|---|---|
| `systemops-sales-engine` | `docs/repository-housekeeping-2026-08-20` | worktree canônica |
| `systemops-sales-engine-template` | `feat/dental-resin-template` | trabalho de feature ativo e recente |
| `systemops-sales-engine-v2` | `feat/v2-llm-verbalization` | programa V2 em andamento |

Todas as três com working tree limpa.

---

## 3. Dental template — a prioridade

**Situação inicial:** `feat/dental-resin-template`, 15 commits que não existiam
em nenhum remoto. Era o item de maior risco da sessão: uma perda de disco
apagaria o trabalho inteiro.

Auditoria antes do push:

- working tree limpa;
- base correta — `ad1760f3`, um merge commit real na linhagem de `main` (PR #261);
- diff puramente aditivo: 11 arquivos novos, 2404 inserções, **zero deleções**;
- varredura de segredos (chaves, tokens, PEM, URLs de banco, AWS/GitHub) → nada;
- varredura de PII (telefone, e-mail, CPF) → nada;
- varredura de nomes de clínicas reais (Ximendes, Vitalli, NC Beauty, nomes de
  pessoas) → nada. O manifesto é genérico, como deveria ser.

**Ação:** `git push -u origin feat/dental-resin-template`. Sem merge, sem
rebase, sem force.

**Resultado:** `origin/feat/dental-resin-template` = `ac57da7c`. Os 15 commits
deixaram de existir apenas no disco.

---

## 4. Developer onboarding → PR #294

O WIP da worktree primária tinha **duas intenções misturadas**, e elas foram
separadas.

### O que virou PR

Branch `chore/developer-onboarding`, baseada na `develop` atual, commit
`63d68052`, **PR #294 → `develop` (não mergeada)**.

`DEVELOPER.md`, `Makefile`, `scripts/dev-setup.sh`, `scripts/validate-env.sh`,
`.vscode/launch.json`, `.vscode/tasks.json`, `dev:inspect` no `package.json` e
uma seção curta no `README.md`. Nada disso é importado pela aplicação — é
tooling puro, sem efeito em runtime.

Ajustes feitos sobre o WIP original, todos documentados no commit:

- **Descartado o hunk do `.gitignore`.** Ele adicionava `.env.local`,
  `.env.prod.local` e `.env.dev.local`. A linha 7 do arquivo já é `.env*` e a 8 é
  `!.env.example`. Os três eram redundantes.
- **Encolhida a seção do `README`.** O bloco original repetia o quickstart de
  install/env/migrate/workers/verify que a `develop` já tem. Sobrou só o que é
  novo: os dois atalhos e o debug do VS Code.
- **Removida uma linha de voz de assistente** no fim do `DEVELOPER.md` ("Se
  precisar, eu posso gerar um checklist...") e um espaço perdido em
  `` ` .env.test.local` ``.

Verificação:

- todos os scripts citados na documentação foram conferidos contra o
  `package.json` da `develop` — `dev`, `dev:workers`, `db:migrate`, `verify`,
  `verify:agenda`, `test:db`, `db:generate` existem;
- os dois shell scripts foram executados sob bash 5.3 **e** sob o bash 3.2 de
  fábrica do macOS, contra um `.env` válido e outro sem variável obrigatória
  (exit 0 / exit 3);
- `npm run lint` limpo, `npm run typecheck` exit 0, `npm run db:check` OK;
- `npm test` → **399/399 arquivos, 3589 testes passando, 11 skipped, 0 falhas**.

> **Armadilha registrada para quem for revisar:** a suíte exige árvore git
> limpa (`Cycle I productive measurement requires a clean repository tree`).
> Rodar `npm test` com esses arquivos staged mas não commitados produz 32
> falhas que **não têm nada a ver com o conteúdo**. Commit primeiro, teste
> depois.

### O que não virou PR

Três arquivos de teste soltos — `InternalLabAutomationPolicy.test.ts`,
`TenantEngineRouter.test.ts` e `test-support/registered-internal-lab-approval.ts`
— **não** são tooling de onboarding e **não** são trabalho novo. São uma
iteração anterior de testes que já foram entregues. Prova:

- os rascunhos são de 2026-08-17, 14:24–14:26. As versões que entraram na
  `develop` foram commitadas na mesma tarde, 4 a 5 horas depois: `5d3ab576`
  (18:55) e `6b8da8b1` (19:55);
- eles importam `@/__tests__/test-support/registered-internal-lab-approval`, um
  helper que não existe na `develop` — lá ele foi substituído por
  `@/__tests__/helpers/internal-lab-approval-fixture`;
- a suíte `TenantEngineRouter` da `develop` é estritamente mais ampla: 7 casos
  contra 5, cobrindo drift da approval, provider de understanding indisponível
  e os dois casos de registro de shadow;
- o resto das preocupações do rascunho está coberto nos 11 arquivos da suíte de
  Lab da `develop` (`ClinicAutomationPolicy`, `ConversationV2BidirectionalRollback`,
  `arch/TenantEngineRouterBoundary`);
- eles nem rodam a partir daquela árvore: `tenant-engine-router` e
  `ports/conversation-handler` ainda não existiam nela.

Mesmo com a prova, **não foram apagados**. Estão preservados em
`wip/internal-lab-tests-draft-checkpoint` (`0ed6f486`, no remoto) e no tarball
do arquivo.

---

## 5. Objectivity — preservado, não retomado

O WIP de 2026-07-18 (4 arquivos, 524 linhas) foi commitado como checkpoint em
**`wip/conversation-objectivity-checkpoint`** (`0085c431`, no remoto), sobre a
base original. **Nada foi mergeado na V1.**

O que o experimento faz:

- troca o texto de prompt de "vender o valor" por um **orçamento de
  objetividade** — resposta de preço limitada a ~3 frases curtas, dúvida geral a
  2 parágrafos curtos;
- proíbe a LLM de emitir `[MEDIA:id]` por conta própria — mídia passa a ser
  decisão determinística do pipeline;
- `slotsWillFollow` em `price_inquiry`: quando horários reais já vão ser
  anexados depois da resposta, o composer para de perguntar "posso ver os
  horários?", que estava gerando oferta duplicada;
- `deliverOnFirstContact` em steps de conteúdo (+ checkbox no editor de
  pipeline): escape hatch opt-in para cards autoexplicativos.

**Avaliação.** O diff está escrito contra o composer pré-V2. A V2 já moveu a
verbalização para `ConversationStateMachine` e `conversation-response-parts`,
então as edições de string de prompt estão superadas por construção. Não tente
rebasear isso na `main` atual.

Mas duas ideias **não existem em lugar nenhum da `develop`** — conferido:
`slotsWillFollow` e `deliverOnFirstContact` retornam zero arquivos.

**Recomendação: reavaliar depois da V2**, tratando essas duas como requisitos a
reexpressar em termos de V2, não como código a mergear.

---

## 6. Replay Vitalli — era o achado mais silencioso

`scripts/replay-last-leads-shadow.ts`, 332 linhas, **nunca foi commitado em
lugar nenhum**. Era um arquivo não versionado dentro de uma worktree em
`detached HEAD` — existia em exatamente um lugar no mundo.

Auditoria: é read-only de verdade. A única ocorrência de `.set(` é um
`Map.set` de JavaScript; nenhuma escrita no banco, nenhum envio de WhatsApp,
nenhuma chamada de rede, nenhum segredo. O único dado embutido é um slug de
clínica como valor padrão de argumento.

Todos os 12 imports e os símbolos nomeados (`coerceBusinessIntent`,
`resolveComposerModel`, `buildDemoSlots`) ainda resolvem contra a `main` atual,
então ele foi preservado sobre a `main` atual, não sobre o commit de julho.

**Ação:** branch `chore/preserve-replay-last-leads-shadow` (`0140dc66`, no
remoto). Não foi executado — é checkpoint, não validação.

O programa de replay migrou para o ferramental de corpus sanitizado/aprovado
(`scripts/*-replay-*.ts`), que continua sendo o caminho preferido.

---

## 7. Rebuild spec — categoria C, superado

`docs/systemops-rebuild-design`, 2 commits (`4c0b9299`, `f6ef600e`), nunca
mergeados. Análise semântica contra a `develop`:

- `2026-08-09-systemops-lab-performance-baseline.md` → blob **idêntico**
  (`694ee5f2`) ao que está na `develop`;
- `2026-08-09-systemops-rebuild-design.md` → difere em 2 linhas, e a versão da
  `develop` é a **mais nova**: o status subiu de "aguardando revisão do usuário"
  para "aprovado pelo usuário em 2026-08-09", e a seção 24 foi atualizada para
  registrar que as Fases 0 e 1 entraram pela PR #258.

A branch local carrega o rascunho **anterior**. Zero conhecimento não
representado → **categoria C**. Nada foi promovido para a `develop`.

Worktree removida. **A branch local foi mantida** (os 2 commits seguem
alcançáveis, e estão no bundle) — a instrução autorizava remover a worktree, não
a branch.

---

## 8. Worktrees removidas

Todas revalidadas programaticamente imediatamente antes da remoção: working
tree limpa **e** zero commits fora dos remotos.

| Worktree | Prova |
|---|---|
| `conversation-reliability` | ancestral de `origin/main` **e** `origin/develop`, 0 commits exclusivos |
| `incremental-read` | idem |
| `intent-eval` | idem |
| `lab-performance` | idem |
| `media-fix` | idem |
| `architecture-round-2` | idem — segurava `develop` 368 commits atrás |
| `rebuild-spec` | categoria C, ver seção 7 |
| `replay-vitalli` | script preservado antes, ver seção 6 |
| `objectivity` | WIP preservado antes, ver seção 5 |

Depois: `git worktree prune` removeu as duas entradas órfãs que apontavam para
`/private/tmp/systemops-current-docs` e `/private/tmp/systemops-v2-prod.ymONRP`
— ambos os diretórios já não existiam no disco.

**`develop` está livre.** Nenhuma worktree a segura.

---

## 9. Branches locais

**38 removidas.** Critério aplicado a todas: sem worktree associada, ancestral
de `origin/main` **e** de `origin/develop`, zero commits fora dos remotos, não é
branch de preservação. Removidas com `git branch -d` (não `-D`), para que o
próprio git recusasse qualquer coisa não mergeada.

Uma exceção precisou de análise: `feat/classifier-model-capability-flag` foi
recusada pelo `-d` porque a ref local estava à frente do **seu próprio** remote
branch. Investigado: a ref local tinha sido fast-forwardada para o merge commit
da própria PR #265, que já está na `origin/main`; só o remote branch da feature
ficou parado no tip pré-merge. Zero commits fora dos remotos. Removida com `-D`
depois da prova.

**Mantidas (24).** As canônicas `main` e `develop`; as 4 branches de
preservação/PR criadas nesta sessão; `backup/link-preview-wip` (é branch de
preservação por definição); `docs/systemops-rebuild-design` (ver seção 7); e as
branches com remoto que **não** estão mergeadas — trabalho possivelmente ainda
desejado, que a regra não autoriza apagar.

### Branches remotas — candidatas para uma decisão futura

**Nenhuma branch remota foi apagada nesta sessão**, conforme instruído. Para a
sessão que for fazer essa limpeza:

- **90 branches remotas** são ancestrais de `origin/main` — mergeadas, candidatas
  seguras;
- **34 não estão mergeadas** e precisam de decisão individual.

De um total de 125 branches remotas. Vale conferir a lista das 34 uma a uma
antes de qualquer `git push --delete`: várias parecem trabalho real que nunca
foi promovido.

---

## 10. `main` / `develop` — promoção deliberadamente NÃO feita

`develop` está 16 commits à frente de `main`. São as PRs **#290 a #293**, o
trabalho de verbalização da V2: 53 arquivos, +2846/−93. Entre eles
`authorized-surface.ts`, `verbalization-validator.ts`,
`live-response-verbalizer.ts` e a explanation capability do domain pack
odontológico.

**Isso não foi promovido, e não deve ser promovido por impulso.** A razão está
escrita na seção 21-A do `docs/operations/systemops-lab-runbook.md`:

> A approval é vinculada ao commit exato (`claims.commitSha` contra
> `deploymentIdentity.commit`). Um deploy novo muda o commit e a approval deixa
> de valer.

E o modo de falha é o pior tipo:

> É silencioso: nenhum erro aparece, apenas o Lab para de responder.

Promover `develop` → `main` dispara deploy, o deploy invalida a approval, e o
Lab para de responder sem emitir erro. Para promover é preciso, **na mesma
janela**, refazer o runbook: **seções 18, 20 e 21** (recapturar bindings,
reassinar com o novo `commitSha`/`treeSha`/`sourceDigest`, republicar
`CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON`). A seção 13 acrescenta a **19**
quando o commit é novo. A seção 16 cobre o deploy em si, com todos os tenants
em V1.

É decisão humana, com o runbook aberto e tempo reservado.

---

## 11. O que deliberadamente não foi tocado

- `main` — nenhum commit, nenhum push, nenhum merge;
- `conversation_engine` e a ativação da V2;
- a approval do Lab e suas variáveis protegidas;
- qualquer branch remota (nenhuma apagada);
- os WIPs comportamentais — preservados em branch, nunca mergeados;
- Harness, Authorized Knowledge, `nextBestStep`, modelos: nenhum trabalho novo
  iniciado.

---

## 12. Riscos restantes

1. **A promoção pendente continua pendente.** Quanto mais `develop` avança, maior
   a janela de promoção. O risco não é o código — é a coreografia do runbook.
2. **34 branches remotas não mergeadas** ainda não foram triadas. Não é risco de
   perda (estão no remoto), é ruído.
3. **`wip/conversation-objectivity-checkpoint` não passa validação** e está
   marcado como tal. É checkpoint incompleto por decisão, não por descuido.
4. **`.env.local` da worktree `intent-eval`** está agora em
   `_systemops-archive/`, em disco não versionado. Se aquela worktree tinha
   credenciais reais, o arquivo continua sendo material sensível — apagar quando
   não for mais útil.
5. **O arquivo local é disco local.** O bundle e os patches protegem contra erro
   de git, não contra perda de disco. Todo o *código* relevante está no remoto;
   o que só existe no arquivo é WIP não versionado e os `.superpowers/sdd/`.

---

## 13. Próximo passo recomendado

1. Revisar e mergear a **PR #294** — é isolada, verde e sem efeito em runtime.
2. Decidir a promoção `develop` → `main` como tarefa própria, com o runbook
   aberto e as seções 18/19/20/21 planejadas na mesma janela. Não encaixar no
   fim de outra sessão.
3. Só então iniciar o Harness, a partir de uma `develop` limpa.
4. Em algum momento, triar as 34 branches remotas não mergeadas.
