# Auditoria de Configuração — Um Fato, Um Dono

Criado em 2026-07-04.

Companion operacional de [`sources-of-truth.md`](./sources-of-truth.md). Aquele doc
diz **qual tabela** é dona de **qual categoria**. Este doc vai uma camada mais fundo:
onde o **mesmo fato** está escrito em **mais de um campo** hoje (o risco real de erro),
e a **fórmula** para novos estabelecimentos preencherem config com o mínimo de chance
de errar — sem travar features e deixando espaço para personalização.

> Motivação: com uma clínica só (Ximendes) já apareceram 3 respostas erradas em
> produção rastreadas até config duplicada/no lugar errado (preço na descrição,
> raio-x inexistente, procedimento fantasma). Isso não escala. O erro de dado é
> **sintoma de sobreposição de campos**, não descuido de quem preenche.

---

## 1. A regra e o teste

Da `sources-of-truth.md`: **se você precisa mudar uma regra em mais de um lugar, a
arquitetura está errada.**

O teste para decidir "uma fonte ou duas" **não é** "os valores são iguais hoje?" —
é: **eles mudam pelo mesmo motivo?**

- **Mesmo motivo pra mudar** → é *um fato* em dois lugares = redundância = bug esperando.
  Colapsa para um; se dois formatos são necessários (número vs. prosa), **um deriva do
  outro**, nunca os dois digitados à mão.
- **Motivos diferentes** → são *dois fatos* que por acaso coincidem hoje. Mantém dois,
  mas **nomeia diferente** para ninguém achar que editar um atualiza o outro.

Exemplo já resolvido: `treatments.priceCents` (preço de lista, âncora) e
`appointments.valueCents` (valor realizado, com desconto) parecem iguais, mas mudam por
motivos diferentes — o desconto do dia mexe em um, não no outro. São dois fatos legítimos.
Já o "a partir de R$X" digitado dentro de `commercialPolicy` **é o mesmo fato** que
`priceCents` → deve derivar, não ser redigitado.

---

## 2. O modelo de 3 camadas (a fórmula)

Todo campo de config cai em uma de três camadas. A camada decide **onde vive** e
**como é editado**.

### Camada 1 — Fato estruturado (o átomo)
Campo tipado, um dono, legível por máquina. Preço, duração, horário, buffer, timezone,
`requiresEvaluationFirst`, enums. **É o único lugar onde um humano digita o fato.**
Tudo mais deriva daqui.

### Camada 2 — Prosa derivada (o que a IA verbaliza)
**Nunca** digitada à mão com fatos embutidos. Composta a partir da Camada 1 por funções
tipo `composePlaybookText`. A frase de preço da `commercialPolicy`, a descrição do
procedimento entregue à IA — devem ser **geradas** de fato + template, para não poderem
divergir. O humano edita o *enquadramento* (tom, quais procedimentos são cotáveis), não
o número.

### Camada 3 — Escape hatch (texto livre, escopo explícito)
`notes` — mas reenquadrado. É para nuance que os campos estruturados genuinamente não
expressam ("não fazemos implante em fumante", "sempre citar que o Dr. treinou fora").
**Nunca** para um fato que tem casa estruturada. Guardado por lint (§6).

### A regra de decisão para qualquer config nova
1. É fato legível por máquina (número, enum, boolean, hora)? → **Camada 1**, um dono.
2. A IA precisa **dizer** isso? → Não guarde a frase. Guarde o fato (C1) + **derive** a
   frase (C2).
3. É nuance real sem casa estruturada? → **Camada 3**, com lint.
4. Editar isso obrigaria editar outro campo junto? → já é um fato de C1 no lugar errado.
   **Colapsa.**

---

## 3. Auditoria campo a campo

Legenda: ✅ dono único correto · ⚠️ sobreposição (mesmo fato, 2+ campos) · 💀 morto
(escrito e nunca lido) · 🔤 catch-all de texto livre.

### `treatments` — catálogo por serviço
| Campo | Status | Nota |
|---|---|---|
| `name`, `durationMinutes`, `aliases`, `keywordMatchEnabled`, `requiresEvaluationFirst`, `isAesthetic` | ✅ | Fatos C1 legítimos, um dono. |
| `priceCents` / `minPriceCents` / `maxPriceCents` | ⚠️ | Mesmo fato que o número dentro de `commercialPolicy`. É C1; a prosa devia derivar dele. |
| `description` | ⚠️ | Descreve procedimento — mesmo papel que `playbook_versions.procedureDescription`. Dois donos para "o que é o procedimento". |
| `commonObjections` (`string[]`) | 💀 | Escrito como `[]` no onboarding/settings reais; populado só no seed-demo; **lido por nenhum consumidor de runtime**. Objeções reais vivem em `playbook_versions.objections`. |
| `triggerTemplate` | ⚠️ | Um de **três** mecanismos para "o que enviar quando o tratamento é citado" (ver §4). |
| `pipelineSteps` | ⚠️ | Idem — mecanismo estruturado mais novo, concorre com `triggerTemplate` e com o TRIGGER legado em `notes`. |

