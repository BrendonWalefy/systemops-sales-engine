# Guia de Onboarding de Nova Clínica

Este documento guia o processo completo de configurar uma nova clínica no SystemOps — desde a conversa com o dono até a verificação final de que a IA está respondendo corretamente.

**Princípio:** após o refactor de arquitetura (Fases 1-4), nenhum onboarding requer código. Tudo é configuração de banco via UI ou seed.

---

## Parte 0 — Antes da reunião com o cliente

Prepare estas informações internamente antes de conversar com o dono:

- [ ] Você já tem a instância Z-API (ou Meta Cloud API) provisionada para essa clínica?
- [ ] Você já sabe qual plano (Essencial / Clínica / Rede)?
- [ ] Você tem o email que o admin da clínica usará para login?
- [ ] Se for Google Calendar: você tem o Calendar ID?

---

## Parte 1 — Perguntas para o dono da clínica

### Bloco A — Identidade da clínica

| Pergunta | Por quê perguntar | Campo no sistema |
|---|---|---|
| Nome oficial da clínica | Aparece em mensagens da IA | `clinics.name` |
| Especialidade principal | Contexto da IA | `clinics.specialty` |
| Cidade | Contexto geográfico | `clinics.city` |
| Endereço completo (logradouro, número, bairro) | A IA informa ao lead na confirmação de agendamento | `clinics.address` |
| Fuso horário | Cálculo de horários e saudações | `clinics.timezone` (ex: "America/Sao_Paulo") |

### Bloco B — Canal WhatsApp

| Pergunta | Por quê perguntar | Campo no sistema |
|---|---|---|
| Qual o número do WhatsApp da clínica? | Identifica mensagens de entrada | `clinics.zapiInstanceId` |
| Token da instância Z-API | Credencial de envio | `clinics.zapiToken` / `zapiClientToken` |
| Há outro número de WhatsApp da recepção humana? | Quando a IA escala para humano, para qual número vai? | `clinics.receptionistPhone` |

> Se for Meta Cloud API em vez de Z-API: `clinics.channelProvider = "meta_cloud_api"`, `clinics.metaPhoneNumberId`, `clinics.metaAccessToken`.

### Bloco C — Calendário e agendamento

| Pergunta | Por quê perguntar | Campo no sistema |
|---|---|---|
| Usam Google Agenda ou querem usar o calendário interno? | Define como a IA encontra horários livres | `clinics.calendarMode` ("internal" ou "google_calendar") |
| Se Google Agenda: qual o Calendar ID? | Integração com Google | `clinics.googleCalendarId` |
| Qual a duração padrão de uma consulta? | Quando o procedimento não tem duração própria cadastrada | `clinics.defaultAppointmentDurationMinutes` (default: 60 min) |
| Qual o intervalo entre consultas? (buffer pós-atendimento) | Evita agendamento imediatamente após um paciente | `clinics.postAppointmentBufferMinutes` (default: 60 min) |
| Horários de funcionamento? | A IA não oferece slots fora desse horário | `clinics.businessHours` (formato textual, ex: "Seg-Sex 8h-18h, Sáb 8h-12h") |

### Bloco D — Profissionais

Para cada profissional da clínica:

| Pergunta | Campo no sistema |
|---|---|
| Nome completo | `professionals.name` |
| Especialidade | `professionals.specialty` |
| Horários de atendimento (dias e horários por dia) | `professionals.workSchedule` (JSON) |
| Se Google Calendar: ID do calendário pessoal | `professionals.googleCalendarId` |

### Bloco E — Procedimentos oferecidos

Para cada procedimento da clínica:

| Pergunta | Campo no sistema |
|---|---|
| Nome do procedimento (como aparecerá no menu) | `treatments.name` |
| Descrição curta para o lead | `treatments.description` |
| Duração em minutos | `treatments.durationMinutes` |
| Exige avaliação antes do agendamento definitivo? | `treatments.requiresEvaluationFirst` (bool) |
| É um procedimento estético visual? (fotos ajudam a personalizar) | `treatments.isAesthetic` (bool) → convite de foto automático em modo concierge |
| Quais nomes alternativos o paciente usa para este procedimento? | `treatments.aliases` (ex: ["lente", "faceta", "porcelana"]) |
| Tem algum script específico de resposta com vídeos intercalados? | `treatments.triggerTemplate` (texto com tags [MEDIA:id]) |
| O nome é genérico o bastante para causar falso-positivo por keyword? | `treatments.keywordMatchEnabled` = false (ex: "Avaliação", "Consulta") |
| Quais as principais objeções dos pacientes? Como a equipe responde? | `treatments.commonObjections` (array de strings) |

