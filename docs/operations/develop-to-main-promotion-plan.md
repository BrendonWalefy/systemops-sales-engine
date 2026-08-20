# Plano de promoção `develop` → `main`

**Status: NÃO EXECUTADO.** Este documento existe para ser lido antes de promover,
não para ser executado por um agente sozinho. A promoção exige um humano com o
`systemops-lab-runbook.md` aberto, em uma janela reservada.

Escrito em 2026-08-20, ao fim da sessão de housekeeping.

## Por que isto não é um merge comum

Promover `develop` para `main` dispara deploy de produção. O deploy troca o
commit implantado. A approval do Internal Lab é assinada **contra o commit
exato** — `claims.commitSha` conferido contra `deploymentIdentity.commit`. Um
commit novo invalida a approval.

E a falha não aparece como erro. Runbook, seção 21-A:

> É silencioso: nenhum erro aparece, apenas o Lab para de responder.

Como o Lab tem `operationalStatus=test`, a automação só é concedida pela exceção
que a approval sustenta. Sem approval válida, o turno simplesmente não vira
resposta e o trace registra `engine.selected` com
`reason: "automation_not_live"`.

Portanto: **quem promove precisa reassinar na mesma janela.** Promover e sair
deixa o Lab mudo.

## Estado no momento em que este plano foi escrito

| | |
|---|---|
| `main` HEAD | `0d0015cfef0c0a13db92e4211b5f72739137133f` |
| `develop` HEAD | `2fd5591b68e8385f7550dbcd04145f7e2e381999` |
| Divergência `main...develop` | **0 / 24** — `main` não tem nada que `develop` não tenha |

Confirme os HEADs antes de usar este plano; ele envelhece a cada merge em
`develop`.

### PRs incluídas na promoção

| PR | O que entra | Toca runtime? |
|---|---|---|
| #290 | verbalização V2 — o modelo escreve as palavras que o plano já autorizou | **sim** |
| #291 | valor autorizado inteiro, não dígitos soltos; oferta pergunta qual | **sim** |
| #292 | Lab para de apagar os dois campos que o modelo precisa; descrição no settings | **sim** |
| #293 | serviço ambíguo vira escolha real; medição dos dois turnos mudos | **sim** |
| #294 | developer onboarding (docs, Makefile, scripts, `.vscode`) | **não** |
| #295 | registro do housekeeping, este plano, triagem de branches, inventário pré-Harness | **não** |
| #296 | duas correções de precisão em documentação | **não** |

As quatro primeiras são o núcleo de verbalização da V2: 53 arquivos,
+2846/−93, incluindo `authorized-surface.ts`, `verbalization-validator.ts`,
`live-response-verbalizer.ts` e a explanation capability do domain pack
odontológico. **É mudança de comportamento conversacional real**, ainda que
restrita ao Lab pela ativação por tenant.

## Ordem de execução

Pré-requisitos, todos obrigatórios:

- árvore local limpa, no commit exato que será implantado;
- chaves da authority Internal Lab disponíveis **fora do repositório**;
- `OPENAI_API_KEY` disponível apenas no shell local protegido;
- acesso de owner à plataforma para variáveis protegidas.

1. **Merge `develop` → `main`** pelo fluxo normal de PR.
2. **Seção 16 — deploy do build aprovado com todos os tenants em V1.**
   O deploy vem **antes** da approval, porque a approval precisa citar o commit
   efetivamente implantado. Confirme que `VERCEL_GIT_COMMIT_SHA` é igual ao
   commit promovido. Nenhum tenant muda de engine aqui.
3. **Seção 18 — recapturar os bindings sobre o estado final.**
   Repete o `--verify` da seção 10 para que o artifact resolvido reflita a linha
   definitiva: `tenantDigest`, `channelDigest`, `configDigest`.
4. **Seção 19 — medição final do Cycle I sobre os bytes implantados.**
   Exigida porque o commit é novo. O resultado **correto** é gate report com
   decisão `NO_GO` e critério qualitativo em `not_measurable` /
   `pending_human_review`. Isso não é falha: os dois reviewers humanos
   calibrados não existem, e nenhuma authority local promove esse estado para
   `PASS`.
5. **Seção 20 — emitir `INTERNAL_LAB_SMOKE_AUTHORIZED`.**
   O shell precisa exportar `VERCEL_GIT_COMMIT_SHA` com o **SHA completo de 40
   caracteres**. Não use `GIT_COMMIT_SHA`, e não defina as duas com valores
   diferentes — é recusado. SHA abreviado assina na 20 e **falha na 21**. A
   private key entra somente por `--private-key-file`, nunca no ambiente.
6. **Seção 21 — publicar as variáveis protegidas e verificar o readiness
   `smoke`.** Republicar `CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON` e os
   digests. `SYSTEMOPS_LAB_CLINIC_ID` é obrigatória e não tem substituto: sem
   ela o router recusa o Lab silenciosamente, mantendo V1 e sem emitir reason
   code novo. Em seguida, **redeploy PLATFORM do mesmo commit** para o runtime
   ler as variáveis.
7. **Seção 22 — smoke pelo número real do owner.**

Um redeploy do **mesmo** commit não exige reassinatura. Só a troca de commit
invalida.

## Como detectar o failure mode silencioso

O sintoma é ausência de resposta, não erro. Ordem de investigação:

1. Compare `claims.commitSha` com o commit efetivamente implantado. Se
   divergirem, é isto — antes de qualquer outra hipótese.
2. No Decision Trace, procure `engine.selected` com
   `reason: "automation_not_live"`.
3. Confirme que `SYSTEMOPS_LAB_CLINIC_ID` está publicada. Ausente, o router
   recusa em silêncio sem reason code novo.

## Rollback

O sistema é **fail-closed para V1**. Se qualquer verificação falhar, o caminho
seguro é permanecer/voltar a V1 — o que já é o comportamento automático quando a
approval não valida. Não force nada.

Condições que exigem voltar a V1, do runbook:

- commit implantado diverge do commit promovido (seção 16);
- o `--verify` recusa organização, agenda, horário, endereço, profissional,
  treatments/preços ou playbook (seção 18);
- o gate report não pode ser gerado sobre os bytes implantados, **ou alguém
  tenta reinterpretar `NO_GO` como aprovação** (seção 19);
- qualquer commit novo entra depois da medição — invalida as attestations e
  obriga a repetir 19 e 20.

Há ainda a seção 599 do runbook, "Rollback to a safe detached state", e a prova
de rollback `V2 → V1 → V2` na seção 23.

## Verificação pós-deploy

- readiness `smoke` verde na seção 21;
- smoke pelo número real do owner (seção 22);
- prova de rollback `V2 → V1 → V2` (seção 23);
- personas sintéticas, evidence e Inbox (seção 24);
- só então `INTERNAL_LAB_READY` (seção 25).

## O que este plano deliberadamente não faz

Não executa nada. Não promove, não faz deploy, não assina, não publica variável,
não toca `conversation_engine`. A decisão e a execução são humanas.
