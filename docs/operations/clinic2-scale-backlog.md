# Backlog de Escala — Clínica 2

Atualizado em: 2026-06-14  
Branch de execução atual: `feat/clinic2-scale-foundation`

## Objetivo

Escalar o SystemOps da clínica piloto para a segunda clínica sem quebrar a operação atual, reduzindo dependência de configuração manual e melhorando previsibilidade comercial, onboarding e monitoramento.

## Decisões já tomadas

- A landing oficial passará a usar a base visual do projeto `dental-sync-bot`.
- A `systemops-landing` entra em descontinuação planejada. Só reaproveitamos conteúdo útil.
- O onboarding comercial e operacional deve convergir para um único fluxo de `Clinic Blueprint`, reutilizável em desktop, tablet e celular.
- A prioridade inicial é corrigir riscos operacionais e bugs P0 antes de mudanças maiores de arquitetura.

## P0 — Segurança operacional imediata

### Comercial e oferta

- [ ] Unificar preços, planos e copy comercial em uma única fonte de verdade.
- [ ] Migrar a landing oficial para a base `dental-sync-bot`.
- [ ] Ajustar pricing público para a estratégia atual:
  - `Essencial`: R$ 897/mês
  - `Clínica`: R$ 1.497/mês
  - `Rede`: sob consulta ou R$ 2.997/mês
- [ ] Trocar CTA placeholder da landing por fluxo real de diagnóstico/demo.
- [ ] Descontinuar a `systemops-landing` como origem de oferta pública.

### Bugs e gaps críticos do core

- [x] Corrigir bug do wizard de onboarding que pode excluir tratamentos indevidamente.
- [x] Corrigir query de playbook ativo na tela de sugestões.
- [x] Aplicar gate de validação também na ativação manual de playbook.
- [x] Impedir que clínica nova entre como receita ativa por default sem confirmação comercial.
- [x] Adicionar `isActive` ou status operacional equivalente para filtrar crons e clínicas incompletas.

### Onboarding mínimo seguro

- [x] Expandir criação de clínica para pedir status comercial e operacional mínimo:
  - plano
  - billing status
  - ambiente teste/produção
  - modo de calendário
  - telefone da recepção
- [x] Criar checklist obrigatório de go-live.

## P1 — Blueprint de clínica

- [x] Criar a primeira leitura de prontidão do `Clinic Blueprint` no painel owner.
- [x] Evoluir a primeira versão do onboarding para funcionar como rascunho vivo do `Clinic Blueprint`.
- [ ] Permitir uso durante reunião comercial em múltiplos dispositivos.
- [ ] Suportar modo rascunho antes do go-live.
- [ ] Estruturar o blueprint em blocos:
  - Identidade
  - Canal
  - Agenda
  - Profissionais
  - Tratamentos
  - Política comercial
  - Objeções
  - Handoff
  - Mídia
  - TTS
  - Pipeline
- [ ] Gerar resumo final de implantação a partir do blueprint.

## P1.5 — Padronização do playbook

- [ ] Reduzir dependência de `notes` livre para regras estruturadas.
- [ ] Tornar `receptionistName` explícito no schema editorial.
- [ ] Validar consistência entre tratamentos, pipeline e playbook antes de publicar.
- [ ] Eliminar seeds artesanais como caminho principal de configuração.

## P2 — Monitoramento e operação

- [x] Transformar `/api/health` em healthcheck real.
- [x] Adicionar alertas ativos para falhas de webhook, cron e qualidade.
- [x] Notificação externa por email (digest diário 9h UTC via Resend).
- [x] Diferenciar claramente clínicas `prospect`, `test`, `active`, `paused`, `cancelled`.
- [x] Criptografar credenciais por clínica.

## P3 — Arquitetura de escala

- [ ] Implementar `webhook fino -> inbox -> fila -> worker -> outbox -> sender`.
- [ ] Manter no mesmo repositório por enquanto.
- [ ] Executar a arquitetura em slices pequenas seguindo `docs/operations/event-driven-modernization-plan.md` e `docs/operations/event-driven-modernization-checkpoints.md`.
- [ ] Começar por Postgres queue e outbox antes de qualquer mensageria externa.
- [ ] Tratar realtime barato e observabilidade como parte da mesma modernização, não como trabalho paralelo.

## Ordem recomendada de execução

1. Fixes P0 do core
2. Correção da oferta comercial e landing oficial
3. Reforço do onboarding mínimo seguro
4. Construção do `Clinic Blueprint`
5. Monitoramento ativo
6. Arquitetura assíncrona

## Próxima fatia sugerida

- Criar conta Resend + domínio verificado e adicionar `RESEND_API_KEY` + `RESEND_FROM_EMAIL` ao Vercel para ativar o digest em produção.
- Revisar o que entra ou não em KPIs financeiros/comerciais para `paused`, `prospect` e `cancelled`.
- Blueprint em modo rascunho formal com suporte multi-dispositivo (P1).
- Padronização do playbook — reduzir `notes` livre para regras estruturadas (P1.5).
- Arquitetura fila/worker quando houver 2+ clínicas ativas (P3).
