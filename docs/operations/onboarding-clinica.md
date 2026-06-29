# Onboarding de clínica nova (receita de bolo)

Este guia adiciona uma clínica ao ambiente multi-tenant. Cada clínica tem suas
próprias credenciais de canal (WhatsApp), seu próprio playbook ativo e seus
próprios admins. Nenhum dado de uma clínica é visível para outra.

## Pré-requisitos (uma vez por ambiente)

Garanta que `main` esteja deployada e que `npm run db:migrate` já tenha sido
rodado no ambiente. O histórico de migrations atual parte de
`drizzle/0000_baseline.sql`.

## 1. Monte o JSON da clínica

Crie um arquivo, por exemplo `clinic-nova.json`:

```json
{
  "name": "Clínica Exemplo",
  "slug": "clinica-exemplo",
  "specialty": "estetica",
  "timezone": "America/Sao_Paulo",
  "businessHours": "Seg-Sex 09:00-18:00",
  "greetingMessage": "Olá! Seja bem-vindo à Clínica Exemplo.",
  "channel": {
    "provider": "z_api",
    "zapi": {
      "instanceId": "INSTANCIA_DA_CLINICA",
      "token": "TOKEN_DA_INSTANCIA",
      "clientToken": "CLIENT_TOKEN_OPCIONAL"
    }
  },
  "playbook": {
    "commercialPolicy": "Aceitamos PIX, débito, crédito e parcelamento em até 12x com acréscimos.",
    "toneOfVoice": "acolhedor e profissional",
    "differentials": ["Atendimento humanizado", "Equipamentos de ponta"],
    "objections": [
      { "objection": "Está caro", "response": "Temos parcelamento em até 12x." }
    ],
    "notes": "Sempre confirmar o procedimento de interesse antes de oferecer horário."
  },
  "procedures": [
    { "name": "Limpeza de pele", "durationMinutes": 60, "requiresEvaluationFirst": true },
    { "name": "Botox", "durationMinutes": 45, "description": "Aplicação de toxina botulínica" }
  ],
  "admins": [
    { "email": "dono@clinicaexemplo.com.br", "password": "senha-inicial-forte", "role": "clinic_admin" }
  ]
}
```

Para Meta Cloud API em vez de Z-API:

```json
"channel": {
  "provider": "meta_cloud_api",
  "meta": { "phoneNumberId": "PHONE_NUMBER_ID", "accessToken": "TOKEN" }
}
```

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

## 4. Checklist de teste (faça ANTES de liberar para o cliente)

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

## Pontos conhecidos a endurecer antes de escala maior

- **As credenciais já são criptografadas em repouso**, mas continuam sendo
  operadas pela aplicação. Se o volume de tenants crescer muito, vale avaliar
  vault dedicado para governança operacional.
- **Owner ainda é por env** (`OWNER_EMAIL`/`OWNER_PASSWORD`). Admins de clínica
  já vivem em `clinic_members.password_hash`.
- **Módulos por plano** são sincronizados automaticamente no onboarding. Se o
  plano for `custom`, revise manualmente `/owner/clinics/[clinicId]/modules`
  antes do go-live.
