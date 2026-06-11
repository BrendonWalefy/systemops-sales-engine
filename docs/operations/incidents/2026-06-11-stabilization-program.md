# Programa de Estabilização — Custo Zero (2026-06)

Status: ativo
Documento-irmão: `2026-06-11-whatsapp-pipeline-stability.md` (handoff do passe de contenção, mantido pelo agente executor)
Remover este documento da árvore quando o programa for concluído, conforme política de `docs/README.md`.

## Papel deste documento

- O **handoff do incidente** é a fonte de verdade do passe de contenção em execução (branch `fix/whatsapp-incident-stability`): achados de código, ordem de mudanças, estado da execução.
- **Este documento** registra o programa completo de estabilização — o que vem depois da contenção, os critérios de aceite por fase e o gate de reativação da Ximendes, que é o critério de "pronto" do programa inteiro.
- Se a sessão do agente executor for perdida, uma nova sessão retoma lendo: (1) o handoff do incidente, (2) este documento, (3) `docs/architecture/target-architecture.md`.

## Contexto de negócio (por que isso existe)

- O dono da Ximendes **desligou a IA** (~04/06; última mensagem de agent em 2026-06-04 13:18 UTC) por respostas ruins, erradas, duplicadas, sem sentido e atropelando o atendimento. Não foi pane técnica — foi perda de confiança do cliente pagante.
- Desde então a recepção atende 100% manual (108 mensagens entre 08-09/06, zero de agent).
- ⚠️ Em 2026-06-11 00:06 UTC a linha da clínica foi atualizada e `auto_reply_enabled` estava **true**. Decidir conscientemente: manter desligado até o gate de reativação, ou assumir o risco de um lead novo cair na IA sem as correções. → **Decidido em 2026-06-11**: religação antecipada texto-only com autorização do dono — ver "Exceção operacional" na seção do Gate.
- Restrição do programa: **custo recorrente adicional R$ 0** (Vercel Hobby + Neon Free + pinger externo gratuito tipo cron-job.org).

## Mapa queixa → causa confirmada → correção

| Queixa do dono | Causa confirmada em produção | Onde corrige |
| --- | --- | --- |
| Respostas duplicadas | Eco do envio reingerido como lead (dedup heurístico falha em multi-parte/mídia/follow-up) + debounce fixo de 3s perde bursts de 4-6s | Contenção F3 + Passe 2 |
| Sem sentido / falando sozinha | IA respondendo ao próprio eco e a alertas internos enviados ao `receptionistPhone` | Contenção F1 + F3 |
| Atropelando | Flood de follow-ups (14 em ~50s em 10/06 07:01 BRT; unicidade inclui `dueAt`, então nunca colide; dispatcher sem cap) + resposta velha saindo após o assunto mudar | Contenção F2 + Passe 2 |
| Erradas | TTS lendo estrutura visual; lead recorrente tratado como novo | Passe 2 (TTS) + Passe 3 |

Evidências detalhadas (ids de conversa, clinic ids, números): seção "Evidence Snapshot" do handoff do incidente.

## Estrutura do programa

### Passe 1 — Contenção (EM EXECUÇÃO — ver handoff)

Fases 1-4 do handoff: bloqueio de alertas internos no webhook, ciclo de vida de follow-up (substituir pendente por lead+reason, cap de 1 por lead por run), persistência exata de outbound com `externalId` por parte enviada, testes + replay via rota QA.

Critério de aceite do passe: os três loops confirmados (auto-conversa, flood, alerta interno) não são mais reproduzíveis na BW Odontologia.

### Passe 2 — Durabilidade e latência (após contenção)

1. **Inbox/Outbox no Postgres**: tabelas `inbound_events` (dedupe_key = provider+provider_message_id, processing_status, error_stage, trace_id, received_at/claimed_at/processed_at) e `outbound_messages` (status, retry_count, provider_message_id por parte). Webhook: persistir → 200 → processar com claim atômico (`UPDATE ... WHERE status='pending' RETURNING`). Contratos conforme `docs/architecture/target-architecture.md`.
   - Aceite: reprocessar o mesmo evento não duplica resposta; processo morto no meio fica rastreável e recuperável; nenhum envio sem rastro no banco.