#### Bloco E2 — Pipeline de conversa por procedimento

Para procedimentos de alta conversão (estéticos, tickets altos), pergunte:

| Pergunta | O que gera no sistema |
|---|---|
| Quando o lead menciona este procedimento, a IA deve enviar vídeos antes de responder perguntas? | Etapa `content` com blocos de mídia |
| Após os vídeos, a IA deve ficar disponível para dúvidas com alguma orientação específica? | Etapa `qa` com `instruction` e `maxTurns` |
| Em algum momento a IA deve pedir uma foto do sorriso/região? | Etapa `photo` com `message` e `required` |
| A foto é obrigatória para o agendamento ou apenas opcional? | `photo.required = true/false` |
| Após tirar dúvidas, a IA segue direto para oferecer horários? | Adicionar marcadores `ask_availability` → `offer_slots` → `book` |

> **Quando usar pipeline vs. triggerTemplate:**
> - `triggerTemplate` — resposta única, simples, texto + 1 vídeo. Bom para procedimentos com baixo volume de dúvidas.
> - `pipelineSteps` — sequência multi-etapa com Q&A guiado. Ideal para procedimentos estéticos de ticket alto onde a conversa precisa educar o lead antes de converter.
> - Configure em `/app/settings/pipeline` após cadastrar os procedimentos.

### Bloco F — Experiência conversacional

| Pergunta | Por quê perguntar | Campo no sistema |
|---|---|---|
| Preferem que a IA apresente um menu numerado logo no início, ou prefere uma conversa mais fluida tipo concierge? | Define o `conversationExperience` | `clinics.conversationExperience` ("menu_first" ou "concierge") |
| Se menu: quais as opções do menu e em qual ordem? | Personaliza itens | `clinics.menuItems` (JSON) |
| Qual a mensagem de boas-vindas? | Primeira mensagem que o lead recebe | `clinics.greetingMessage` |

### Bloco G — Tom e identidade da IA

| Pergunta | Campo no sistema |
|---|---|
| Qual o nome da recepcionista virtual? | `playbook_versions.receptionistName` (default: "Mariana") |
| Tom de voz: formal, informal, acolhedor, sofisticado? | `playbook_versions.toneOfVoice` |
| Quais os diferenciais da clínica? (listar de 3 a 6 frases) | `playbook_versions.differentials` (array) |

### Bloco H — Política comercial

| Pergunta | Campo no sistema |
|---|---|
| Quais os valores de cada procedimento? | `playbook_versions.commercialPolicy` (texto livre) |
| Aceitam parcelamento? Quantas vezes? Quais as taxas da maquininha? | `clinics.installmentRates` (JSON com n, rate%, active) |
| Tem planos de saúde? Convênios? | Mencionar na política comercial |
| Há promoções ou pacotes? | Mencionar na política comercial |

### Bloco I — Regras de comportamento da IA

> ⚠️ Esta é a parte mais importante. As regras aqui vão para `playbook_versions.notes` e controlam como a IA se comporta em situações específicas. Use o formato SEMPRE/NUNCA/SE...ENTÃO descrito na Parte 3.

Perguntas para extrair as regras:

1. **O que a IA deve fazer que uma recepcionista humana sempre faria?**
   Exemplos: "Sempre mencionar o estacionamento gratuito", "Sempre oferecer avaliação gratuita"

2. **O que a IA jamais deve fazer?**
   Exemplos: "Nunca prometer desconto sem confirmação da equipe", "Nunca informar que o horário está cheio sem verificar"

3. **Há algum argumento de venda específico que a equipe usa?**
   Exemplos: frases sobre a técnica própria, certificações, resultados antes/depois

4. **Como a clínica lida com leads que perguntam sobre preço e ficam em silêncio?**
   Define o follow-up automático

5. **Há alguma situação especial que a IA deve encaminhar direto para a recepção humana?**
   Além das padrão (pedido de desconto, urgência, falar com dentista)

6. **Qual o prazo de resposta esperado quando a IA pausa e chama a equipe?**
   Informa `clinics.takeoverTtlHours` (padrão: 4h — após esse tempo a IA retoma)

### Bloco J — Mídia (vídeos e fotos)

| Pergunta | Campo no sistema |
|---|---|
| A clínica tem vídeos de procedimentos para enviar pelo WhatsApp? | `playbook_versions.mediaLibrary` |
| Se sim: quais vídeos, URLs, e em qual situação cada um deve ser enviado? | Cada item: { id, title, url, type } + regra no notes |
| Quer respostas em áudio (voz sintética) ou só texto? | `clinics.voiceResponseEnabled` |
| Se áudio: qual voz preferida? (Nova, Shimmer, Echo, Alloy, Fable, Onyx) | `clinics.ttsVoice` |

