# ADR-004: Arquitetura de Modelos de IA baseada em Tiers (Planos Comerciais) e Casos de Uso

**Status:** Proposto — pendente de análise macro e refinamento detalhado  
**Data:** 2026-07-06  
**Contexto:** Necessidade de calibrar latência, qualidade cognitiva e custo de APIs de inteligência artificial de acordo com o plano do cliente, diferenciando a IA conversacional do robô de métricas do back-office.

---

## Contexto

O `systemops-sales-engine` faz chamadas constantes a APIs de LLM (OpenAI e Anthropic) para executar três atividades críticas de natureza muito distinta:

1. **Classificação de Intenção (`IntentClassifier`)**: Roda no recebimento de cada mensagem. Exige latência ultrabaixa e resposta em JSON estruturado rígido.
2. **Geração de Resposta (`ResponseComposer`)**: Roda na composição de cada resposta. Exige naturalidade, tom de voz, adequação comercial e alinhamento com playbook.
3. **Análise de Métricas e Consultoria (`PlaybookAdvisor`)**: Roda assincronamente e de forma esporádica (sob demanda ou agendado). Exige altíssima capacidade analítica e lógica sobre dados complexos e métricas de conversão.

Atualmente, o padrão do sistema é rodar quase tudo com o modelo barato e rápido `gpt-4o-mini`, o que prejudica a profundidade analítica do `PlaybookAdvisor` (gerando diagnósticos rasos) e limita a experiência conversacional de clientes que pagam por planos premium (Avançado/Rede) e esperam naturalidade absoluta.

---

## Decisão

Estabelecer uma divisão de modelos de IA baseada no caso de uso e no tier do cliente, estruturada da seguinte forma:

```
[Mensagem Recebida] ──> IntentClassifier (Fixo: gpt-4o-mini para latência < 1s)
                             │
                             └──> [Orquestração determinística]
                                           │
                                           └──> ResponseComposer (Dinâmico por Plano)
                                                    ├── Essencial ──> gpt-4o-mini
                                                    └── Avançado/Rede ──> gpt-4o ou Claude Premium

[Ações do Gestor] ──> PlaybookAdvisor (Fixo: Claude 3.5 Sonnet ou gpt-4o para todos os planos)
```

### 1. IntentClassifier (Mantido Fixo)
O `IntentClassifier` permanecerá fixado no **`gpt-4o-mini`** (ou equivalente de baixo custo e alta velocidade) independente do plano. A classificação é uma tarefa estruturada que bloqueia o processamento da mensagem, e usar modelos premium aqui aumentaria o tempo de resposta geral do WhatsApp de forma inaceitável (latência de 3s+).

### 2. ResponseComposer (Dinâmico por Tier)
O modelo usado no `ResponseComposer` será resolvido em tempo de execução com base no plano assinado pela organização/clínica (em `organizations.plan`):
- **Plano Essencial**: Resolve para `gpt-4o-mini` (focado em agendamento direto e baixo custo de execução).
- **Plano Avançado (Growth/Rede)**: Resolve para `gpt-4o` completo ou modelo premium equivalente.
- **Painel do Owner (`/owner`)**: Conterá um campo de *override* que permite que os administradores forcem manualmente um modelo premium para uma clínica específica, útil para demonstrações de vendas ou testes A/B antes da contratação do plano superior.

### 3. PlaybookAdvisor (Premium para Todos)
O `PlaybookAdvisor` será fixado no **`claude-3-5-sonnet`** (ou `gpt-4o` completo) para todas as clínicas, sem distinção de plano. Como este recurso de análise analítica roda poucas vezes e fora do fluxo síncrono do WhatsApp, o impacto financeiro do uso de modelos caros é irrelevante, mas o valor agregado entregue na sugestão de playbooks e contorno de objeções clínicos é crítico para reter clientes.

---

## Alternativas consideradas

### Permitir que o cliente selecione o modelo de IA no painel
**Descartado (Besteira).** Polui a interface do usuário final (que não conhece terminologia técnica de LLMs), aumenta os chamados de suporte por configurações incorretas e arrisca queima não-planejada de margem comercial.

### Rodar tudo com GPT-4o completo
**Descartado.** O custo de rodar todas as mensagens de conversas do plano Essencial/Start em modelos premium inviabilizaria a lucratividade das assinaturas de entrada.

---

## Consequências

**Positivas:**
- Alinhamento perfeito entre custos de API e receita gerada por plano de assinatura (melhora de margem).
- Aumento do valor percebido na ferramenta de análise de playbook (`PlaybookAdvisor`) que passará a contar com o raciocínio do Claude 3.5 Sonnet.
- Ganho de velocidade e estabilidade ao manter a classificação leve e rápida.

**Negativas / trade-offs:**
- Requer a configuração de chaves adicionais em produção (`ANTHROPIC_API_KEY`) caso optemos pelo Sonnet no Advisor.
- O código do resolvedor de modelo de resposta deve ser revisado em todo o projeto para garantir que o plano da clínica seja propagado corretamente em todos os casos de uso.

---

## Próximos Passos (Refinamento e Análise Macro)

1. **Mapeamento de Contexto**: Revisar todos os pontos do orchestrator para garantir que a propriedade `plan` da organização esteja disponível no momento de instanciar o `ResponseComposer`.
2. **Validação de Limites de Tokens**: Garantir que os limites de tokens de saída para o `ResponseComposer` sejam dinâmicos ou adequados ao modelo premium para evitar truncagem de respostas longas em português.
