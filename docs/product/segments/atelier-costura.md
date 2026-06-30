# Segmento: Ateliê de Costura, Uniformes e Bordados

**Status:** Demo gratuita temporária — cliente em avaliação  
**Data de abertura:** 2026-06-29  
**Tipo de uso:** atendimento via WhatsApp, orçamentação com arte, fechamento
de pedido e agendamento de entrega

---

## Descrição do negócio

O cliente opera um ateliê especializado em confecção de uniformes, peças
sob medida e bordados personalizados. O canal principal de atendimento e
fechamento de negócio é o WhatsApp.

O fluxo comercial atual é 100% manual:

1. Cliente entra em contato pelo WhatsApp
2. Atendente coleta especificações (tipo de peça, tecido, quantidade, bordado)
3. Ateliê cria uma arte/prova visual e envia para aprovação do cliente
4. Após aprovação da arte, negocia preço, prazo e condições de pagamento
5. Pedido é confirmado e data de entrega é agendada
6. Follow-up manual próximo da data de entrega

O gargalo é o tempo de resposta e a capacidade de atender múltiplos leads
simultaneamente no WhatsApp sem perder qualidade de atendimento.

---

## Mapeamento para primitivas do core

| Conceito do ateliê | Primitiva do core | Campo de config |
|---|---|---|
| Ateliê | `Organization` / `Workspace` | — |
| Cliente / comprador | `Contact` | `contactNoun: "cliente"` |
| Conversa no WhatsApp | `Conversation` | `channel: "whatsapp"` |
| Tipo de peça ou serviço | `Treatment` → `Service` | `serviceNoun: "pedido"` |
| Arte / prova visual | Anexo de mídia na conversa | `mediaLibrary` |
| Pedido confirmado | `Operation` com template `order` | `bookingNoun: "pedido"` |
| Data de entrega agendada | `Operation.status` + data | scheduling simplificado |
| Atendente humano | Membro com handoff | `agentRole: "atendente"` |

---

## Fluxo operacional esperado com o SystemOps

### Entrada do lead

1. Cliente manda mensagem no WhatsApp
2. Agente responde com saudação personalizada para o ateliê
3. Agente qualifica o interesse: tipo de peça, quantidade aproximada, prazo

### Qualificação e coleta de especificação

4. Agente faz perguntas guiadas conforme playbook do ateliê:
   - Tipo de peça (uniforme, jaleco, camiseta, toalha, etc.)
   - Quantidade (unidade, dezena, lote)
   - Personalização (bordado, silk, DTF, sublimação)
   - Referência visual (o cliente pode enviar foto/referência)
   - Prazo desejado

### Arte e aprovação

5. Agente registra a especificação e notifica o time do ateliê para criar a arte
6. Arte é criada offline e enviada ao cliente pelo WhatsApp pelo agente ou pelo
   atendente humano
7. Cliente aprova ou solicita ajuste
8. Agente registra aprovação como evento no sistema

> **Nota de implementação:** a geração da arte em si não é automatizável pelo
> agente de IA no primeiro momento. O fluxo é: agente coleta spec → time cria
> arte → arte é enviada pelo canal. A automação cresce depois se houver
> integração com ferramenta de design (ex: Canva API, gerador de mockup).

### Orçamento e fechamento

9. Após aprovação da arte, agente apresenta o orçamento com base na tabela de
   preços configurada no playbook
10. Agente negocia dentro dos limites definidos pelo ateliê (desconto máximo,
    condições de pagamento aceitas)
11. Cliente confirma pedido
12. Agente registra pedido como `Operation` com status `open`

### Agendamento de entrega

13. Agente apresenta opções de data de entrega (prazo mínimo configurável)
14. Cliente escolhe data
15. Agente confirma e registra a data como slot de entrega
16. Sistema envia confirmação automática

### Follow-up

17. X dias antes da entrega (configurável), agente envia lembrete ao cliente
18. No dia da entrega, agente confirma recebimento ou agenda retirada
19. Após entrega, agente solicita avaliação (opcional, configurável)

---

## Capabilities necessárias

| Capability | Necessária? | Observação |
|---|---|---|
| `scheduling.enabled` | Sim (simplificado) | Não é agenda de recurso humano — é prazo de entrega |
| `scheduling.clinical` | Não | Específico de clínica |
| `commercial.catalog` | Sim | Tabela de preços por tipo de peça |
| `commercial.quotation` | Sim | Orçamento baseado em spec coletada |
| `media.inbound` | Sim | Receber foto de referência do cliente |
| `media.outbound` | Sim | Enviar arte/prova visual |
| `followup.enabled` | Sim | Follow-up de lead frio e lembrete de entrega |
| `urgency.rules` | Configurável | Sem regras de urgência médica; urgência = prazo urgente |

---

## Configuração sugerida do segment pack `atelier`

```json
{
  "serviceNoun": "pedido",
  "bookingNoun": "entrega",
  "contactNoun": "cliente",
  "agentRole": "atendente virtual",
  "businessDescriptor": "ateliê especializado em uniformes, bordados e peças personalizadas",
  "capabilities": {
    "scheduling": {
      "enabled": true,
      "mode": "delivery_date",
      "minimumLeadDays": 7
    },
    "commercial": {
      "catalog": true,
      "quotation": true,
      "maxDiscountPercent": 10
    },
    "media": {
      "inbound": true,
      "outbound": true
    },
    "followup": {
      "enabled": true,
      "coldLeadDays": 3,
      "deliveryReminderDays": 2
    }
  },
  "urgencyRules": [
    "cliente menciona prazo impossível → handoff humano",
    "reclamação sobre pedido anterior → handoff humano",
    "solicitação de cancelamento → handoff humano"
  ]
}
```

---

## Gaps identificados no sistema atual

Estes gaps bloqueiam ou dificultam o onboarding do ateliê hoje:

| Gap | Onde fica | Prioridade |
|---|---|---|
| `serviceNoun` e `bookingNoun` não substituem vocabulário nos prompts | core / PromptContextBuilder | Alta |
| IntentClassifier não tem `request_quote` como intent universal | core / classifier | Alta |
| Scheduling assume agenda de recurso humano, não prazo de entrega | core / scheduling | Alta |
| UI do owner usa "tratamento" e "consulta" como labels fixos | core / frontend | Média |
| Não há suporte a coleta de especificação estruturada em conversa | core / pipeline | Média |
| Geração ou envio de arte não tem fluxo definido | core / media | Baixa (manual por ora) |

---

## Critério de sucesso para a demo

A demo está funcionando quando:

1. O agente se apresenta como atendente do ateliê, não como recepcionista
2. O agente faz perguntas corretas para coletar spec de uniforme/bordado
3. O agente apresenta orçamento com base na tabela configurada
4. O agente confirma data de entrega e registra o pedido
5. O agente envia follow-up automático X dias antes da entrega
6. O owner vê o funil de pedidos no painel com vocabulário correto

---

## Próximos passos para este segmento

1. Onboardar o cliente na demo com configuração manual (mesmo que via script)
2. Coletar feedback das primeiras conversas reais
3. Identificar gaps não mapeados acima
4. Priorizar os gaps de `PromptContextBuilder` e `IntentClassifier` no backlog
   do core (ver `docs/product/multi-segment-evolution.md`)
5. Definir se o segmento `atelier` vira um pack oficial após validação

---

## Leitura complementar

- `docs/product/multi-segment-evolution.md` — plano de evolução do core
- `docs/product/positioning.md` — posicionamento atual do produto
- `docs/architecture/target-architecture.md` — arquitetura alvo 2.0
