# Estratégia de Precificação — SystemOps Sales Engine

> Documento fonte da verdade para preços, limites e mapeamento de features por plano.
> Substitui a tabela de preços antiga em `sales-playbook.md` (mantida lá só como
> referência de script de vendas — os valores oficiais vivem aqui).
> Atualizado em: julho/2026.

**Capacidade real de infra**: ver `docs/product/cost-control.md` § "Capacidade Real de
Conversas — Infra Atual" — a extrapolação do piloto indica ~225 conversas/mês de teto
agregado no Neon Free tier, abaixo do fair use de um único cliente Growth. Provisionar
Neon Launch antes do primeiro cliente pago.

**Onboarding de piloto (não-comercial)**: clientes onboardados como piloto/teste sem
cobrança (ex.: os 2 novos clientes de jul/2026) não entram nas métricas de MRR nem na
matriz de planos abaixo — servem para validar comportamento e onboarding antes de vender
de verdade. Ver checklist de validação em `docs/operations/e2e-test-plan.md`.

**Foco comercial vigente: apenas Start e Growth.** Scale e Enterprise ficam fora da
venda ativa por ora — a arquitetura atual (mono-unidade, billing manual) suporta bem
esses dois planos; a ideia é validar os primeiros ~6 clientes em Start/Growth e observar
o comportamento real da aplicação antes de abrir Scale/Enterprise como planos vendáveis.
As linhas de Scale/Enterprise nas tabelas abaixo continuam documentadas para não perder
o desenho, mas não devem ser oferecidas a prospects agora.

Decisão vigente: **plano de rede/multi-unidade está fora do catálogo por enquanto.**
O código mantém o enum `rede` (`OrgPlan`) por não valer a pena uma migração de schema
agora, mas comercialmente ele é vendido como **Scale** — um plano mono-unidade de alto
volume, não como "múltiplas clínicas em um painel" (essa capacidade não existe na
arquitetura ainda — ver `docs/architecture/target-architecture.md` quando for retomada).

---

## 1. Matriz de Planos

| | **Start** (`essencial`) | **Growth** (`avancado`) | **Scale** (`rede`) | **Enterprise** (`custom`) |
|---|---|---|---|---|
| Preço/mês | R$ 1.300 | R$ 2.100 | R$ 3.500 | Sob diagnóstico |
| Setup (único) | R$ 1.800 | R$ 3.000 | R$ 5.000 | Customizado |
| Cliente ideal | Clínica solo/pequena, tráfego incipiente | Clínica com tráfego pago ativo (R$5-15k/mês em ads) | Alto volume, múltiplos profissionais, quer voz premium | Faturamento R$100k+/mês, caso sob medida |
| WhatsApp | 1 número | 1 número | 1-2 números | Customizado |
| Usuários operadores | até 2 | até 5 | até 10 | Ilimitado |
| Conversas/mês (fair use) | ~300 | ~800 | ~2.000 | Customizado |
| Playbooks | 1 | Ilimitado | Ilimitado | Ilimitado |
| Follow-up automático | ✅ (cadência padrão) | ✅ | ✅ | ✅ |
| Recuperação de leads parados | ❌ | ✅ | ✅ | ✅ |
| Recomendação de resposta ao operador | ❌ | ✅ | ✅ | ✅ |
| AI Co-writer de playbook | ❌ | ✅ | ✅ | ✅ |
| Biblioteca de mídia/vídeo | ❌ | ✅ | ✅ | ✅ |
| Voz (TTS OpenAI, 3 modos configuráveis) | ✅ incluso | ✅ incluso (substituída pelo B-WAVE se ativo) | ✅ incluso | ✅ incluso |
| Voz premium (ElevenLabs / B-WAVE) | ❌ | ✅ incluso, modo full (fase de validação) | Add-on | Add-on |
| Métricas de qualidade de IA | Básico (interno) | Completo | Completo + alertas | Completo + SLA |
| Multi-unidade | ❌ | ❌ | ❌ | Fora do catálogo — só via projeto customizado |
| Add-ons disponíveis | Voz avulsa, WhatsApp extra | Voz, usuário extra | WhatsApp extra | Tudo sob medida |
| Quando recomendar upgrade | Excedeu fair use ou pediu voz | Quer playbook multi-etapa avançado ou +1 número | Quer +2.000 conversas/mês ou ElevenLabs | — |

