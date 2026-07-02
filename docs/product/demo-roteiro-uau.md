# Roteiro de Demo "UAU" — para fechar vendas

> Objetivo: em ~2 minutos, fazer o prospect **ver** a IA respondendo um lead fora do
> horário, dando preço certo, contornando objeção e **fechando um agendamento sozinha**.
> É o momento que fecha venda para clínica com tráfego pago. Reproduzível — funciona igual
> toda vez, porque roda com a IA real sobre um playbook pronto.

Clínica de demo: **Odonto Marques** (recepcionista **Marina**), um tenant real com playbook
premium e dashboard cheio de dados. Fonte: `src/application/demo/seed-demo-clinic.ts`.

---

## Setup (1 comando)

```bash
npm run seed:demo   # cria/reseta a Odonto Marques: playbook + ~120 leads + agenda + métricas
```

Deixa o painel "fresco" no dia da demo (ROI 4,8x, leads fora do horário, horas
economizadas). Login da clínica: `helena@odontomarques.com.br` / `OdontoMarques2026!`.

**As conversas do inbox agora são geradas pela IA REAL** (~40 conversas coerentes na voz
da Marina, via `ResponseComposer` — ver `src/application/demo/`), não mais frases genéricas
soltas. Por isso o `seed:demo` **requer `OPENAI_API_KEY`** e leva ~1-2 min. Sem chave (ou
com `DISABLE_REAL_OPENAI=true`) ele cai em respostas-modelo coerentes, sem travar. Cada
conversa é printável — serve de conteúdo pronto para marketing.

**Conteúdo rico incluído:**
- **Vídeos de procedimento reais** — as conversas de lentes enviam o vídeo da técnica,
  reusando a biblioteca de mídia da **Ximendes** (query por slug no seed; degrada limpo se
  a Ximendes não existir). Tocam de verdade no inbox.
- **Mix de áudio e texto** — parte das respostas da Marina é marcada como voz
  (`deliveryFormat: "audio"` → badge 🔊 no inbox). Conversas rotuladas como voz **B-WAVE**
  (premium) e uma com **voz simples** (`voiceStyle` no roteiro).
- **Follow-ups atraentes com mídia** — a recuperação de lead reengaja com imagem/vídeo.
- **Agendamentos, urgência→handoff, remarcação** e histórico de ganhos/perdidos.

> **Sobre ouvir a voz:** o inbox mostra o badge 🔊 (voz), mas **não toca áudio sintetizado**
> — para OUVIR o B-WAVE, use o simulador ao vivo ou o WhatsApp real (síntese na hora, com o
> `voiceId` da clínica). Áudio tocável no próprio inbox exige sintetizar no seed (custo +
> `voiceId` de B-WAVE) — ver "próximos passos".

## Três jeitos de rodar a demo

1. **Simulador ao vivo (recomendado na reunião):** logue na clínica demo → aba de playbook
   → **Simular** (`/app/settings/playbook/simulate`). Você digita como se fosse o lead e a
   Marina responde na hora. Use o roteiro abaixo.
2. **Motor de demo (ensaio / verificação / hands-free):**
   ```bash
   npm run dev            # sobe o app (noutro terminal)
   npm run demo:roteiro   # toca o roteiro inteiro e imprime a conversa
   ```
   Contra produção: `SYSTEMOPS_BASE_URL=https://app.systemops.com.br SIMULATE_API_KEY=… npm run demo:roteiro`.
   Bônus do handoff: `npm run demo:roteiro -- --handoff`.
3. **WhatsApp real (o mais UAU, upgrade):** conecte um número Z-API à clínica demo e deixe
   o prospect mandar mensagem do próprio celular. Requer setup de canal — usar quando valer.

---

## O roteiro (os "beats")

Cada mensagem do lead expõe a IA num momento decisivo. A coluna **"Fala do vendedor"** é o
que você narra enquanto a Marina responde.

| # | O lead diz | O que a Marina faz | Fala do vendedor |
|---|---|---|---|
| 1 | *"Vi o Instagram à noite e amei as lentes. Ainda dá pra saber como funciona?"* | Responde na hora, acolhedora | "Repare a hora: **22h47**. Esse é o lead que hoje some porque ninguém respondeu." |
| 2 | *"Quanto fica as lentes?"* | "A partir de R$1.800 por dente, após avaliação" | "Ela deu o preço **pela política de vocês** — não inventou. Preço errado nunca sai." |
| 3 | *"Achei um pouco caro…"* | Contorna: parcelamento + plano na avaliação | "Objeção de preço, o momento que mais faz lead sumir — e ela **conduziu** com o script de vocês." |
| 4 | *"Como marco a avaliação?"* | Oferece horários reais | "Horários **reais** da agenda, não 'a equipe entra em contato'." |
| 5 | *"Quero o primeiro horário"* | Confirma o agendamento | "Fechou **sozinha**, sem recepcionista, sem espera. Isso rodando 24/7." |

**Bônus — handoff inteligente** (`--handoff`): o lead diz *"agora tô com uma dor forte"* e a
Marina reconhece a urgência e **passa para o humano na hora**. Mostra que ela sabe a hora de
não ser robô — o que tira o medo de "e se ela falar besteira?".

---

## O fechamento: leve para o dashboard

Depois do roteiro, abra o painel da Odonto Marques e ancore no valor, não no software:

- **Leads fora do horário** capturados (o que se perderia dormindo).
- **Horas economizadas** da recepção (a Marina fez o trabalho repetitivo).
- **ROI ~4,8x** no período.

Frase-âncora: *"Isso custa menos que uma recepcionista com encargos, e não dorme. Recuperar
1 ou 2 desses leads por mês já paga o plano."* (ver `pricing-strategy.md` §4.1).

## Amarração com a oferta

- Plano recomendado por padrão: **Growth (R$2.100)** — voz premium B-WAVE nos momentos de
  conversão, recuperação de leads, playbooks ilimitados.
- Para os primeiros ~6 contratos: **Oferta de Fundador** (40% nos 3 primeiros meses + setup
  pela metade, preço travado 12 meses). Ver `pricing-strategy.md` §4.2.

---

## Notas técnicas

- O simulador (`/api/playbook/simulate`, `source: "production"`) usa a **mesma IA** do
  WhatsApp (IntentClassifier + ResponseComposer) e lê o playbook ativo da clínica — o que a
  Marina faz na demo é o que faria em produção.
- Horários: reais se `QA_GOOGLE_CALENDAR_ID` estiver configurado; senão, slots simulados
  realistas. Para a demo, qualquer um dos dois convence.
- A clínica demo é `isTest: true` — fica fora dos crons e do digest de produção.
- Roteiro e motor: `scripts/demo-roteiro.ts` (edite `ROTEIRO` para adaptar o segmento).
