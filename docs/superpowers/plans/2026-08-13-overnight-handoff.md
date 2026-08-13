# Handoff da sessão de 13/08/2026

Escrito ao fim de uma sessão longa, para você retomar sem reconstruir contexto.

## 1. O que foi para produção

| PR | Conteúdo | Estado |
| --- | --- | --- |
| #262 | fix de mídia no preço: mídia de passo de pipeline sai do fallback | **em produção** |
| #263 | eval harness de intenção + baseline medida | **em produção** |
| #264 | doc da ideia de Modo Campanha | **em produção** |
| #265 | flag de capacidade de modelo + tabela de preços + relatório de 8 modelos | **em produção** |

E a troca que mais muda resultado: **`OPENAI_CLASSIFIER_MODEL=gpt-5.4-mini` está setado em Production e ativo** (deploy `5881702564`, depois `a0f1b9e`). Antes disso a variável não existia e o classificador rodava o default `gpt-4o-mini` de 2024.

Efeito medido: estrato A de 73,0% para **95,2%**, falha crítica de 2,0 por rodada para **zero**, falha alta de 3,0 para **zero**, amplitude de 4,8 pp para **0 pp**, latência de 1.672 ms para 1.157 ms. Custo: **+R$ 4,40 por clínica/mês**.

**Preview não recebeu a variável** — a CLI insistiu em confirmação interativa. Se quiser paridade preview/produção, setar `OPENAI_CLASSIFIER_MODEL=gpt-5.4-mini` no painel.

## 2. Mergeado depois, e o que o dry-run revelou

**#266** (specs + escala por dia, migração `0098`) e **#267** (conserto de privacidade do sanitizador) foram mergeados com CI verde; deploy de produção `success` em `5fd59bc`. **#256** mirava `develop` — que está 31 commits atrás da `main` e 0 à frente — foi retargetado para `main`, testado com `npm run verify` sobre o resultado do merge, e mergeado.

**Dois PRs continuam travados, com o motivo comentado no próprio PR:**

- **#232** adiciona `drizzle/0083_soft_silver_surfer.sql`, mas a `main` já tem `0083_magenta_red_shift.sql` — número de migração duplicado. Precisa rebasear e regerar como `0099`.
- **#257** mira `develop` e está `DIRTY` com 100 arquivos em conflito, 68 em `src/`. Precisa decidir se ainda tem escopo depois do `3115cef`.

### O defeito que o dry-run do backfill expôs

`npm run db:backfill-schedule -- --dry-run` mostrou 7 organizações a preencher, e uma delas está **errada em produção agora**:

```
NC Beauty & Clinic
  texto:  "Terça a sexta das 13h às 19h. Sábado das 10h às 17h."
  escala:  Seg 13:00-19:00 | Ter | Qua | Qui | Sex | Sáb 10:00-17:00
            ^^^^ a clínica não abre segunda
```

O parser não entende "Terça a sexta": ele só detecta sábado e cai no default `[Seg..Sex]`. **O sistema oferece segunda-feira para uma clínica que não abre segunda.** O backfill reproduz isso fielmente por desenho — preservar o comportamento atual é o gate da unidade 2. Corrigir vem depois de gravado, e só agora é possível expressar a correção.

**Pendente de decisão sua:** confirmar as 7 escalas contra a realidade antes de gravar. Ximendes e Vitalli parecem plausíveis, mas plausível não é verificado.

## 3. Pendências, com o motivo de cada uma

### 3.1 Bloqueadas por decisão sua, não por trabalho

**Spec 1 — crescer o corpus rotulado.** Precisa de duas variáveis que não existem: `REPLAY_EXPORT_ALLOWED_CLINICS` e `REPLAY_EXPORT_HASH_KEY` (mínimo 32 caracteres). Eu **não setei de propósito**: elas decidem quais dados de paciente real podem sair do banco, o repositório é público, e essa autorização é sua. Depois disso, a etapa de revisão de rótulo também é sua por desenho — todos os discordantes mais 20% dos concordantes.

**Spec 2 — judge de prosa.** Mesmos gates, mais um keypair de aprovação e um dataset de replay aprovado. `replay-datasets/` é gitignored por conter PII e não existe localmente.

### 3.2 Bloqueada por dependência técnica

**Spec 3 — auditoria por decisão.** A metade classificador é executável hoje. A metade composer espera a Spec 2, porque sem judge não há como validar mudança em prosa — e retirar regra sem medição é exatamente o mecanismo que criou o problema.