Desconto: **somente em contrato anual** (2 meses grátis / ~16%), nunca no valor mensal.
Contrato mínimo: **3-6 meses**.

Mapeamento para o enum atual do banco (`OrgPlan`): `essencial` = Start, `avancado` =
Growth, `rede` = Scale (repaginado, sem promessa de múltiplas unidades), `custom` =
Enterprise.

---

## 2. Mapeamento de Features → Maturidade → Plano

Esta tabela é a referência para o time de vendas (o que pode prometer) e para o time
técnico (o que precisa de gate em `clinic_modules`).

| Feature | Maturidade | Start | Growth | Scale | Enterprise |
|---|---|---|---|---|---|
| Atendimento IA WhatsApp | ✅ Pronta | ✅ | ✅ | ✅ | ✅ |
| Qualificação de lead (status/temperatura) | ✅ Pronta | ✅ | ✅ | ✅ | ✅ |
| Agenda interna completa | ✅ Pronta | ✅ | ✅ | ✅ | ✅ |
| Confirmação/cancelamento/remarcação via WhatsApp | ✅ Pronta | ✅ | ✅ | ✅ | ✅ |
| Lembretes automáticos | ✅ Pronta | ✅ | ✅ | ✅ | ✅ |
| Follow-up automático | ✅ Pronta | ✅ limitado | ✅ | ✅ | ✅ |
| Recuperação de leads parados | ✅ Pronta | ❌ | ✅ | ✅ | ✅ |
| Inbox + handoff humano | ✅ Pronta | ✅ | ✅ | ✅ | ✅ |
| Playbook (editor + versionamento + simulador) | ✅ Pronta | 1 playbook | Ilimitado | Ilimitado | Ilimitado |
| AI Co-writer de playbook (`ai_co_writer`) | ✅ Pronta | ❌ | ✅ | ✅ | ✅ |
| Multi-segmento (config por especialidade) | ✅ Pronta | ✅ | ✅ | ✅ | ✅ |
| Recomendação de resposta ao operador | ✅ Pronta | ❌ | ✅ | ✅ | ✅ |
| Voz — TTS OpenAI (`voice_tts`), 3 modos configuráveis | ✅ Pronta, custo variável | ✅ | ✅ | ✅ | ✅ |
| Voz — ElevenLabs (`voice_elevenlabs`) | ✅ Pronta, custo alto | ❌ | ✅ incluso, modo full (fase de validação) | Add-on | Add-on |
| Biblioteca de mídia (`video_library`) | ✅ Pronta | ❌ | ✅ | ✅ | ✅ |
| Rastreamento de custo IA/TTS/WhatsApp | ✅ Pronta | interno | interno | interno | interno |
| Métricas de qualidade de IA | 🔶 Parcial — cálculo não auditado | Básico | ✅ | ✅ + alertas | ✅ + SLA |
| Pipeline de receita (`revenue_pipeline`) | 🔶 Parcial — valor estático, não em tempo real | ❌ | ❌ até corrigir | ❌ até corrigir | ❌ até corrigir |
| Controle de equipe/papéis (`team_roles`) | 🔶 Parcial — enforcement de permissão não auditado | 1 usuário admin | até 5 usuários | até 10 usuários | Ilimitado |
| Multi-unidade/rede | ❌ Não existe na arquitetura | — | — | — | Só via projeto customizado |
| Entitlement enforcement automático | ❌ Não existe | — | — | — | — |
| Billing/assinatura automática | ❌ Não existe | — | — | — | — |

**Regra para vendas**: nunca vender uma linha marcada 🔶 ou ❌ como pronta. Se o
prospect pedir algo em 🔶, é elegível para early access com expectativa combinada, não
promessa contratual formal.

---

## 3. Racional dos preços

