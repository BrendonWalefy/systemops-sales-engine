# Onboarding de novo cliente (receita de bolo)

Este guia adiciona qualquer tenant ao ambiente multi-tenant — clínica, ateliê,
loja de cortinas, estética etc. Cada tenant tem suas próprias credenciais de
canal (WhatsApp), seu próprio playbook ativo e seus próprios admins. Nenhum
dado de um tenant é visível para outro.

> **Aviso de segurança operacional:** se o cliente começar a enviar mensagens
> pelo WhatsApp ANTES do onboarding ser concluído, o sistema vai retornar
> `clinic_not_resolved` e logar um erro 500 para cada mensagem. O webhook é
> ativado automaticamente quando a instância Z-API aponta para a URL — então
> **finalize o onboarding antes de configurar o webhook no painel Z-API**.

## Pré-requisitos (uma vez por ambiente)

Garanta que `main` esteja deployada e que `npm run db:migrate` já tenha sido
rodado no ambiente. O histórico de migrations atual parte de
`drizzle/0000_baseline.sql`.

## 1. Monte o JSON do tenant

O campo `segment` determina o vocabulário que a IA usa. Escolha o template
correto abaixo e salve como `novo-cliente.json`.

### Clínica ou estética

```json
{
  "name": "Clínica Exemplo",
  "slug": "clinica-exemplo",
  "segment": "dental",
  "specialty": "odontologia",
  "timezone": "America/Sao_Paulo",
  "businessHours": "Seg-Sex 09:00-18:00",
  "greetingMessage": "Olá! Seja bem-vindo à Clínica Exemplo.",
  "channel": {
    "provider": "z_api",
    "zapi": {
      "instanceId": "INSTANCIA_Z_API",
      "token": "TOKEN_DA_INSTANCIA",
      "clientToken": "CLIENT_TOKEN_OPCIONAL"
    }
  },
  "playbook": {
    "commercialPolicy": "Aceitamos PIX, débito e crédito em até 12x.",
    "toneOfVoice": "acolhedor e profissional",
    "differentials": ["Atendimento humanizado", "Equipamentos de ponta"],
    "objections": [
      { "objection": "Está caro", "response": "Temos parcelamento em até 12x." }
    ],
    "notes": "Confirmar o procedimento antes de oferecer horário."
  },
  "procedures": [
    { "name": "Limpeza", "durationMinutes": 60, "requiresEvaluationFirst": true }
  ],
  "admins": [
    { "email": "dono@clinicaexemplo.com.br", "password": "senha-inicial-forte", "role": "clinic_admin" }
  ]
}
```

### Ateliê de costura / bordado / uniformes

A IA vai se apresentar como "atendente virtual", usar "pedido" e "entrega" em
vez de "consulta", e não vai acionar regras de urgência clínica (dor, sangramento etc.).

```json
{
  "name": "Ateliê Exemplo",
  "slug": "atelie-exemplo",
  "segment": "atelier",
  "specialty": "uniformes e bordados",
  "timezone": "America/Sao_Paulo",
  "businessHours": "Seg-Sex 09:00-18:00",
  "greetingMessage": "Olá! Seja bem-vindo ao Ateliê Exemplo. Como posso ajudar?",
  "channel": {
    "provider": "z_api",
    "zapi": {
      "instanceId": "INSTANCIA_Z_API",
      "token": "TOKEN_DA_INSTANCIA",
      "clientToken": "CLIENT_TOKEN_OPCIONAL"
    }
  },
  "playbook": {
    "commercialPolicy": "Trabalhamos com pedido mínimo de 10 peças. Aceitamos PIX e transferência.",
    "toneOfVoice": "atencioso e objetivo",
    "differentials": ["Bordado computadorizado", "Entrega em até 15 dias úteis"],
    "objections": [
      { "objection": "Prazo muito longo", "response": "Para pedidos urgentes, temos modalidade express com acréscimo de 30%." }
    ],
    "notes": "Sempre perguntar: tipo de peça, quantidade, arte/logo disponível e prazo desejado."
  },
  "procedures": [
    { "name": "Uniforme bordado", "durationMinutes": 0, "description": "Camisa, calça ou jaleco com bordado" },
    { "name": "Camiseta personalizada", "durationMinutes": 0, "description": "Sublimação ou serigrafia" }
  ],
  "admins": [
    { "email": "dono@atelieexemplo.com.br", "password": "senha-inicial-forte", "role": "clinic_admin" }
  ]
}
```

### Loja de cortinas / persianas

```json
{
  "name": "Loja Exemplo",
  "slug": "loja-cortinas-exemplo",
  "segment": "cortinas",
  "specialty": "cortinas e persianas",
  "timezone": "America/Sao_Paulo",
  "businessHours": "Seg-Sex 09:00-18:00, Sab 09:00-13:00",
  "greetingMessage": "Olá! Seja bem-vindo à Loja Exemplo.",
  "channel": {
    "provider": "z_api",
    "zapi": {
      "instanceId": "INSTANCIA_Z_API",
      "token": "TOKEN_DA_INSTANCIA",
      "clientToken": "CLIENT_TOKEN_OPCIONAL"
    }
  },
  "playbook": {
    "commercialPolicy": "Orçamento gratuito com visita técnica. Instalação inclusa no preço.",
    "toneOfVoice": "consultivo e sofisticado",
    "differentials": ["Medição e instalação inclusa", "Mais de 300 tecidos disponíveis"],
    "objections": [
      { "objection": "Muito caro", "response": "Temos opções em vários preços. Posso agendar uma visita para mostrar as opções?" }
    ],
    "notes": "Perguntar: ambiente (sala, quarto, escritório), metragem aproximada, preferência de tecido ou persiana."
  },
  "procedures": [
    { "name": "Visita de orçamento", "durationMinutes": 60, "description": "Medição e apresentação de opções no local" }
  ],
  "admins": [
    { "email": "dono@lojaexemplo.com.br", "password": "senha-inicial-forte", "role": "clinic_admin" }
  ]
}
```

