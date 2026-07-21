# Objetividade conversacional — diagnóstico com dados reais (21/07/2026)

Análise de **120 conversas reais da Clínica Vitalli** (últimos 3 dias, 401 mensagens não simuladas),
comparando o comportamento da IA com o do operador humano (Gleice). O objetivo é traduzir o pedido do
Victor — *"não estender demais, mas não ser seca; responder certo e ir rumo ao agendamento"* — em
requisitos verificáveis, e separar o que deve ser **global** do que deve ser **por clínica**.

> Contexto: a Vitalli está com `autoReplyEnabled = false`. O atendimento recente é humano, o que torna
> as mensagens do operador uma **especificação viva** do que o cliente considera certo.

## 1. O dado central: a zona morta de 41–120 caracteres

Distribuição de tamanho das mensagens (n=245 IA, n=112 operador):

| Faixa | 🤖 IA | 👤 Operador |
|---|---|---|
| 0–40 chars | 25% | 23% |
| **41–120 chars** | **4%** | **30%** |
| 121–300 chars | 53% | 38% |
| 300+ chars | 18% | 10% |

A IA **não escreve respostas médias-curtas**. Ela alterna entre um ack curtíssimo e um bloco de 121–300.
O operador vive na faixa 41–120: *"Placa de bruxismo tem o valor de R$ 700,00"* (42), *"Vou te encaminhar
os dias disponíveis"* (36), *"Você teria mais alguma dúvida sobre o procedimento?"* (50).

**Hipótese descartada:** supus que o operador usava mais texto enlatado. Falso — 58% das mensagens do
operador são texto repetido contra 60% da IA. O uso de template é equivalente; o que difere é o
**tamanho da fala conversacional ad-hoc**.

## 2. O sinal mais forte: o operador refez a saudação da IA

Em uma conversa, a IA enviou seu opener e o operador **imediatamente reescreveu o mesmo opener do seu jeito**:

| | Texto | Chars |
|---|---|---|
| 🤖 IA | "Bom dia, Thaynara! Tudo bem? Me chamo Gleice, sou da Clínica Vitalli. Vi que você se interessou pelos nossos casos de lentes em resina. Me conta, **você quer entender melhor como funciona, ver valores ou já procurar um horário para avaliação?**" | 242 |
| 👤 Operador | "Olá tudo bem? Me chamo Gleice, vi que se interessou pelos nossos casos de lentes em resina, para dar continuidade ao seu atendimento **me diga se tem alguma dúvida sobre o procedimento?**" | 183 |

A IA fecha com **menu de 3 opções**; o humano faz **uma pergunta aberta**. Isso é o padrão menu-first
vazando dentro do modo concierge. É a correção mais barata e de maior impacto do diagnóstico.

## 3. "Objetivo" ≠ "encerrar a conversa"

Comparações onde o operador interveio logo após a IA:

| 🤖 IA | 👤 Operador logo depois |
|---|---|
| "📍 Estamos na Av. Adolfo Pinheiro… **Posso te ajudar com mais alguma coisa?** 😊" | "Temos os horários de sábado 01/08 as 16:00 para instalação e no dia 15/08 ou as 8:00 ou as 16:00" |
| "Fico feliz que tenha gostado! 😊 Se precisar de mais alguma informação, **é só me chamar**." | "Olá bom dia, tudo bem? **Você teria mais alguma dúvida sobre o procedimento?**" |

A IA encerra **passivamente** ("é só me chamar", "posso ajudar com mais alguma coisa?"). O humano nunca
encerra: ou reengaja com pergunta, ou **oferta horário concreto**.

**Conclusão que contraria o trabalho W4.2:** o patch de objetividade propunha
*"para perguntas autocontidas como localização… encerre após responder — não ofereça avaliação nem agenda"*.
Os dados mostram que, **para a Vitalli, isso seria errado** — o operador respondeu a localização e
emendou horários. Confirma que este comportamento **não pode ser global**.

### A regra que os dados sustentam

> Turno curto (41–120 chars) **sempre terminando com um passo à frente** — pergunta de qualificação ou
> oferta concreta. Nunca prosa de venda; nunca beco sem saída.

## 4. O que já existe de "modos de conversa"

| Eixo | Existe? | Onde | Configurável por clínica |
|---|---|---|---|
| **Fluxo** (menu vs natural) | ✅ Sim | `ConversationExperience` = `concierge` \| `menu_first`, via módulo `concierge_mode` | ✅ Sim (módulo) |
| **Registro/personalidade** | ✅ Sim | `playbookVersions.toneOfVoice` (texto livre) → `ResponseComposer.ts:504`. Enum informal em `PlaybookAdvisor.ts:118`: `acolhedor \| tecnico \| persuasivo \| luxo` | ✅ Sim (playbook) |
| **Objetividade / verbosidade** | ❌ **Não existe** | — | — |
| **Agressividade comercial** (rumo ao agendamento) | ❌ **Não existe** | — | — |