- **Start R$1.300 / Growth R$2.100 / Scale R$3.500**: ajuste para cima em relação aos
  valores originalmente cogitados (R$900/1.500/2.600), porque a margem técnica atual
  (~91% no tier básico, conforme `cost-control.md`) suporta preço maior sem risco, e o
  ICP (clínica com R$10-15k/mês em ads) tem tolerância de preço muito acima do piso.
  Growth ajustado de R$2.300 → **R$2.100** (jul/2026) para deixar o degrau Start→Growth
  mais fácil de subir na fase de validação; a margem segue saudável mesmo com B-WAVE full
  (ver `cost-control.md` — validar consumo real de ElevenLabs nos primeiros Growth).
- Preço nunca deve ser ancorado no cliente de baixo ticket — ancorar no valor de 1-2
  leads recuperados por mês, que já cobre o plano inteiro em qualquer tier.
- Setup separado do mensal sempre — funciona como filtro de comprometimento e cobre
  custo real de onboarding (Z-API, Google Calendar, playbook).

## 4. Estratégia comercial (resumo operacional)

- Abrir com diagnóstico (leads perdidos fora do horário), não com preço.
- Plano recomendado por padrão: **Growth**.
- Desconto só em anual, nunca no mensal.
- Piloto pago com desconto no primeiro mês — nunca gratuito.
- Cliente R$100k+/mês: vender por case/prova social, não por desconto; tratar como
  possível projeto Enterprise sob diagnóstico.
- Não ofereça "rede"/multi-unidade mesmo se perguntado — resposta padrão: "hoje
  atendemos cada unidade com contrato próprio; multi-unidade está no roadmap".

### 4.1 Frame de persuasão (ancorar no valor, não no software)

O argumento central não é "software de atendimento" — é **"uma recepcionista que custa
menos, trabalha 24/7 e nunca deixa um lead sem resposta"**.

- **Comparação com recepcionista humana.** Uma recepcionista CLT no Brasil custa salário
  ~R$1.500-2.000/mês **mais** encargos e provisões (FGTS, INSS patronal, 13º, férias +1/3,
  VT/VR, rescisão) — custo real para a clínica de **~R$2.800-4.000/mês**. E ainda assim:
  cobre só ~44h/semana, tira férias, falta, adoece e tem rotatividade. O SystemOps custa
  R$1.300-2.100/mês, atende **24/7/365**, responde na hora, **sem folha, sem encargos,
  sem passivo trabalhista, sem turnover** — e pega o lead à noite e no fim de semana,
  justamente quando o tráfego pago traz gente e a recepção humana está fora.
- **ROI como âncora.** Recuperar 1-2 leads/mês que hoje se perdem fora do horário já paga
  o plano inteiro. Ancorar no ticket médio do procedimento da clínica, nunca no preço do
  software.
- **Setup separado do mensal** funciona como filtro de comprometimento e cobre o
  onboarding real (WhatsApp, Google Calendar, playbook).

### 4.2 Oferta de Fundador (primeiros ~6 clientes de validação)

Mecanismo de desconto para os primeiros contratos, sem queimar a ancoragem de preço:

- **40% off nos 3 primeiros meses + setup pela metade**, em troca de: (a) autorização de
  case/depoimento com números reais, (b) feedback estruturado sobre o produto.
- **Preço cheio travado por 12 meses** (protege o cliente de reajuste e nos dá retenção).
- **Nunca gratuito** e **time-boxed**: válido só até fechar os ~6 primeiros. Depois disso,
  a oferta some — o cliente sabe que o preço "real" é maior, o que preserva a ancoragem.
- É desconto **no fluxo** (temporário), nunca no valor percebido nem no mensal recorrente.

## 5. O que não publicar no site ainda

- Qualquer menção a multi-unidade/rede/gestão de grupo.
- "Receita em tempo real" / "dashboard de receita" — usar linguagem mais modesta
  ("acompanhamento de agendamentos e faturamento por período") até a Fase 5 do roadmap
  técnico (`docs/operations/billing-roadmap.md`) corrigir isso.
- "Controle de acesso por função" como benefício formal do Scale até auditar
  `team_roles`.

---

## 6. Fase de Validação Inicial (Start + Growth) — política vigente até os primeiros contratos fecharem

Enquanto não temos clientes pagantes reais, o foco é validar o sistema em produção com
o mínimo de risco comercial e técnico. Duas decisões táticas, ambas usando mecanismos
que já existem no código (não exigem nova infraestrutura):

### 6.1 Start com voz OpenAI liberada e configurável (decisão final, substitui o teaser)