---

## Parte 2 — Onde cada resposta vai (mapa UI ↔ campo)

### Tela: `/owner/clinics/[id]` (acesso owner)

Configure aqui o que é operacional e que o admin da clínica não deve editar:

- Nome, specialty, city, address, timezone
- Canal WhatsApp (zapiInstanceId, token, channelProvider)
- Plano de cobrança (`plan`, `billingStartedAt`, `monthlyRevenueBrl`)
- Taxas de parcelamento (`installmentRates`)
- Modo de calendário (`calendarMode`, `googleCalendarId`)
- É conta de teste? (`isTest`)
- `rateLimitPerHour`, `unclearThreshold`, `staleConversationHours` (após Fase 2 do refactor)
- `mediaTakeoverTtlHours` (após Fase 2 do refactor)

### Tela: `/app/settings/playbook` → aba Geral

Configure aqui o comportamento da IA:

- `conversationExperience` (menu_first ou concierge)
- `greetingMessage`
- `menuItems` (itens do menu com label, número, intent)
- `businessHours`
- `receptionistPhone`
- `takeoverTtlHours` (quanto tempo até a IA retomar após pausa humana)
- `voiceResponseEnabled`, `ttsVoice`

### Tela: `/app/settings/playbook` → aba Playbooks (editor)

Configure aqui o conteúdo editorial — o "o que dizer":

- `receptionistName`
- `toneOfVoice`
- `differentials` (diferenciais da clínica)
- `commercialPolicy` (política de preços e pagamento)
- `notes` (regras SEMPRE/NUNCA — ver Parte 3 abaixo)
- `objections` (objeções comuns + respostas)
- `mediaLibrary` (vídeos/fotos para envio)

> ⚠️ O playbook precisa ser **publicado** para entrar em produção. Após preencher, clicar em "Publicar versão".

### Tela: `/app/settings/tratamentos`

Configure aqui os procedimentos:

- Criar cada procedimento com: nome, descrição, duração
- Marcar `requiresEvaluationFirst` se aplicável
- Marcar `isAesthetic`, `keywordMatchEnabled`, preencher `aliases`, `triggerTemplate`

### Tela: `/app/settings/pipeline`

Configure aqui o **pipeline de conversa** por procedimento (opcional, mas recomendado para procedimentos estéticos):

- Para cada procedimento, defina a sequência de etapas
- Tipos de etapa disponíveis:
  - **Conteúdo** — blocos de texto e vídeo entregues em sequência antes das respostas livres
  - **Q&A** — período guiado com instrução específica para o LLM e limite de turnos
  - **Foto** — a IA solicita foto do lead (obrigatória ou opcional para avançar ao agendamento)
  - **Marcadores de fluxo** — Disponibilidade / Horários / Agendamento (a IA assume o fluxo reativo nesses pontos)
- Procedimentos sem pipeline continuam no modo reativo exato de antes — sem risco de regressão
- Após salvar, o pipeline entra em produção imediatamente (sem necessidade de publicar playbook)

### Tela: `/app/settings/profissionais`

Configure aqui os profissionais:

- Nome, especialidade, cor no calendário
- Horário de trabalho por dia da semana

### Tela: `/owner/clinics/new`

Criar a clínica no sistema (slug único, nome, plan). Em seguida, adicionar o admin via `clinic_members` (email + senha).

---

## Parte 3 — Como escrever as regras de negócio em texto (campo `notes`)

As regras vão no campo `notes` do playbook ativo. Use os formatos abaixo para máxima confiabilidade:

### Formato SEMPRE
```
SEMPRE mencione que o estacionamento é gratuito ao confirmar o agendamento.
SEMPRE ofereça avaliação gratuita quando o lead demonstrar interesse em implante.
SEMPRE mencione que a clínica atende por convênio XYZ quando o lead perguntar sobre formas de pagamento.
```

### Formato NUNCA
```
NUNCA prometa desconto sem dizer que precisará confirmar com a equipe.
NUNCA informe que não há horários disponíveis — diga que vai verificar e retorne opções.
NUNCA mencione concorrentes.
```