### `playbook_versions` — conteúdo editorial
| Campo | Status | Nota |
|---|---|---|
| `toneOfVoice`, `specialty`, `receptionistName`, `differentials`, `objections`, `mediaLibrary` | ✅ | Donos únicos; já **compostos** para o prompt por `composePlaybookText`. Bom padrão. |
| `commercialPolicy` | ⚠️🔤 | Texto livre que carrega números de preço à mão (mesmo fato que `priceCents`). É o único campo editorial que ficou como blob — por isso é o que diverge. |
| `procedureDescription` | ⚠️ | Sobrepõe `treatments.description`. `composePlaybookText` usa a lista de treatments se existir, senão cai aqui — dois caminhos para o mesmo conteúdo. |
| `notes` | 🔤 | Injetado **cru no topo** do playbook, antes das seções estruturadas → pode contradizer tudo abaixo. Já tem `lintPlaybookNotes` (só avisa). Ainda carrega TRIGGER legado. |

### `organizations` — operacional do tenant (~50 campos)
| Grupo | Status | Nota |
|---|---|---|
| `timezone`, `businessHours`, `defaultAppointmentDurationMinutes`, `postAppointmentBufferMinutes`, buffers/TTLs/limites de slot | ✅ | Fatos operacionais C1, um dono, lidos pelo SlotEngine/orquestrador. |
| Credenciais de canal (`zapi*`, `meta*`, `channelProvider`) | ✅ | Um dono; roteiam entrada/saída. |
| `calendarMode`, `googleCalendarId` | ✅ | Dono da fonte de agenda. (Ver nota Ximendes em §4.) |
| `greetingMessage` | ⚠️ | Vive aqui mas é referenciado pelo fluxo de playbook/menu/simulate — confirmar dono único. |
| `serviceNoun`, `bookingNoun`, `contactNoun`, `agentRole`, `businessDescriptor`, `segment`, `specialty` | ⚠️ | Vocabulário derivável do `segment` mas sobrescrevível. Não é perigoso (não são fatos comerciais), mas infla a superfície de preenchimento. Candidatos a "derivar do segment, mostrar só se personalizar". |
| `monthlyRevenueBrl`, `billingStartedAt`, `plan`, `operationalStatus` | ✅ | Estado comercial do tenant, dono único. |

---

## 4. Os focos de drift confirmados hoje

1. **Preço em dois lugares** — `treatments.priceCents` ↔ número à mão em
   `commercialPolicy`. Mesmo fato. → derivar (§5).
2. **Descrição de procedimento em dois lugares** — `treatments.description` ↔
   `playbook_versions.procedureDescription`. → um dono (a lista de treatments); aposentar
   o fallback.
3. **Objeções em dois lugares** — `treatments.commonObjections` (💀 morto) ↔
   `playbook_versions.objections` (vivo). → remover o campo morto.
