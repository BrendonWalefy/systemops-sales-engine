# Plano: Setup IA em Abas + Endereço + Produtização

**Contexto:** O editor de playbook em `/app/settings/playbook/[id]` hoje mistura configurações versionáveis (conteúdo conversacional) com configurações fixas da clínica (saudação, horários, comportamento). A proposta é separar em abas, adicionar o campo `address` que falta no schema, e deixar a estrutura pronta para onboarding de novos clientes.

**Objetivo:** Produtizar o Setup IA para que a instalação de uma nova clínica seja clara e autônoma.

**Regra:** Seguir a ordem das etapas abaixo — cada uma é deployável de forma independente.

---

## Etapas em ordem

### 1. Schema + Migration — campo `address` na tabela `clinics`
- [ ] Adicionar `address: text("address")` em `src/infrastructure/db/schema.ts`
- [ ] Rodar `npm run db:generate` e revisar a migration gerada (nunca editar manualmente)
- [ ] Aplicar em produção **antes** do deploy da UI

### 2. Orchestrator — usar `clinic.address` na resposta de Localização
- [ ] Arquivo: `src/core/pipeline/ConversationOrchestrator.ts` (~linha 861-868)
- [ ] No case `general_question` com `subtype: "location"`, incluir `clinic.address` no `clinicContext` passado ao ResponseComposer
- [ ] Garantir que `address` está sendo carregado no objeto `clinic` dentro do Orchestrator

### 3. UI — reorganizar editor em 2 abas no painel esquerdo

**Aba "Playbook"** (versionável — salva em `playbook_versions`):
- 01 Especialidade
- 02 Sobre o procedimento
- 03 Tom de voz
- 04 Diferenciais da Clínica
- 05 Política comercial
- 06 Objeções e respostas

**Aba "Configurações"** (nível clínica — salva em `clinics`):
- Identidade: nome da clínica *(read-only por ora)* + endereço (novo campo)
- Saudação e Menu: textarea `greetingMessage` + preview das 5 opções padrão quando estiver vazio
- Horário de funcionamento
- Comportamento automático: pausa (takeoverTtlHours) + intervalo (postAppointmentBufferMinutes)

**Painel direito** (sticky, independente de aba — sem alteração):
- Sandbox de simulação
- Barra de completude
- Botão "Voltar para versões"
- Indicador de salvamento

### 4. Atualizar `page.tsx` + server action
- [ ] `page.tsx`: adicionar `address` no select da query de `clinics` e em `initialData`
- [ ] `playbook-version-actions.ts` → `updateClinicOperationalSettings`: adicionar `address?: string | null`
- [ ] `EditorData` em `editor-client.tsx`: adicionar campo `address: string`

### 5. Sandbox — alinhar comportamento do menu quando `greetingMessage` vazio
- [ ] Hoje: primeiro contato sem `greetingMessage` chama ResponseComposer com `{ type: "greeting" }` — resposta genérica
- [ ] Em produção: Orchestrator monta o menu de 5 opções diretamente (sem LLM)
- [ ] Corrigir: se `greetingMessage` vazio no sandbox, retornar o texto padrão do menu como primeira resposta simulada (sem chamar o LLM)

---

## Fora do escopo desta entrega

- Edição do nome da clínica pelo admin (fica no painel `/owner`)
- Configuração das 5 opções do menu como campos individuais
- Remoção do `PILOT_CLINIC_ID` hardcoded (expansão multi-tenant — tarefa futura)
- Tela de criação de nova clínica

---

## Ordem de deploy

1. Migration `address` → deploy (sem UI, sem risco)
2. Orchestrator com `clinic.address` → deploy (Localização passa a usar endereço real)
3. UI em abas + campo endereço → deploy (refatoração visual)
4. Sandbox alinhado com menu padrão → deploy (qualidade de simulação)

**Esforço estimado:** ~1 dia. Nenhuma alteração no fluxo de atendimento real além do item 2.
