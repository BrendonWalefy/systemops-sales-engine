# Onboarding de organização

Guia operacional para criar e ativar um tenant sem expor dados ou permitir respostas antes da validação.

## Pré-requisitos

- `main` e migrations de produção estão saudáveis;
- responsável, segmento, timezone, horário, serviços e política comercial foram validados;
- número/canal está disponível, mas o webhook ainda não foi apontado para produção;
- credenciais serão inseridas pelo fluxo seguro, nunca em documento ou commit.

## 1. Criar a organização

Use o fluxo do owner (`/owner/clinics/novo` ou onboarding associado) como caminho padrão. O script `npm run create-clinic` existe para operação controlada e exige arquivo local ignorado pelo Git.

Campos mínimos:

- nome, slug, segmento, especialidade e timezone;
- horário comercial e nomenclatura do atendimento;
- admin da organização;
- modo de calendário;
- canal escolhido;
- serviços/tratamentos iniciais;
- playbook editorial.

A organização deve nascer com `autoReplyEnabled=false` e status não produtivo.

## 2. Configurar os donos corretos

| Informação | Onde configurar |
| --- | --- |
| Operação, canal, timezone e limites | `organizations` via owner/onboarding |
| Módulos e voz | `clinic_modules` |
| Conteúdo e política comercial | versão de `playbook_versions` |
| Serviços, duração, aliases, preço e jornada | `treatments` + `pipelineSteps` |
| Profissionais e recursos | `professionals` |
| Usuários e papéis | `clinic_members` |

Não copie política comercial para `notes`, prompt ou script de deploy.

## 3. Conectar o canal

### Z-API

- provisionar/parear pelo owner quando disponível;
- confirmar `instanceId`, token e client token criptografados;
- configurar o webhook em `https://SEU_DOMINIO/api/whatsapp/zapi`;
- validar que o identificador resolve somente a organização esperada.

### Meta Cloud API

- configurar `phoneNumberId`, access token e app secret;
- apontar para `https://SEU_DOMINIO/api/whatsapp/webhook`;
- validar challenge e assinatura `x-hub-signature-256`;
- falhar fechado se o segredo estiver ausente ou inválido.

## 4. Configurar agenda

- `internal`: `appointments` e `calendar_blocks` são a fonte de verdade.
- `google_calendar`: validar calendário, service account, watch e sincronização.

Confirme timezone, horários, duração, buffer, lookahead, profissionais e bloqueios antes de liberar slots. Qualquer importação inicial do Google Calendar ocorre antes do go-live.

## 5. Validar em ambiente seguro

Checklist mínimo:

- [ ] tenant do webhook resolve corretamente;
- [ ] texto, áudio e mídia entram no Inbox;
- [ ] duplicata de webhook não duplica lead, mensagem ou resposta;
- [ ] playbook ativo e catálogo estão corretos;
- [ ] agenda oferece somente slots válidos;
- [ ] booking, cancelamento e remarcação funcionam;
- [ ] handoff pausa a IA e notifica a equipe;
- [ ] resposta sai pela outbox e aparece no histórico;
- [ ] opt-out, quiet hours e caps bloqueiam quando esperado;
- [ ] membros veem apenas a própria organização;
- [ ] replay sanitizado e revisão humana foram aprovados.

Use shadow/observe para capturar operação humana, mas use replay isolado para validar o comportamento completo da IA.

## 6. Go-live

1. publicar o playbook aprovado;
2. confirmar organização `active`;
3. habilitar `autoReplyEnabled`;
4. enviar um smoke controlado de inbound e outbound;
5. acompanhar queue lag, errors, retries, dead letters e channel health;
6. manter responsável disponível durante a janela de observação.

## Rollback

Em comportamento incorreto:

1. desligar `autoReplyEnabled` para o tenant afetado;
2. manter inbound sendo persistido;
3. pausar campanhas/reengajamento se necessário;
4. preservar traces e IDs operacionais sem copiar conteúdo sensível;
5. reverter configuração/playbook ou o menor commit possível;
6. revalidar antes de reativar.

Nunca corrija produção com script one-off versionado contendo nome, telefone, credencial ou ID fixo de cliente.