### Formato SE...ENTÃO
```
SE o lead mencionar que veio por indicação do Dr. Silva, ENTÃO ofereça 10% de desconto na avaliação e informe que precisará confirmar com a equipe.
SE o lead perguntar sobre urgência fora do horário comercial, ENTÃO informe o plantão de emergência pelo número (XX) XXXXX-XXXX.
SE o lead mencionar medo de dentista, ENTÃO fale sobre a técnica de sedação consciente da clínica antes de seguir para agendamento.
```

### Regras de conteúdo para vídeos (com `[MEDIA:id]`)

Se a clínica tem um vídeo de apresentação de lentes e quer que seja enviado sempre que um lead perguntar sobre lentes:

Opção 1 — Campo `triggerTemplate` no tratamento (recomendado após Fase 3):
```
Olá! Aqui está um vídeo com tudo sobre Lentes de Contato Dental:

[MEDIA:video-lentes-01]

O procedimento dura cerca de 2 semanas e começa com uma avaliação gratuita. Quer escolher um horário?
```

Opção 2 — Nas `notes` do playbook (formato legado, ainda funciona):
```
TRIGGER lentes:
FORMATO OBRIGATÓRIO
Olá! Aqui está um vídeo com tudo sobre Lentes de Contato Dental:

[MEDIA:video-lentes-01]

O procedimento dura cerca de 2 semanas e começa com uma avaliação gratuita. Quer escolher um horário?
```

> Prefira sempre o campo `triggerTemplate` no tratamento — é mais limpo e não mistura roteamento com conteúdo editorial.

---

## Parte 4 — Verificação após configuração

Após configurar tudo, valide seguindo este checklist no sandbox `/app/settings/playbook/simulate`:

### Checklist básico

- [ ] **Saudação:** Lead envia "oi" → recebe saudação + menu (ou concierge starter) correto
- [ ] **Procedimentos:** Lead envia "1" (menu Procedimentos) → lista numerada aparece correta
- [ ] **Preço:** Lead pergunta "quanto custa X?" → política comercial é citada com valores corretos
- [ ] **Agendamento:** Lead envia "quero agendar X" → sistema oferece slots (não descrição do procedimento!)
- [ ] **Confirmação:** Lead confirma slot → recebe confirmação com endereço
- [ ] **Cancelamento:** Lead diz "quero cancelar" → agendamento é cancelado
- [ ] **Escalonamento:** Lead diz "quero falar com o dentista" → IA pausa e notifica equipe
- [ ] **Regras SEMPRE:** Verificar que as regras do playbook são respeitadas na resposta
- [ ] **Urgência:** Lead diz "estou com dor" → IA demonstra empatia e chama equipe

### Checklist de identidade

- [ ] Nome da recepcionista correto nas respostas?
- [ ] Tom de voz correto (formal/informal)?
- [ ] Nome da clínica correto?
- [ ] Endereço correto na confirmação de agendamento?

### Checklist de mídia (se aplicável)

- [ ] Vídeo enviado na situação correta?
- [ ] Vídeo intercalado na posição certa (antes/depois do texto)?
- [ ] Se áudio habilitado: o áudio é gerado e enviado?

### Checklist de pipeline (se configurado)

Para cada procedimento com pipeline:

- [ ] Lead menciona o procedimento → pipeline inicia (etapa content é entregue)?
- [ ] Blocos de conteúdo chegam em mensagens separadas na ordem correta?
- [ ] Após content, IA entra em modo Q&A respondendo com a instrução correta?
- [ ] Se configurado photo: IA pede a foto no momento certo?
- [ ] Lead diz "quero agendar" no meio do Q&A → pipeline sai e agendamento inicia normalmente?
- [ ] Procedimentos sem pipeline continuam respondendo no modo reativo sem interferência?

---

## Parte 5 — Seed SQL de referência

Se preferir configurar via seed script em vez de UI (mais rápido para clínicas irmãs):