Decisão: o plano Start **inclui a voz robotizada (OpenAI TTS)** de fato, com os mesmos
4 modos configuráveis que o B-WAVE usa — `greeting_only` (só a saudação, **padrão**),
`impact` (momentos de alto impacto), `mix` (quase toda a conversa) e `full` (tudo em
áudio). A clínica escolhe o modo no próprio painel (`/app/settings/playbook`, aba Voz),
igual ao que já existia só para B-WAVE.

- `voice_tts` agora está no catálogo padrão de `essencial` em `module-catalog.ts` — é
  incluso de verdade, não add-on.
- Default de modo (quando a clínica não configurou nada) é **`"greeting_only"`**: só a
  saudação vem em áudio (revisão jul/2026, em `ConversationOrchestrator.ts`). Motivo:
  feedback real de cliente — **Ximendes: "não gosta de tantas mensagens de áudio"** — mais
  o fato de a voz OpenAI ser robótica. Ouvida uma vez (na saudação) é novidade e cria
  desejo de upgrade; repetida em toda conversa, irrita e assusta o cliente menor. Regra:
  começar conservador e deixar a clínica **subir** o volume de voz (impact/mix/full) no
  painel — nunca o contrário.
- UI: seletor de modo (3 opções, mesmo componente visual do B-WAVE) adicionado em
  `src/app/(clinic)/app/settings/playbook/tab-voz.tsx` e no painel owner
  (`/owner/clinics/[clinicId]/modules`).
- **O que diferencia Start de Scale/Enterprise não é mais "ter voz ou não", é a
  qualidade da voz**: Start = OpenAI (robotizada, mais barata), Scale/Enterprise =
  B-WAVE/ElevenLabs (hiper-realista). Esse é o gancho de upgrade agora — o cliente ouve
  a diferença de qualidade entre as duas, não a ausência total de voz.
- Modo `"greeting_only"` (`voice-mode.ts`, `VoiceModeGreetingOnly.test.ts`) é o **padrão
  do Start** — voz só na saudação. Menos áudio, não mais.

### 6.2 Growth com B-WAVE em modo "impact" (ElevenLabs) — revisão jul/2026

O Growth **inclui B-WAVE/ElevenLabs no catálogo padrão**, em modo **`"impact"`** (voz
premium nos momentos de conversão: saudação, preço, agendamento, confirmação, urgência) —
não `"full"`. Revisão jul/2026 por dois motivos convergentes: **margem** (o ElevenLabs
tem custo alto por caractere; `full` numa clínica de alto volume derruba a margem do
plano — ver tabela em `docs/product/cost-control.md`) e **feedback real de cliente**
(áudio em excesso incomoda — Ximendes). O `full` (toda a conversa em voz) fica como
**opt-in por clínica** no painel, para quem quiser.

- `voice_elevenlabs` está no catálogo padrão de `avancado` em `module-catalog.ts`, junto
  de `rede`/`custom`.
- Preset dedicado `GROWTH_VALIDATION_BWAVE_CONFIG` (`plan-presets.ts`, mode `"impact"`) —
  distinto do preset do Rede (`REDE_RECOMMENDED_BWAVE_CONFIG`, mode `"mix"`), aplicado
  automaticamente via `applyClinicPlanPreset()` quando o plano da clínica é `avancado`.
- A clínica ainda precisa cadastrar o `voiceId` real da ElevenLabs (painel owner ou
  aba Voz da clínica) — sem isso o B-WAVE não sintetiza, mesmo com o módulo ativo.
- **Plano ElevenLabs:** operar no **Pro ($99/600k créditos)** com **Flash v2.5**
  (~0,5 crédito/char) e subir para **Scale ($299/1,8M)** conforme o nº de clínicas Growth
  cresce (mesmo racional dos gatilhos de Neon/Z-API). Acompanhar `tts_usage_costs`; a
  tabela de margem por modo/volume/preço vive em `docs/product/cost-control.md`.
- Cap de segurança (Fase 3, quando houver enforcement de entitlement): budget de
  caracteres por plano com fallback para voz OpenAI ao estourar — bloqueia o pior caso da
  clínica de altíssimo volume em voz sem intervenção manual.