Ressalva que muda o objetivo: com `gpt-5.4-mini` acertando 20 de 21, **sobrou um caso de margem**. O harness detecta regressão e não detecta melhoria. Por isso a auditoria foi escrita com objetivo de **custo e latência**, com acurácia como trava — não como promessa de ganho. Cortar as ~50 linhas duplicadas deve remover cerca de 700 dos 2.030 tokens de toda chamada.

### 3.3 Faltando trabalho, sem bloqueio

**Escala por dia, unidade 3 (metade orquestrador).** `detectWeekdayQuestion` e `describeWeekdayHours` estão implementados e testados. Falta ligar em `buildBusinessHoursAnswer` para responder qualquer dia com o horário daquele dia, e substituir `isSaturdayQuestionForOperatingClinic`. Hoje pergunta sobre segunda cai no genérico `Nosso horário de atendimento é: ...`.

**Escala por dia, unidade 4.** Editor por dia no painel do owner: `owner/clinics/[clinicId]`, `owner/clinics/new`, `owner/onboarding/[clinicId]`.

**Gate do eval no CI.** Precisa de `OPENAI_API_KEY` como secret e dos dois ajustes que a variância indicou: mesmo `--repeat` da baseline, e tolerância de uma ocorrência por rodada. Comparar 1 rodada contra baseline de 3 reprova por ruído — eu vi isso acontecer.

**Duas worktrees de peso morto.** `systemops-sales-engine-intent-eval` e `-media-fix`, cada uma com `node_modules` completo. O trabalho das duas já aterrissou. Removo quando você pedir; não removo workspace sem pedido.

**`stash@{0}`** guarda as modificações redundantes da limpeza, caso queira conferir antes de descartar.

## 4. Achados que valem mais que o código entregue

**Os cinco donos duplicados.** Ambiguidade entre variações, manutenção fora de catálogo, identificação de tratamento, chegada do paciente e pergunta de horário têm guard determinístico **e** regra no prompt pedindo o mesmo do modelo. Detalhe no §8 do relatório de comparação e no §2 da spec da auditoria.

**A pergunta do usuário que valeu mais que a minha medição.** Meu experimento de interferência de tarefa **falhou** em justificar separar o classificador — o efeito ficou dentro do ruído. O que justificou foi a observação de que `"quanto custa manutenção?"` é semanticamente uma pergunta de preço, e o `needs_human` descreve o que o *sistema* deve fazer, não o que o lead quis dizer. A taxonomia mistura as duas coisas. O desenho correto é `intent: price_inquiry` mais `catalogueMatch: none`, roteando determinístico.

**Fronteira perde de modelo pequeno.** `gpt-5.6-sol` a R$ 49,24/mês faz 83,3%; `gpt-5.4-mini` a R$ 8,30 faz 95,2%. Classificação sob schema estrito premia seguir instrução, não raciocinar em aberto.

**Cache de prompt é o que torna o tier barato viável.** O prompt de 2.030 tokens atinge 87 a 94% de cache, e a tarifa de cached input dos modelos novos é 3,75 vezes melhor que a do antigo. O cache esquenta na primeira ou segunda chamada — a primeira medição deu zero e isso era cache frio, não ausência de cache.

**Langfuse: não agora.** Vercel é impossível — exige dois processos longos e ClickHouse, e a doc diz explicitamente que é incompatível com serverless. Cloud free serve (50k unidades/mês) mas depende de guardar conversa de paciente em texto, o que `decision_traces` recusa por design. E não resolve a dor descrita, que é análise estática. Reavaliar na Fase 7.

## 5. Erros meus nesta sessão, para o registro

- Estimei "~90 casos" de dataset; o real era 21. Contei blocos `it(` em arquivos que testam várias funções.
- Afirmei que nenhum modelo classe 5.6 resolve manutenção fora de catálogo. `gpt-5.4-mini` resolve. Minha conclusão veio de uma chamada avulsa com enum reduzido, não do prompt real.
- Disse que a `main` local estava sincronizada quando eu estava lendo o log de uma branch de feature. A `main` ficou 1 commit atrás e a branch das specs nasceu na base errada; corrigido recriando a branch.
- Commitei uma vez com `verify` falhando antes de olhar o motivo. Era o snapshot do drizzle precisando de canonicalização; refeito com `--amend` depois de corrigir.
- Planejei um teste de corrupção do gate que não teria reprovado, porque o par resultante cai em severidade média.
- Escrevi um detector de dia da semana que lia "queria **ter** um horário" como terça-feira. O próprio teste pegou.