2. **Sweep + pinger externo**: endpoint protegido `/api/sweep` que reprocessa eventos presos, reenvia outbounds falhados, libera claims stale e roda SLA check (conversa `needsAttention`/pausada sem resposta humana > X min → push de reforço). Pinger gratuito a cada 5 min (Vercel Hobby não dá cron sub-diário; verificar no painel quais dos 5 crons de `vercel.json` executam de fato).
   - Aceite: job travado não fica invisível; é possível responder "a clínica está sem lead, sem webhook ou sem resposta da IA?" em minutos.
3. **Saída assíncrona + debounce adaptativo + freshness**: envio (incl. polling de status de mídia) fora do caminho crítico via outbox; debounce só espera quando há sinal real de burst; imediatamente antes do envio, se chegou inbound mais novo, cancelar ou fundir a resposta.
   - Aceite: texto simples responde rápido; burst real consolida; resposta velha não sai depois que o lead mudou de assunto.
4. **Higiene de TTS**: separar `displayText` de `spokenText`; nunca TTS para menu, slots, listas, captions, multi-parte ou respostas longas; fallback para texto em falha.
   - Aceite: áudio só em respostas curtas e naturais.

### Passe 3 — Comportamento e visibilidade

1. BEHAV-004: múltiplos "oi" sem progresso → pergunta direta e depois escalação (campo por clínica com default no schema).
2. BEHAV-002: resumo mínimo de histórico para lead recorrente no contexto do classifier/composer.
3. BUG-003 (Reset ignorado): fix conforme causa raiz apurada.
4. Painel operacional em /owner: eventos por status, replay seguro, conversas pausadas vencidas, health por clínica (última inbound/outbound, evento pendente mais antigo).
   - Aceite: diante de problema, o time sabe onde olhar em < 5 minutos.

### Gate de Reativação — Ximendes (critério de pronto do programa)

A IA da Ximendes só religa quando **todos** os itens abaixo forem verdadeiros:

1. BW Odontologia rodando com as correções por 3-5 dias sem auto-conversa, sem duplicata, sem flood (medível pelo painel/queries abaixo).
2. Suite de simulate passando, com os padrões reais das conversas Ximendes (`src/__tests__/XimendesConversationPatterns.test.ts` expandida com os casos novos).
3. Conversa com o dono ANTES de religar: mostrar o que foi corrigido e combinar rollout controlado (ex.: IA só em leads novos na 1ª semana, recepção observando, relatório diário).
4. Pós-reativação: 14 dias estáveis = programa concluído.

#### Exceção operacional registrada em 2026-06-11

- com autorização explícita da Ximendes para avaliar comportamento real, a clínica foi religada antes do gate completo
- BW Odontologia e Ximendes Odontologia ficaram com `autoReplyEnabled = true` e `voiceResponseEnabled = false`
- não havia follow-ups pendentes em nenhuma das duas clínicas no momento da religação
- esta decisão não substitui o Passe 2; apenas antecipa a observação real em produção texto-only

## Guardrails de execução

- Migrations só via `npm run db:generate` + `npm run db:migrate`. Nunca `drizzle-kit push` em produção.
- Cada fase = PR pequeno com `npm run verify` verde e testes novos em `src/__tests__`.
- Todo limite novo (debounce, cap de follow-up, denylist, SLA) é **campo por clínica com default no schema** — nunca hardcoded.
- Um dono de execução por vez. Trabalho paralelo só em fases que não tocam webhook/schema.

## Queries de verificação independente (rodar no banco de produção após cada deploy)

