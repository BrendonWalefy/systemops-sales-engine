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
| Preço/mês | R$ 1.300 | R$ 2.300 | R$ 3.500 | Sob diagnóstico |
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

- **Start R$1.300 / Growth R$2.300 / Scale R$3.500**: ajuste para cima em relação aos
  valores originalmente cogitados (R$900/1.500/2.600), porque a margem técnica atual
  (~91% no tier básico, conforme `cost-control.md`) suporta preço maior sem risco, e o
  ICP (clínica com R$10-15k/mês em ads) tem tolerância de preço muito acima do piso.
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

Decisão revista: em vez de um teaser restrito só à saudação, o plano Start **já inclui
a voz robotizada (OpenAI TTS)** de fato, com os mesmos 3 modos configuráveis que o
B-WAVE usa — `impact` (só nos momentos de alto impacto, padrão), `mix` (quase toda a
conversa) e `full` (tudo em áudio). A clínica escolhe o modo no próprio painel
(`/app/settings/playbook`, aba Voz), igual ao que já existia só para B-WAVE.

- `voice_tts` agora está no catálogo padrão de `essencial` em `module-catalog.ts` — é
  incluso de verdade, não add-on.
- Default de modo (quando a clínica não configurou nada) é `"impact"`, não `"full"` —
  mais barato e consistente com o padrão do B-WAVE. Ajustado em
  `ConversationOrchestrator.ts`.
- UI: seletor de modo (3 opções, mesmo componente visual do B-WAVE) adicionado em
  `src/app/(clinic)/app/settings/playbook/tab-voz.tsx` e no painel owner
  (`/owner/clinics/[clinicId]/modules`).
- **O que diferencia Start de Scale/Enterprise não é mais "ter voz ou não", é a
  qualidade da voz**: Start = OpenAI (robotizada, mais barata), Scale/Enterprise =
  B-WAVE/ElevenLabs (hiper-realista). Esse é o gancho de upgrade agora — o cliente ouve
  a diferença de qualidade entre as duas, não a ausência total de voz.
- Modo `"greeting_only"` continua implementado (`voice-mode.ts`,
  `VoiceModeGreetingOnly.test.ts`) e disponível para casos pontuais via override manual
  no painel de módulos, mas não é mais a estratégia padrão do Start.

### 6.2 Growth com B-WAVE completo (ElevenLabs, modo "full") — decisão final

Diferente da ideia inicial de exceção manual só para o primeiro contrato, a decisão foi
**incluir B-WAVE/ElevenLabs no catálogo padrão do Growth**, em modo `"full"` (toda a
conversa em voz premium), para todos os clientes Growth durante a fase de validação dos
primeiros ~6 contratos.

- `voice_elevenlabs` agora está no catálogo padrão de `avancado` em
  `module-catalog.ts`, junto de `rede`/`custom`.
- Preset dedicado `GROWTH_VALIDATION_BWAVE_CONFIG` (`plan-presets.ts`, mode `"full"`) —
  distinto do preset do Rede (`REDE_RECOMMENDED_BWAVE_CONFIG`, mode `"mix"`), aplicado
  automaticamente via `applyClinicPlanPreset()` quando o plano da clínica é `avancado`.
- A clínica ainda precisa cadastrar o `voiceId` real da ElevenLabs (painel owner ou
  aba Voz da clínica) — sem isso o B-WAVE não sintetiza, mesmo com o módulo ativo.
- Único ponto de atenção real: **custo por caractere da ElevenLabs em modo full é alto**
  — acompanhar `tts_usage_costs` de perto nos primeiros clientes Growth para confirmar
  que a margem do plano (R$2.300/mês) absorve o consumo em modo full antes de assumir
  isso como padrão permanente do Growth.
- Critério de revisão: ao fechar os primeiros ~6 clientes Start/Growth, revisitar se
  `"full"` continua sendo o modo certo para todo cliente Growth por padrão, ou se deveria
  virar `"mix"`/`"impact"` como default e `"full"` um upgrade dentro do próprio Growth.