Para Meta Cloud API em vez de Z-API, troque o bloco `channel`:

```json
"channel": {
  "provider": "meta_cloud_api",
  "meta": {
    "phoneNumberId": "PHONE_NUMBER_ID",
    "accessToken": "TOKEN",
    "appSecret": "META_APP_SECRET"
  }
}
```

O `appSecret` é obrigatório: o endpoint valida `x-hub-signature-256` antes de
aceitar mensagens ou status. Access Token e App Secret são criptografados em
repouso e nunca são hidratados de volta no browser do onboarding.

## 2. Rode o onboarding

```bash
npx dotenv -e .env.local -- npx tsx scripts/create-clinic.ts ./clinic-nova.json
```

O script é idempotente pelo `slug`: rodar de novo atualiza a clínica e
republica o playbook em vez de duplicar. Ele imprime o `clinicId` ao final.

## 3. Aponte o canal para o ambiente

- **Z-API**: no painel da instância da clínica, configure o webhook de
  mensagens recebidas para `https://SEU_DOMINIO/api/whatsapp/zapi`. O
  roteamento usa o `instanceId` do payload para achar a clínica.
- **Meta**: configure o webhook para `https://SEU_DOMINIO/api/whatsapp/webhook`.
  O roteamento usa o `phone_number_id` do payload.

## 4. Ative a IA (passo que falta por padrão)

`create-clinic.ts` sempre cria a clínica com `autoReplyEnabled = false` — é uma trava de
segurança proposital, mas **se você não completar este passo, o cliente entra em
produção com a IA muda**. Ligue a IA pela UI (`/app/settings/playbook`, toggle de
resposta automática) como org_admin da clínica nova — isso também move
`operationalStatus` para `active`, que é o gate real que libera resposta automática
(ver `src/application/automation/clinic-automation-policy.ts`). Confirme os dois campos
antes de considerar a clínica pronta:

- [ ] `organizations.autoReplyEnabled = true`
- [ ] `organizations.operationalStatus = "active"` (clínicas com `isTest = true` nunca
      chegam em `active` — isso é esperado só para piloto/QA, não para cliente pagante)

## 5. Checklist de teste (faça ANTES de liberar para o cliente)

Roteamento e isolamento são o que não pode falhar com duas clínicas:

- [ ] Login como o admin da clínica nova → vê só os dados dela (inbox, agenda,
      dashboard, settings).
- [ ] Login como admin de outra clínica → continua vendo só os dados dela.
- [ ] Mande uma mensagem para o WhatsApp da clínica NOVA → a conversa aparece
      na clínica nova, e a resposta sai pelo número da clínica nova.
- [ ] Mande uma mensagem para o WhatsApp de outra clínica → idem, sem
      vazamento entre as duas.
- [ ] Publique uma alteração no playbook da clínica nova → o WhatsApp dela
      reflete; o da outra clínica não muda.
- [ ] Tente publicar um playbook com política comercial vazia → a publicação
      deve FALHAR (gate de validação).
- [ ] Rode o cron de lembrete manualmente → o retorno traz `perClinic` com as
      duas clínicas.

## Diagnóstico: erro `clinic_not_resolved` (500 no webhook)

Se os logs da Vercel mostrarem erros 500 em `POST /api/whatsapp/zapi` com a
mensagem `clinic_not_resolved`, significa que mensagens estão chegando de uma
instância Z-API que não está cadastrada no banco.

Os logs agora mostram o `instanceId` que chegou. Para resolver:

**1. Confirme qual instância está batendo:**

Nos logs da Vercel, procure o campo `instanceId` no erro. Ex:
```
"instanceId": "3B4C9D1E2F..."
```

**2. Verifique se o tenant já existe no banco:**
```sql
SELECT id, name, zapi_instance_id FROM clinics WHERE zapi_instance_id = '3B4C9D1E2F...';
```

**3a. Se o tenant não existe** — onboarding não foi feito. Monte o JSON e rode:
```bash
npx dotenv -e .env.local -- npx tsx scripts/create-clinic.ts ./novo-cliente.json
```

**3b. Se o tenant existe mas com instanceId diferente** — o webhook está
configurado com a instância errada no painel Z-API, ou o JSON de onboarding
usou o `instanceId` incorreto. Corrija o campo `zapi_instance_id` no banco:
```sql
UPDATE clinics SET zapi_instance_id = '3B4C9D1E2F...' WHERE slug = 'slug-do-cliente';
```

**O que aconteceu com Maycon Bordados (2026-06-30):** o cliente foi conectado
ao Z-API e começou a receber/enviar mensagens antes do onboarding estar
registrado no banco. Cada mensagem gerou um erro 500. Nenhuma resposta da IA
chegou ao cliente. Correção: rodar o script de onboarding com o JSON do ateliê.

---

## Pontos conhecidos a endurecer antes de escala maior

- **As credenciais já são criptografadas em repouso**, mas continuam sendo
  operadas pela aplicação. Se o volume de tenants crescer muito, vale avaliar
  vault dedicado para governança operacional.
- **Owner ainda é por env** (`OWNER_EMAIL`/`OWNER_PASSWORD`). Admins de clínica
  já vivem em `clinic_members.password_hash`.
- **Módulos por plano** são sincronizados automaticamente no onboarding. Se o
  plano for `custom`, revise manualmente `/owner/clinics/[clinicId]/modules`
  antes do go-live.