```sql
-- Auto-conversa: texto de agent reaparecendo como lead na mesma conversa em < 10s
SELECT m2.conversation_id, m1.sent_at, m2.sent_at, left(m1.body, 60)
FROM messages m1 JOIN messages m2
  ON m2.conversation_id = m1.conversation_id
 AND m1.author = 'agent' AND m2.author = 'lead'
 AND m2.body = m1.body
 AND m2.sent_at BETWEEN m1.sent_at AND m1.sent_at + interval '10 seconds'
WHERE m1.sent_at > now() - interval '24 hours';

-- Flood de follow-up: mais de 1 follow-up enviado por conversa por dia
SELECT lead_id, date(completed_at), count(*) FROM follow_ups
WHERE status = 'done' AND completed_at > now() - interval '7 days'
GROUP BY 1, 2 HAVING count(*) > 1;

-- Health por clínica: última inbound/outbound
SELECT cl.slug, max(m.sent_at) FILTER (WHERE m.author = 'lead') AS last_lead,
       max(m.sent_at) FILTER (WHERE m.author = 'agent') AS last_agent
FROM clinics cl
LEFT JOIN conversations cv ON cv.clinic_id = cl.id
LEFT JOIN messages m ON m.conversation_id = cv.id
GROUP BY cl.slug;
```

## Checklist de verificação final (pós-implementação)

Pontos levantados em revisão de código das fases do passe de contenção. Verificar todos antes do gate de reativação da Ximendes.

### Da Fase 1 — bloqueio de alertas internos (revisada e aprovada, 561 testes verdes)

1. **Acoplamento por texto:** os padrões de `InternalWhatsAppOperationalMessage.ts` estão acoplados aos templates do Orchestrator (linhas ~919 e ~2441). Se alguém editar o template do alerta, o filtro para de funcionar em silêncio. Verificar: extrair templates para fonte única compartilhada com o matcher, ou teste que valida o template real contra o filtro.
2. **Mudança sutil:** `fromMe` de instância não mapeada agora retorna 500 (antes 200 silencioso) → Z-API retenta. Confirmar ausência de retries ruidosos nos logs.

### Da Fase 2 — ciclo de vida de follow-up (revisada, 563 testes verdes)

3. **Cap por run pressupõe cron diário:** "1 follow-up por lead por run" funciona hoje (dispatcher 1x/dia). Quando o sweep de ~5 min entrar (Passe 2), converter para cap por lead por dia, campo por clínica com default no schema.
4. ✅ **RESOLVIDO em `1b92a15`** (commits `1b92a15` + `12dd1dc` + `082cc53`, pushed em 2026-06-11) — follow-ups pendentes agora são cancelados quando o lead reengaja por inbound e quando entra novamente em fluxo de agendamento/appointment `scheduled|confirmed`. A regra foi centralizada no repositório/use case de follow-up e conectada ao `RegisterIncomingMessage`, `BookingService` e `updateAppointment`. ⚠️ Pontos de atenção da revisão desta etapa: itens 10-14 abaixo.
5. **cancel+insert não atômico no scheduleFollowUp:** bursts simultâneos podem deixar 2 pendings (mitigado pelo cap do dispatcher). Garantia estrutural: unique index parcial `(lead_id, reason) WHERE status = 'pending'`.

### Da Fase 3 — persistência exata de outbound (revisada, 563 testes verdes)

6. **Janela de corrida residual:** echo chega 0,2-4s após o envio; se o insert da parte ainda não commitou quando o echo chega, reingere como lead. Correção estrutural só com outbox pré-persistido antes do send (Passe 2). Monitorar com a query de auto-conversa por 48h na BW após deploy.
7. **Corpo de mídia mudou** de `🎥 título` para `título` + `mediaUrl`/`mediaType` preenchidos. Verificado por grep que nada depende do prefixo fora dos arquivos alterados; confirmar renderização no Inbox após deploy.
8. **Echo dedup por ID por parte:** validar em produção com replay QA — fluxo com vídeo intercalado deve gerar zero reingestão (query de auto-conversa zerada).