```typescript
// Template mínimo de seed para nova clínica
const clinicId = crypto.randomUUID();

// 1. Criar clínica
await db.insert(clinics).values({
  id: clinicId,
  name: "Nome da Clínica",
  slug: "nome-da-clinica",
  specialty: "odontologia",
  city: "São Paulo",
  address: "Rua Exemplo, 123 — Bairro",
  timezone: "America/Sao_Paulo",
  conversationExperience: "menu_first",
  greetingMessage: "Olá! Sou a Mariana, recepcionista virtual da Clínica X.",
  businessHours: "Seg-Sex 8h-18h",
  autoReplyEnabled: true,
  receptionistPhone: "+5511999999999",
  takeoverTtlHours: 4,
  postAppointmentBufferMinutes: 30,
  defaultAppointmentDurationMinutes: 60,
  channelProvider: "z_api",
  zapiInstanceId: "INSTANCE_ID",
  zapiToken: "TOKEN",
  zapiClientToken: "CLIENT_TOKEN",
  plan: "clinica",
});

// 2. Criar admin
await db.insert(clinicMembers).values({
  clinicId,
  email: "admin@clinica.com.br",
  role: "clinic_admin",
  passwordHash: await bcrypt.hash("senha-inicial", 12),
});

// 3. Criar profissional
await db.insert(professionals).values({
  clinicId,
  name: "Dr. Nome Sobrenome",
  specialty: "Implantodontista",
  color: "#10B981",
  workSchedule: { "1": ["08:00","18:00"], "2": ["08:00","18:00"], ... },
});

// 4. Criar procedimentos
await db.insert(treatments).values([
  {
    clinicId,
    name: "Implante Dentário",
    durationMinutes: 90,
    description: "Reposição de dente perdido com implante de titânio.",
    requiresEvaluationFirst: true,
    isAesthetic: false,
    keywordMatchEnabled: true,
    aliases: ["implante", "implantes"],
    pipelineSteps: null, // sem pipeline — modo reativo padrão
  },
  {
    clinicId,
    name: "Lentes de Resina Composta",
    durationMinutes: 120,
    description: "Transformação do sorriso com resina de alta qualidade.",
    requiresEvaluationFirst: false,
    isAesthetic: true,
    keywordMatchEnabled: true,
    aliases: ["lente", "lentes", "faceta", "resina"],
    pipelineSteps: [
      {
        type: "content",
        label: "Apresentar técnicas",
        blocks: [
          { kind: "text", content: "Trabalhamos com duas técnicas de lentes de resina:" },
          { kind: "media", mediaId: "ID_VIDEO_TECNICA_A" },
          { kind: "text", content: "Cada caso é avaliado individualmente para recomendar a melhor opção." },
        ],
      },
      {
        type: "qa",
        label: "Tirar dúvidas",
        instruction: "Responda dúvidas sobre as técnicas com naturalidade. Não mencione preços além do que está na política comercial.",
        maxTurns: 10,
      },
      {
        type: "photo",
        label: "Pedir foto do sorriso",
        message: "Para que o Dr. possa te dar uma recomendação mais personalizada, você poderia nos enviar uma foto do seu sorriso?",
        required: false,
      },
      { type: "ask_availability", label: "Perguntar disponibilidade" },
      { type: "offer_slots", label: "Mostrar horários" },
      { type: "book", label: "Confirmar agendamento" },
    ],
  },
  {
    clinicId,
    name: "Avaliação",
    durationMinutes: 60,
    description: "Avaliação odontológica inicial.",
    requiresEvaluationFirst: false,
    isAesthetic: false,
    keywordMatchEnabled: false, // nome genérico — não fazer match por keyword
    aliases: ["avaliação gratuita", "consulta inicial"],
    pipelineSteps: null,
  },
]);

// 5. Criar playbook
await db.insert(playbookVersions).values({
  clinicId,
  name: "Playbook Inicial",
  status: "active",
  specialty: "implantodontia e estética dental",
  toneOfVoice: "acolhedor e profissional",
  receptionistName: "Mariana",
  commercialPolicy: `
Avaliação inicial: gratuita.
Implante dentário unitário: a partir de R$3.500.
Parcelamento: até 12x no cartão de crédito.
Planos aceitos: Amil, Bradesco Saúde.
  `.trim(),
  differentials: [
    "Mais de 15 anos de experiência em implantodontia",
    "Tecnologia 3D para planejamento de casos",
    "Clínica certificada pelo CFO",
  ],
  notes: `
SEMPRE mencione que a avaliação inicial é gratuita quando o lead demonstrar interesse em qualquer procedimento.
SEMPRE informe o endereço ao confirmar agendamento.
NUNCA prometa desconto sem confirmar com a equipe.
SE o lead mencionar medo de agulha ou dor, ENTÃO explique a técnica de anestesia sem dor da clínica antes de prosseguir.
  `.trim(),
  objections: [
    {
      objection: "É muito caro",
      response: "Entendo. O investimento em saúde bucal evita custos maiores no futuro. E temos parcelamento em até 12x. Quer começar com uma avaliação gratuita para entender melhor?"
    }
  ],
  mediaLibrary: [],
});
```

---

## Referências

- Formato de regras de playbook: `docs/agent-guides/clinic-playbook-template.md`
- Arquitetura do pipeline: `docs/architecture/conversation-flow.md`
- Pontos de configuração ideais: `docs/architecture/rules-complete-audit.md`
