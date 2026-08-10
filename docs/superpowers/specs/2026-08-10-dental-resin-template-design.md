# SystemOps Dental Resin Template — Design

**Status:** aprovado pelo usuário em 2026-08-10

**Data:** 2026-08-10

**Implementa:** Fase 4 de `docs/superpowers/specs/2026-08-09-systemops-rebuild-design.md` §7

**Escopo:** o template instalável. As 12 famílias de replay que o validam são spec separada.

## 1. O problema, em números

`scripts/` contém **16 scripts escritos à mão** para configurar clínicas específicas:
`ximendes-*`, `vitalli-*`, `apply-nc-beauty-v2`, `update-concierge-config` e outros. Cada
cliente exigiu código sob medida.

Isso é a queixa nº 1 e a nº 2 do diagnóstico em forma de arquivo: *"tempo muito longo para
realizar o setup"* e *"setup muito moroso, muita informação, muitos campos para preencher"*.
Três clientes desistiram, e a fricção do setup destruiu a confiança antes de o produto
demonstrar valor.

O template existe para que instalar uma clínica deixe de ser um exercício de programação.

## 2. Decisões tomadas

| Decisão | Escolha |
| --- | --- |
| Cobertura do v1 | Somente a jornada de resina/lentes. Outros tratamentos entram como cadastro simples, sem pipeline. |
| Forma x conteúdo | O template entrega **conteúdo pronto** — objeções, perguntas de qualificação e condução escritas por nós. A clínica corrige o que discorda. |
| Gate de ativação | Estrito. Canal/tenant, preço, agenda e mídia/recepção **bloqueiam** ativação quando ausentes. |
| Catálogo em banco | Fora desta fase, por decisão da spec mestre §7.2: só após validar o segundo segmento. |

## 3. Arquitetura

```text
manifest (código, tipado)
  + dados da clínica
  -> planTemplateInstall()      função pura, não escreve
  -> InstallPlan | Blocker[]
  -> executeInstallPlan()       única que escreve
  -> registro de instalação
```

### 3.1 Por que planejar e escrever são etapas separadas

O `InstallPlan` é um artefato inspecionável **antes** de qualquer escrita. Ele é o diff que o
Marco 2 do onboarding precisa mostrar ao cliente: *"isto é o que vou configurar na sua
clínica"*.

Os 16 scripts atuais misturam planejamento e escrita, então ninguém vê o que vai acontecer
antes de acontecer. Foi assim que a Vitalli ganhou um drift Simplificada→Premium que só
apareceu semanas depois.

Se o planejamento falhar, devolve `Blocker[]` em vez de um plano. Nada é escrito
parcialmente.

### 3.2 Arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/application/templates/contract.ts` | `TemplateManifest`, `Placeholder`, `InstallPlan`, `InstallOperation`, `Blocker` |
| `src/application/templates/dental-resin-v1/manifest.ts` | O template — dados, sem lógica |
| `src/application/templates/dental-resin-v1/objections.ts` | Respostas autorizadas, separadas por volume |
| `src/application/templates/validate-manifest.ts` | Valida o manifest contra o próprio contrato |
| `src/application/templates/plan-install.ts` | `planTemplateInstall()` — pura, testável sem banco |
| `src/application/templates/execute-install.ts` | `executeInstallPlan()` — a única que escreve |
| `src/application/templates/installation-record.ts` | Grava template, versão, digest, campos personalizados, ator |

O **digest** é um hash do conteúdo do manifest no momento da instalação. Existe para uma
pergunta específica: quando o template v1.1 sair, saber se a clínica foi instalada com o
manifest que o código diz, ou com uma versão anterior do mesmo número — que é o modo como
"v1" silenciosamente significa três coisas diferentes em três clínicas.
| `src/application/templates/activation-gate.ts` | Os quatro bloqueantes; estende o blueprint existente |

### 3.3 Duas regras herdadas da spec mestre

**O runtime nunca lê o manifest.** Ele lê `organizations`, `treatments`,
`playbook_versions` e módulos, como sempre. O manifest é artefato de instalação, não segunda
fonte de verdade — do contrário criamos o problema de dois donos que
`docs/architecture/sources-of-truth.md` proíbe.

**O plano só escreve nos donos canônicos.** Verificado contra o schema atual:

| Informação | Dono canônico |
| --- | --- |
| Preço estruturado | `treatments.priceCents`, `minPriceCents`, `maxPriceCents`, `priceKind`, `priceQuotableInChat` |
| Política comercial em prosa | `playbook_versions.commercialPolicy` (campo `text`) |
| Tom, nome da recepcionista, diferenciais | `playbook_versions` |
| Objeções e respostas | `playbook_versions.objections` (`jsonb<{objection, response}[]>`) |
| Garantia | `playbook_versions.warrantyPolicy` |
| Aliases, pipeline, duração, gatilhos | `treatments` |
| Mídia | `playbook_versions.mediaLibrary` / `mediaAssetIds` |
| Horários, timezone, limites, canal | `organizations` |

Uma operação de plano que aponte para outro lugar é um defeito de contrato, não uma escolha
de implementação.

**Correção a um rascunho anterior deste spec:** ele afirmava que preço vai para
`commercialPolicy` do playbook. Está errado — `commercialPolicy` é `text` livre, para
política em prosa. O preço estruturado que o runtime lê vive em `treatments`. Escrever valor
em prosa e esperar que a IA o respeite é precisamente o modo como ela cotou errado antes.

**Mapeamento do canal de entrega para o schema existente**, sem coluna nova:

| Canal | `priceQuotableInChat` | Asset de mídia |
| --- | --- | --- |
| `text` | `true` | não exigido |
| `media` | `true` | **exigido** — é o que a IA envia |
| `human` | `false` | não exigido; o turno vira handoff |

## 4. O manifest

### 4.1 Slug interno estável, nome fornecido pela clínica

A spec mestre §19 proíbe tratar "Simplificada", "Estratificada", "Premium" ou "Slim" como
taxonomia clínica universal — são vocabulário comercial de cada clínica. Mas o pipeline, as
objeções e os cenários de replay precisam referenciar variantes de forma estável.

O manifest declara variantes por slug interno, com o nome de exibição como placeholder:

```text
variants:
  - slug: "entry"     displayName: <placeholder>
  - slug: "premium"   displayName: <placeholder>
```

Observado nas duas clínicas reais: Vitalli usa "Simplificada" e "Premium"; Ximendes usa
"Simplificada" e "Estratificada". Ambas mapeiam para os mesmos dois slugs.

Isso permite que uma objeção diga *"quando o lead acha caro, ofereça a variante `entry`"* sem
congelar o vocabulário de ninguém, e permite que o replay exercite `entry` em qualquer
clínica.

### 4.2 Placeholders: duas categorias, e só duas

| Tipo | Comportamento |
| --- | --- |
| `blocking` | A clínica precisa fornecer. Ausente = `Blocker`; não instala nem ativa. |
| `defaulted` | O template traz valor pronto. A clínica pode sobrescrever; sobrescrita vira campo personalizado no registro de instalação. |

Objeções, perguntas de qualificação e condução de funil são `defaulted` — chegam escritas e a
clínica só corrige o que discorda.

Não existe uma terceira categoria "opcional sem padrão". Um campo ou bloqueia, ou tem
resposta pronta. Um campo que não bloqueia e chega vazio é exatamente o buraco por onde a IA
inventa.

### 4.3 Preço

Preço recebe tratamento explícito porque foi onde as duas clínicas reais mais divergiram e
onde a IA mais errou — cotou serviço errado em até 10×, e a ambiguidade R$ 4.000 vs R$ 2.000
da Ximendes segue aberta.

O manifest modela três coisas separadas:

- **forma**: `fixed`, `from`, ou `per_quantity` (Vitalli cobra por 10 e 20 elementos);
- **canal de entrega**: `text`, `media` ou `human`. São três casos distintos e não devem ser
  confundidos:
  - `text` — a IA diz o valor na conversa;
  - `media` — o valor vive numa arte, e o manifest **exige** o asset correspondente;
  - `human` — o valor não sai pela IA em nenhuma forma; o turno vira handoff.

Um spec anterior tratava "não cotável no chat" e "entregue por mídia" como a mesma coisa. Não
são: a Vitalli entrega por arte (`media`), enquanto um valor que depende de avaliação clínica
é `human`. Confundir os dois faz a IA calar quando deveria mandar a arte, ou mandar arte
quando deveria chamar humano.