### Achado pós-deploy (2026-06-11, URGENTE — vai para o executor)

9. ✅ **RESOLVIDO em `b7e2c5a`** — `autoReplyEnabled` agora é respeitado pelos crons de follow-up e lembrete D-1 via `clinic-automation-policy.ts` (o follow-up pendente da Bianca havia sido cancelado manualmente como contenção, id 4d3503a3). Duas consequências operacionais registradas:
   - **Lembrete D-1 da Ximendes está DESLIGADO** junto com a IA (modo seguro assumido). A recepção precisa saber que os lembretes de consulta agora são manuais até a reativação. → **Revertido em 2026-06-11 com a religação (`1d083cf`)**: lembretes D-1 voltam a ser automáticos a partir do cron das 13h UTC. Avisar a recepção para NÃO duplicar lembrete manual. Em 11/06: 0 consultas elegíveis na janela, cron será no-op.
   - **Follow-ups ficam pendentes (não cancelados) enquanto a clínica está off.** Com a IA desligada nada novo é criado, mas adicionar ao gate de reativação: revisar/cancelar pendentes antigos antes de religar.

### Da etapa "cancelamento no reengajamento" (commits `1b92a15`..`082cc53`, revisada em 2026-06-11, 569 testes verdes)

10. ✅ **RESOLVIDO em `main` (2026-06-11)** — o inbound agora cancela apenas follow-ups de reengajamento (`video_sent:*`, "Lead inativo — segunda chance" e "Lead não compareceu à consulta"), preservando "Retorno de rotina" de 6 meses. Coberto por teste em `RegisterIncomingMessageRace.test.ts`.
11. ✅ **RESOLVIDO em `main` (2026-06-11)** — o cancel de follow-up no inbound virou efeito não-crítico com `try/catch` + `warn`; falha no UPDATE não derruba mais o registro da mensagem inbound. Coberto por teste em `RegisterIncomingMessageRace.test.ts`.
12. **[MÉDIA] Call sites do BookingService sem followUpRepo:** `appointments/[id]/route.ts` (linhas ~76 e ~159) constrói `BookingService` sem o repositório de follow-up — rebooking/edição por essa rota não cancela pendentes nem agenda o retorno. Verificar se a rota deve injetar `DrizzleFollowUpRepository` como as demais.
13. **[BAIXA] `cancelPendingByLead` não cobre status `sending`:** se o dispatcher já fez o claim (pending→sending) quando o lead reengaja, aquele follow-up sai mesmo assim. Janela pequena (cron 1x/dia hoje), CAS evita duplo envio; reavaliar quando o sweep de ~5 min entrar.
14. **[BAIXA] Replay QA roda contra produção e deixa resíduo:** `bw-incident-replay` usa o banco de produção (via `.env.local`); `cleanPhoneState()` limpa no INÍCIO de cada cenário, então o último cenário deixa lead/conversa/mensagens QA no banco (ex.: lead "BW Replay Echo", conv `be4704c6`, extIds `echo-*`, criados às 07:16 UTC de 11/06). Risco: cron de stale-conversations pode agir sobre esse resíduo, e as queries de monitoramento ficam poluídas. Adicionar cleanup no FINAL do replay ou rodar `cleanPhoneState` manualmente após cada execução.

### Baseline pós-deploy do passe de contenção (2026-06-11 ~04:15 BRT, commit 97ce569)

- Query auto-conversa (24h): zero casos por match exato — ressalva: pré-fix os corpos das partes não coincidiam (era o próprio bug), então a query só é conclusiva DEPOIS do fix. Usar a versão com prefixo abaixo.
- Flood histórico confirmado: lead 13e7f557 com 18 follow-ups "done" em 10/06 (o burst das 07:01). Pós-fix, cap = 1/lead/run.
- Pendentes após limpeza: apenas 1 (BW, video_sent — vai validar o caminho novo no run das 10h UTC).
  - ⚠️ **Invalidado às 07:16 UTC:** o run do `bw:incident-replay` contra produção deletou o lead QA via `cleanPhoneState()` — levou junto o pendente `video_sent` e os 18 "done" do flood histórico (a tabela `follow_ups` da BW ficou vazia). O cron das 10h UTC de 11/06 será um no-op (zero pendentes due em todas as clínicas); a validação orgânica do caminho novo fica para o próximo follow-up real criado na BW.