4. **Três mecanismos de "trigger" por tratamento** — `pipelineSteps`, `triggerTemplate`,
   e TRIGGER embutido em `notes` (o próprio código marca *"remover após migrar todos os
   tratamentos"*, `ConversationOrchestrator.ts:2970`). → um mecanismo; migrar e deletar
   os outros dois.
5. **`notes` como depósito** — texto cru no topo do prompt, sem bloqueio quando carrega
   fato com casa estruturada. → escalar o lint para bloquear no publish (§6).

> Aparte não-drift mas relevante: a Ximendes está em `calendarMode = "internal"` com um
> `googleCalendarId` preenchido e **ignorado**. Não causou os bugs recentes, mas é um
> campo que parece ativo e não é — confirmar se é intencional para não confundir suporte.

---

## 5. Derivar em vez de duplicar (menos campos = menos erro)

O padrão **já existe** no código: `composePlaybookText` compõe procedimentos, objeções
e diferenciais a partir de campos estruturados. `commercialPolicy` é o único que ficou
como texto livre com fato embutido — é a anomalia.

**Alvo:** transformar a regra de preço em campos estruturados no treatment
(`priceCents` + flags: cotável em chat? piso ou fixo? abatimento?) e **gerar** a seção de
preço da `commercialPolicy` a partir deles — igual já se faz com procedimentos. Resultado:
**um** lugar para editar preço, e o texto da IA **não tem como** contradizer o número do
dashboard, porque nasce dele.

Cada campo de Camada 2 derivado de Camada 1 é **um campo a menos** que a clínica pode
preencher errado. A melhor prevenção de erro é ter menos inputs.

---

## 6. Prevenção de erro no onboarding

Infra que **já existe** (construir em cima, não do zero):
`resolveActiveEditorialConfig` (porta única de leitura), `composePlaybookText` (derivação),
`publishablePlaybookSchema` (validação no publish), `lintPlaybookNotes` (aviso),
`FieldComposer` + `fact-guard` (anti-alucinação de LLM), `buildClinicBlueprint` (score de
prontidão).

**A. Progressive disclosure em vez de paredão de campos.** O banco pode ter 50 campos; o
humano vê uma sequência guiada com defaults. O blueprint já pontua prontidão por seção —
o passo é virá-lo **wizard** que pergunta em ordem e esconde o avançado atrás de
"personalizar".

**B. Blueprint = estrutura + orientação, não valores.** O "golden config" não é *"copie os
números da Ximendes"* — é um template **por segmento** (dental, barbearia, etc.) que já
traz a **estrutura** (os 13 procedimentos padrão, as objeções padrão, o scaffold da regra
de preço) com os slots de valor **em branco** e uma dica inline de *por que aquilo importa*.
A Ximendes vira referência de **estrutura**, não de dado.

**C. Validação no publish que bloqueia a classe de drift, não só avisa.** Estender
`publishablePlaybookSchema` + `lintPlaybookNotes` com checagens cruzadas que **bloqueiam**:
- descrição de treatment contém `R$` → bloqueia (preço tem casa em `priceCents`);
- `commercialPolicy` cita preço de procedimento com cotação desabilitada → bloqueia;
- `notes` contém padrão de preço/pagamento/objeção → **bloqueia** (hoje só avisa), com
  affordance "mover para o campo X".

O `fact-guard` já aplica esse rigor à **saída** do LLM; a mesma régua deve valer para a
**entrada** humana no publish.

**D. Derivar (§5).** Reduz a superfície de input na origem.

---

## 7. O escape hatch: personalização sem drift

A Camada 3 (`notes` reenquadrado) é onde um estabelecimento expressa necessidade especial.
Pode ser texto livre — mas é **escopado** (só nuance) e **guardado** (não pode conter fato
com casa estruturada).

Quando surge uma necessidade real que o escape hatch não expressa bem, **esse é o sinal**
para promover aquilo a um campo estruturado de Camada 1 — com **default em código**, para
as clínicas existentes não serem afetadas (o padrão `clinic.field ?? CODE_DEFAULT` do
AGENTS.md). É assim que se ganha personalização **sem** reintroduzir drift e **sem** travar
feature: o hatch absorve o caso raro; o caso que vira recorrente é promovido a estrutura.

---

## 8. Roadmap sequenciado (cada item = 1 PR isolado)

Ordenado por risco/retorno. Cada um é pequeno, testável e reversível.

1. **Remover `treatments.commonObjections` (💀).** Campo morto; migração dropando a coluna
   + limpeza dos writes `[]`. Zero risco de runtime (ninguém lê). *Menor esforço, tira uma
   fonte falsa do mapa.*
2. **Escalar `lintPlaybookNotes` para bloquear no publish** os padrões que têm casa
   estruturada (preço/pagamento/objeção). Reusa o lint existente; só muda de warn→block no
   gate de publish.
3. **Derivar a seção de preço da `commercialPolicy` a partir de `priceCents` + flags.**
   O maior ganho estrutural (§5). Requer flags novas no treatment (cotável, piso/fixo,
   abatimento) com defaults.
4. **Colapsar `procedureDescription` em `treatments.description`.** Aposentar o fallback em
   `composePlaybookText`; migrar o conteúdo restante.
5. **Unificar os 3 mecanismos de trigger** em `pipelineSteps`; migrar `triggerTemplate` e o
   TRIGGER-em-`notes`, depois deletar os dois caminhos legados (o código já pede isso).
6. **Blueprint → wizard guiado por segmento** com progressive disclosure (§6A/B).

---

## 9. Checklist para criar/preencher config (estende `sources-of-truth.md` §Checklist)

1. É fato legível por máquina? → Camada 1, um dono estruturado.
2. A IA precisa dizer isso? → guarde o fato, **derive** a frase — nunca digite a frase com
   o fato dentro.
3. É nuance sem casa estruturada? → Camada 3 (`notes`), sabendo que o lint vai barrar
   qualquer fato que tenha casa.
4. Editar isso obrigaria editar outro campo? → é C1 no lugar errado; colapsa.
5. Isso varia por tenant/serviço? → `organizations` / `treatments` com default em código,
   nunca hardcode em prompt.
6. O valor está declarado em código **e** prompt ao mesmo tempo? → modelagem errada.
