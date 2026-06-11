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
- ⚠️ Em 2026-06-11 00:06 UTC a linha da clínica foi atualizada e `auto_reply_enabled` estava **true**. Decidir conscientemente: manter desligado até o gate de reativação, ou assumir o risco de um lead novo cair na IA sem as correções.
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

## Estimativa e limites conhecidos

- Prazo: 8,5-10 dias úteis (contenção ~2-3; durabilidade ~4-5; comportamento+painel ~2).
- Fora de escopo: qualidade editorial fina, Google Meu Negócio, migração Z-API→Meta, infra AWS (destino futuro em `docs/architecture/aws-target-architecture.md`; entrar pela Opção A quando houver 4-5+ clínicas).
- Primeira parede de custo real da stack atual: Neon Free (100 CU-hours/mês) com ~4-5 clínicas ativas → Neon Launch (~US$ 19/mês).