### Checkpoint de monitoramento 48h (2026-06-11 07:45 UTC)

- `npm run bw:stability -- 48`: auto-conversa 0 casos (exato e prefixo), flood 0, BW `autoReplyEnabled=true`.
- Ressalva: ainda **sem tráfego orgânico pós-deploy** na BW (última inbound real 03:03 UTC, anterior ao deploy ~07:15 UTC) — o relógio das 48h só conta de verdade a partir do primeiro tráfego real.
- Ximendes: `autoReplyEnabled=false` confirmado, zero follow-ups pendentes (Bianca `4d3503a3` cancelado).
- Resíduo QA em produção: lead "BW Replay Echo" (fone 5511953628848), conv `be4704c6`, 2 mensagens agent com extId `echo-*` — ver item 14 do checklist.

### Checkpoint pós-religação texto-only (2026-06-11 ~08:05 UTC)

- Confirmado no banco: BW e Ximendes com `autoReplyEnabled=true` + `voiceResponseEnabled=false`; zero follow-ups pendentes em todas as clínicas.
- Ximendes ainda **sem tráfego** desde 09/06 23:24 UTC — a avaliação real começa no primeiro inbound pós-religação.
- Lembrete D-1 de hoje (13h UTC): 0 consultas Ximendes na janela +20h/+32h → no-op. A partir de amanhã os lembretes saem automáticos (avisar recepção).
- **Riscos conscientemente abertos com a religação antecipada** (aceitos pela exceção operacional, monitorar de perto):
  - janela de corrida do echo pré-commit (item 6) — só fecha com outbox do Passe 2;
  - debounce fixo de 3s perde bursts de 4-6s (causa confirmada de resposta duplicada) — só fecha no Passe 2;
  - item 10 (inbound cancela "Retorno de rotina") agora vale para tráfego real das duas clínicas.
- Observação: existe uma terceira linha em `clinics` com slug `null` e `autoReplyEnabled=true` (provável demo). Sem pendentes/tráfego, mas com o kill switch agora honrado vale dar slug ou desligar a flag para não entrar nos crons por acidente.
- Monitor automático armado para os crons de 10h UTC (follow-up dispatcher) e 13h UTC (lembrete D-1) cobrindo as duas clínicas + query de auto-conversa.

Query de auto-conversa melhorada (pega eco de parte truncada, não só match exato):

```sql
SELECT m2.conversation_id, m1.sent_at, m2.sent_at, left(m2.body, 50)
FROM messages m1 JOIN messages m2
  ON m2.conversation_id = m1.conversation_id
 AND m1.author = 'agent' AND m2.author = 'lead'
 AND length(m2.body) >= 20
 AND left(m1.body, length(m2.body)) = m2.body
 AND m2.sent_at BETWEEN m1.sent_at AND m1.sent_at + interval '10 seconds'
WHERE m1.sent_at > now() - interval '24 hours';
```

## Estimativa e limites conhecidos

- Prazo: 8,5-10 dias úteis (contenção ~2-3; durabilidade ~4-5; comportamento+painel ~2).
- Fora de escopo: qualidade editorial fina, Google Meu Negócio, migração Z-API→Meta, infra AWS (destino futuro em `docs/architecture/aws-target-architecture.md`; entrar pela Opção A quando houver 4-5+ clínicas).
- Primeira parede de custo real da stack atual: Neon Free (100 CU-hours/mês) com ~4-5 clínicas ativas → Neon Launch (~US$ 19/mês).