O módulo `concierge_mode` tem `config: null` (`module-configs.ts:24`) — é só liga/desliga, sem botões.
Já `voice_tts` e `voice_elevenlabs` têm config tipada (`mode: impact | mix | full`), **provando que o
padrão de módulo com configuração já está estabelecido no código**.

## 5. Proposta: dois eixos novos, por clínica

Seguir o molde já provado dos módulos de voz — adicionar config ao `concierge_mode`:

```ts
concierge_mode: {
  // quanto a IA fala por turno
  verbosity: "concisa" | "equilibrada" | "detalhada";   // Vitalli => "concisa"
  // o que fazer ao final de cada resposta
  drive: "responder_e_parar" | "sempre_proximo_passo" | "direto_ao_agendamento";
}
```

- **Vitalli (evidenciado):** `verbosity: "concisa"` + `drive: "sempre_proximo_passo"`
- **Default seguro para clínicas existentes:** `verbosity: "equilibrada"` + `drive: "sempre_proximo_passo"`
  — preserva o comportamento atual da Ximendes, que está funcionando bem.

O eixo `drive` é o que resolve a tensão "não estender × não ser seca": não se corta o próximo passo,
corta-se a **prosa** que hoje o acompanha.

## 6. Backlog priorizado

| # | Item | Risco | Escopo | Evidência |
|---|---|---|---|---|
| 1 | Opener do concierge: 1 pergunta aberta, sem menu de 3 opções | 🟢 baixo | por clínica | §2 |
| 2 | Banir fechamentos passivos ("é só me chamar", "posso ajudar com mais alguma coisa?") | 🟢 baixo | global | §3 |
| 3 | Alvo de 41–120 chars para turno conversacional | 🟡 médio | por clínica (`verbosity`) | §1 |
| 4 | Config `verbosity` + `drive` no `concierge_mode` | 🟡 médio | infra | §5 |
| 5 | Guards determinísticos do W4.2 (`isQuantityFollowupToPriceQuestion`, `shouldSuppressSupersededConversationalReply`) | 🟢 baixo | global | patch arquivado |
| 6 | `slotsWillFollow` — não perguntar "posso ver horários?" quando já vão anexados | 🟢 baixo | global | patch arquivado |
| 7 | Remover `treatmentMediaInstruction` (LLM escolhendo mídia) | 🔴 alto | global, exige replay | AGENTS.md |

Itens 1, 2, 5 e 6 são aditivos e de baixo risco — candidatos naturais à primeira onda.
O item 7 é arquiteturalmente correto ("o sistema decide, a LLM verbaliza") mas muda comportamento de
mídia globalmente: exige validação por replay antes de produção.

---

# PARTE II — Análise de conversão (30 dias, 786 conversas)

Ao estender a janela para 30 dias e cruzar conversas com `appointments`, o diagnóstico muda de
prioridade. **A objetividade é um problema de segunda ordem.**

## 7. O funil real da Vitalli

| Métrica | Valor |
|---|---|
| Conversas em 30 dias | **786** |
| Leads em `waiting_response` | **774 (98,5%)** |
| Leads em `appointment_scheduled` | 4 (0,5%) |
| Agendamentos totais no período | 50 |
| — origem `gcal_import` (marcados FORA do sistema) | **44** |
| — origem `app` (criados PELO sistema) | **6** |

## 8. ⚠️ O achado central: não há atribuição de conversão

**44 dos 50 agendamentos vieram de `gcal_import`** — foram marcados por telefone, presencialmente ou
direto na agenda da clínica, e só depois importados. A conversa não os gerou; ela apenas *casou* com o
lead a posteriori (44/44 têm `leadId`).

Além disso, as datas de criação dos `gcal_import` se concentram em 3 dias (25 em 09/07, 17 em 18/07,
2 em 20/07) — são **lotes de importação**, não a data real do agendamento. Ou seja, esse campo não
serve nem para medir quando a clínica vendeu.

> **Consequência estratégica: hoje é impossível saber qual método de conversa vende.**
> O produto não observa o momento da venda. Otimizar tom, tamanho ou objetividade sem fechar essa
> lacuna é otimizar às cegas.