O caso `media` é bloqueante por evidência: uma IA que procura `R$` no texto não enxerga preço
em arte. Foi assim que o vídeo entrou em loop e o preço nunca saiu.

### 4.4 O que o manifest não contém

Nenhuma regra clínica. Nenhuma afirmação de resultado. Nenhuma promessa de cobertura de
garantia, nem cotação para paciente da casa — a IA já errou nisso, afirmando cobertura sem
dado.

Nenhuma diferença comercial entre variantes pode ser apresentada como superioridade clínica
universal.

## 5. Gate de ativação

`src/application/onboarding/clinic-blueprint.ts` já calcula `readinessPercent` e
`criticalMissing`. O gate estende essa máquina em vez de criar uma segunda.

A mudança de natureza: hoje o blueprint **informa** prontidão; passa a **impedir** ativação,
com poder de veto sobre `autoReplyEnabled`.

| Bloqueante | Verificação |
| --- | --- |
| Canal e tenant | `resolveClinicByZapiInstance` responde; webhook autenticado; instance ID não vinculado a outro tenant |
| Preço | Toda variante instalada tem forma de preço definida; toda variante com canal `media` tem o asset correspondente presente |
| Agenda | Calendário conectado e devolvendo slots reais numa chamada de teste |
| Mídia e recepção | Assets do pipeline presentes; `mapsUrl` é link de Maps e não `share.google`; `receptionistPhone` não é número da SystemOps |

Os dois últimos são específicos porque são falhas que já ocorreram: o link de localização da
Ximendes abria busca em vez de mapa, e o `receptionistPhone` dela ainda aponta para o celular
do operador. O primeiro é a falha `clinic_not_resolved` que quebrou a Maycon.

## 6. Falhas

| Falha | Comportamento |
| --- | --- |
| Placeholder bloqueante ausente | `Blocker`; nenhum plano é produzido |
| Manifest inválido | Erro na validação; nunca chega ao planner |
| `executeInstallPlan` falha no meio | Registro de instalação não é gravado; instalação é reexecutável |
| Clínica já tem instalação | Planner produz diff e **exige confirmação explícita**; não aplica automaticamente |
| Gate reprovado | `autoReplyEnabled` não pode ser ligado; motivo específico é retornado |

A spec mestre §7.2 exige que atualização gere diff revisável e nunca altere automaticamente
uma clínica ativa. A v1 cumpre isso pela confirmação explícita.

## 7. Testes

**Manifest válido.** O manifest passa pelo próprio validador: pega placeholder declarado e
não usado, variante sem forma de preço, objeção referenciando slug inexistente, e pipeline
citando mídia não declarada.

**Planner puro, sem banco.** Dado manifest e clínica incompleta, os blockers corretos
aparecem. Dado manifest e clínica completa, o plano contém exatamente as operações esperadas
e escreve somente nos donos canônicos.

**Isolamento de tenant.** Nenhuma operação do plano aponta para `clinicId` diferente do
alvo. Este teste deve ser feito falhar de propósito antes de merecer confiança.

**Gate.** Cada um dos quatro bloqueantes, isolado: presente permite, ausente impede, e o
motivo retornado nomeia qual faltou.

## 8. Fora deste spec

- As 12 famílias de replay (spec seguinte; validam o template em conversa real).
- Catálogo de templates editável em banco (spec mestre §7.2 adia até o segundo segmento).
- Pipeline para tratamentos fora da jornada de resina.
- Atualização automática de clínica ativa.
- Migração dos 16 scripts existentes. Eles permanecem no repositório e continuam proibidos de
  operar clínicas pausadas; substituí-los é consequência natural desta fase, não requisito.

## 9. Definição de pronto

1. O manifest `dental-resin-v1` valida contra o próprio contrato.
2. `planTemplateInstall` produz plano correto para uma clínica completa e blockers nomeados
   para uma incompleta, sem tocar o banco.
3. `executeInstallPlan` escreve somente nos donos canônicos e grava o registro de instalação.
4. O gate impede ativação com qualquer um dos quatro bloqueantes ausente.
5. Reinstalar sobre clínica existente produz diff e exige confirmação.
6. `npm run verify` e `npm run build` saem com exit 0.

Instalar uma clínica de resina deixa de exigir código específico dela.
