# Ideia Inicial: Modo Campanha (Campaign Context Overlay)

## O Problema
Atualmente, nosso sistema possui o **Motor de Reativação (ADR-009)** e o painel de campanhas rodando. No entanto, o `ReactivationMessageComposer` atua apenas no **disparo da primeira mensagem** (o rascunho de reativação).

Quando o lead responde (ex: "Eu quero" ou "Como funciona?"), a conversa volta para o pipeline normal da IA (`ResponseComposer` e `IntentClassifier`). 
Nesse fluxo padrão, a IA:
- Trata o lead como se fosse um novo contato.
- Tende a ser muito explicativa (mensagens longas de ~50 palavras).
- É consultiva demais ("Como posso ajudar?", "Que tal agendar?"), perdendo a urgência e o fechamento que uma recampanha exige.

Por outro lado, vimos que **operadores humanos têm alta conversão** em campanhas porque são objetivos, criam urgência, reduzem o esforço do lead e buscam uma decisão rápida. Contudo, o humano sofre com inconsistência de regras (valores errados) e pode ser agressivo ou seco demais, prejudicando a imagem da clínica.

## A Solução: Modo Campanha (Overlay)
Para unir a **organização operacional da IA** com a **objetividade comercial do Operador**, devemos criar um "Modo Campanha". Ele atuará como uma camada temporária (overlay) sobre o comportamento padrão da IA.

### Como vai funcionar na prática?

1. **Identificação do Contexto (Injection):**
   Sempre que o `ResponseComposer` for gerar uma resposta, o sistema verificará se o lead atual está atrelado a um registro ativo na tabela `reactivation_campaign_targets`.
   Se sim, extraímos o `CampaignContext`, contendo:
   - Nome da campanha e oferta autorizada (`price_campaigns`).
   - Prazo final da campanha (`deadline`).
   - O motivo de parada anterior do lead (via `lead_outcome_reason` ou `silence_stage`).

2. **Override de Comportamento no `ResponseComposer`:**
   Caso o `CampaignContext` exista, um novo bloco de regras será injetado no prompt. A IA receberá as seguintes diretivas temporárias:
   - **Lead já informado:** O lead já conhece o tratamento. NÃO re-explique como funciona o procedimento, a não ser que ele pergunte diretamente.
   - **Tamanho da resposta:** Responda no máximo em 2 frases curtas.
   - **Foco na Objeção:** O objetivo não é apenas "agendar uma avaliação", mas validar o interesse na oferta especial e entender o impeditivo atual (Valor? Forma de pagamento? Data?).
   - **Urgência Suave:** Utilizar o prazo da campanha para criar um senso de oportunidade, sem soar agressivo.

3. **Adaptação do Classificador (`IntentClassifier`):**
   O classificador de intenção deverá reconhecer quando o lead está inclinado a fechar a campanha. Podemos adicionar novos fluxos para lidar com "Negociação de Campanha", permitindo que a IA lide com descontos e prazos de forma determinística, ao invés de repassar tudo para uma avaliação presencial.

## Vantagens e Cuidados
- **Segurança (Ring-fencing):** Como é um "Overlay", isso só afeta leads que foram ativamente colocados em uma campanha de reativação pelo painel. O fluxo de inbound normal da clínica não sofre nenhuma alteração.
- **Evita Template de IA:** Ao injetar o motivo de parada (`silence_stage`), a IA pode retomar a conversa exatamente de onde parou ("Vi que da última vez ficamos de ver a questão do parcelamento..."), gerando muito mais conexão.
- **Controle de Tom:** Mantemos a empatia da IA, bloqueando as "respostas secas" ou agressivas ("Provavelmente você não tem dinheiro para o sinal"), mas impulsionamos a urgência comercial.

## Próximos Passos (Para Refinamento Futuro)
- [ ] Avaliar a modelagem do `CampaignContext` e como ele será buscado em tempo real nas rotas de mensagem.
- [ ] Fazer testes de prompt no `ResponseComposer` passando os parâmetros de campanha e comparar os rascunhos.
- [ ] Definir como será a saída desse modo (ex: quando a campanha expira ou o lead é desqualificado).