**Correção de uma análise anterior:** um cálculo intermediário indicou "1,8% de conversão"
(14 de 786). Esse número está **errado** — ele contou como conversão os leads com agendamento
`gcal_import`, que o sistema não produziu. A conversão atribuível ao produto é de **6 agendamentos**,
sendo 2 cancelados e 1 deles uma remarcação do mesmo lead → **5 leads únicos, 4 ativos**.

## 9. A IA quase não operou — e os 6 agendamentos coincidem com quando ela operou

Mensagens por dia, por autor:

| Data | 🤖 IA | 👤 Operador | Agend. `app` |
|---|---|---|---|
| 08/07 | 0 | 396 | — |
| 09/07 | 26 | 330 | **2** |
| 10–17/07 | **0** | 232–414/dia | **0** |
| 18/07 | 173 | 52 | **1** |
| 19/07 | 183 | 14 | **1** |
| 20/07 | 67 | 229 | **2** |
| 21/07 | 0 | 2 | — |

Em **8 dias consecutivos com a IA desligada** (10–17/07), o operador enviou ~2.400 mensagens e o
sistema produziu **zero** agendamentos. Todos os 6 agendamentos `app` caíram em dias com IA ativa.

**Ressalva de causalidade — importante:** `source: "app"` significa "criado pela aplicação", o que
inclui o operador marcando manualmente pelo painel. **Não é prova de que a IA agendou.** A correlação
é sugestiva (6/6 em dias com IA) mas a amostra é pequena e a atribuição é ambígua. Serve como
hipótese a testar, não como resultado.

## 10. Reordenação das prioridades

O gargalo da Vitalli não é a IA falar demais — é que **98,5% dos leads param em `waiting_response`**
e o time humano não dá conta de ~250 leads/dia. Quando a IA está ligada, o operador cai de ~350 para
~14–52 mensagens/dia: ela absorve a carga.

Ordem correta de ataque:

| Prioridade | Problema | Por quê |
|---|---|---|
| **P0** | **Instrumentar a conversão** (marcar agendamento originado da conversa; distinguir operador × IA em `source`) | Sem isso nenhuma otimização é verificável |
| **P0** | **Cobertura**: 774 leads parados sem resposta | É onde está o dinheiro perdido, não no tamanho da frase |
| **P1** | Método de vendas (§1–3): turno curto + sempre próximo passo | Melhora a qualidade do que já é respondido |
| **P2** | Perfis por segmento (§11) | Escala o método para outros clientes |

## 11. Arquitetura de perfis por segmento (mediano × premium)

O objetivo declarado é ter um **método replicável por tipo de público**. A recomendação é não tratar
"Vitalli" como config avulsa, mas como **preset de segmento** — do mesmo jeito que os planos já têm
presets (`plan-presets.ts`).

```ts
type SegmentProfile = "popular" | "mediano" | "premium" | "luxo";

// perfil resolve os defaults; a clínica pode sobrescrever item a item
{
  verbosity: "concisa" | "equilibrada" | "detalhada",
  drive:     "responder_e_parar" | "sempre_proximo_passo" | "direto_ao_agendamento",
  toneOfVoice: "acolhedor" | "tecnico" | "persuasivo" | "luxo",  // já existe, hoje texto livre
  priceDisclosure: "imediata" | "apos_qualificacao" | "so_na_avaliacao",
}
```

- **mediano** (Vitalli, Ximendes): `concisa` + `sempre_proximo_passo` + `acolhedor` + preço `imediata`
  — evidenciado no §2/§3: o operador informa o valor direto ("Placa de bruxismo tem o valor de R$ 700,00")
  e emenda o próximo passo ("Gostaria de agendar ?").
- **premium/luxo** (hipótese, sem dados ainda): `detalhada` + `responder_e_parar` + `luxo` +
  preço `apos_qualificacao` — público que reage mal a preço cru e valoriza consultoria.

O perfil `premium` **não deve ser escrito por intuição**. O caminho honesto é fechar a instrumentação
(§10 P0), rodar o perfil `mediano` com medição, e só então derivar o premium com o primeiro cliente
desse segmento.

## Ressalvas metodológicas

- Amostra: **uma** clínica. As conclusões descrevem a Vitalli; generalizar exige olhar Ximendes.
- A IA operou apenas 3 dos 30 dias analisados — a amostra de comportamento da IA é pequena e recente.
- As comparações "IA → operador" mostram correlação, não prova de causa: nem toda intervenção do
  operador é correção de erro da IA (algumas são handoff normal de `needs_human`).
- `source: "app"` não separa "IA agendou" de "operador agendou pelo painel" — é exatamente a lacuna
  que o P0 de instrumentação precisa fechar.
