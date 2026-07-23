# Auditoria dos envios automáticos por clínica

**Status:** pendente de execução
**Aberto em:** 2026-07-22
**Motivo:** não sabemos se cada mensagem automática está adequada para cada clínica. Hoje a política é binária (`active` envia, o resto não), sem nada por tipo de mensagem nem por perfil de negócio.

---

## 1. O que existe hoje

Cinco crons produzem mensagem proativa. Todos passam pela outbox e pelo Safety Gate.

| Cron | Horário (UTC) | O que manda | Categoria |
|---|---|---|---|
| `recovery-campaign` | 12h, seg–sáb | Retomada de conversa parada | `recovery` |
| `recovery-campaign-evening` | 21h, seg–sex | Idem, segunda janela | `recovery` |
| `follow-up-dispatcher` | 10h | Follow-up agendado | `follow_up` |
| `appointment-reminder` | 13h | Lembrete de consulta (D-1) | `reminder` |
| `post-appointment-followup` | a cada 30 min | Pós-atendimento / feedback | `follow_up` |

Mais o `lead-outcome-classifier` (6h30), que **não envia** — só analisa.

## 2. Quem está recebendo de verdade (medido em 22/07/2026)

Envios proativos nos 7 dias anteriores, separando real de simulado:

| Clínica | Status | Shadow | Recovery | **Reais** |
|---|---|---|---|---|
| Ximendes Odontologia | `active` | não | 3 | **3** |
| Maycon bordados | `prospect` | **sim** | 19 | 0 |
| NC Beauty & Clinic | `test` | **sim** | 19 | 0 |
| Clínica Vitalli | `paused` | não | 0 | 0 |

**Só a Ximendes envia mensagem automática real hoje.** Maycon e NC Beauty compõem e registram em shadow mode; a entrega é suprimida no `send-message-job`. A Vitalli está travada em dois níveis (`paused` + `automated_reengagement_paused`).

## 3. O que precisa ser auditado

O gatilho é a política única em `clinic-automation-policy.ts`: clínica `active` com `autoReplyEnabled` recebe **todos** os cinco crons, sem distinção. As perguntas abertas:

1. **Cada tipo cabe em cada negócio?** "Maycon bordados" é ateliê de bordado, não clínica. Retomada de conversa faz sentido; lembrete de consulta D-1 e follow-up pós-atendimento provavelmente não. Hoje não há como desligar um sem desligar todos.

2. **A cadência está certa?** `recovery-campaign` roda duas vezes por dia (12h e 21h). Para uma clínica de baixo volume isso pode ser insistente; para uma de alto volume, pouco.

3. **O texto está adequado ao segmento?** Os prompts falam em "paciente", "consulta", "avaliação". Em clínica de estética funciona; em ateliê de costura, não.

4. **Post-appointment a cada 30 minutos** é a maior frequência do sistema. Vale confirmar se o volume justifica.

5. **`recovery-campaign` compõe com `gpt-4o-mini` e não registrava custo** — corrigido no caminho manual (PR #231), mas o cron ainda não registra. Enquanto isso o gasto dele segue invisível.

## 4. Como auditar

Para cada clínica ativa, e para cada um dos cinco crons:

- Ler 3 mensagens reais já enviadas daquele tipo (ou compor em shadow mode).
- Julgar: cabe no negócio? o tom está certo? a frequência é adequada?
- Registrar a decisão: **manter · ajustar texto · desligar para esta clínica**.

O item "desligar para esta clínica" hoje **não tem mecanismo** — a política é tudo ou nada. Se a auditoria concluir que algum tipo precisa ser desligado individualmente, isso vira trabalho de produto: um controle por tipo de automação, no painel do owner.

## 5. Ordem sugerida

1. Ximendes primeiro — é a única enviando de verdade.
2. Maycon bordados — o caso mais provável de desalinhamento (não é clínica).
3. NC Beauty e Vitalli antes de saírem do shadow / da pausa.

## Relacionado

- `src/application/automation/clinic-automation-policy.ts` — a política binária
- `src/application/channel-safety/reengagement-policy.ts` — o freio por clínica
- `docs/product/channel-safety-engine-refinado.md`
