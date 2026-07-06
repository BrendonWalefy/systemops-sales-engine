# ADR-003: Desacoplamento de Provedores de Mensagens e Canais (ChannelAdapter Factory)

**Status:** Proposto — pendente de análise macro e refinamento detalhado  
**Data:** 2026-07-06  
**Contexto:** Necessidade de plugar novos provedores de WhatsApp (Weni, Twilio, Gupshup) e outros canais (SMS, Telegram, Instagram) sem alterar o core conversacional.

---

## Contexto

Atualmente, o `systemops-sales-engine` define a interface [ChannelAdapter](file:///Users/brendonwalefy/Dev/Projetos/systemops-sales-engine/src/application/ports/channel-adapter.ts) para padronizar mensagens recebidas (`receive`) e enviadas (`send`). Contudo, o acoplamento com os provedores concretos (**Z-API** e **Meta Cloud API**) ainda é forte e estático em vários pontos cruciais do sistema:

1. **Roteamento de Envio**: O utilitário [whatsapp-sender.ts](file:///Users/brendonwalefy/Dev/Projetos/systemops-sales-engine/src/infrastructure/adapters/channels/whatsapp/whatsapp-sender.ts) possui condicionais estáticas (`if / else`) para direcionar chamadas dependendo do campo `config.provider`.
2. **Pacing e Polling de Mídia**: O [OutboundDeliveryService.ts](file:///Users/brendonwalefy/Dev/Projetos/systemops-sales-engine/src/infrastructure/adapters/channels/whatsapp/outbound-delivery-service.ts) faz polling de status de entrega (`waitForDelivery`) validando diretamente se o provedor é `"z_api"`.
3. **Persistência / Banco de Dados**: A coluna `channelProvider` na tabela `clinics` usa o enum Postgres `whatsapp_provider` contendo apenas os valores `'z_api'` e `'meta_cloud_api'` de forma estática ([schema.ts:L90-L93](file:///Users/brendonwalefy/Dev/Projetos/systemops-sales-engine/src/infrastructure/db/schema.ts#L90-L93)).

Essa arquitetura impede a expansão plug-and-play para outros canais ou provedores de WhatsApp sem realizar alterações invasivas em arquivos estruturais da camada conversacional e de entrega.

> [!NOTE]
> Este documento representa uma proposta inicial. É fundamental realizar um refinamento minucioso de todo o repositório para garantir que nenhum comportamento implícito de fila, re-try ou tratamento de mídia esteja acoplado aos comportamentos específicos da Z-API.

---

## Decisão

Proponalizar o desacoplamento completo do provedor de mensagens em três frentes:

### 1. Criação do `resolveChannelAdapter`
Substituir a instanciação manual e direta dos adaptadores por uma fábrica genérica que retorne o `ChannelAdapter` correspondente à clínica/organização ativa (idêntico ao padrão utilizado em `resolveCalendarGateway`).

### 2. Extensão do Contrato de `ChannelAdapter`
Mover responsabilidades específicas de canal/provedor da camada de serviço de aplicação para os adaptadores. 
- O método `waitForDelivery` ou controle de pacing de mídia deve se tornar um comportamento opcional implementável no próprio adaptador do provedor correspondente (ex: `ZapiChannelAdapter` implementa a checagem de recebimento de mídia, enquanto `MetaChannelAdapter` executa de forma síncrona/no-op).

### 3. Generalização do Schema (Drizzle)
Substituir o enum estático `whatsapp_provider` no banco de dados por um tipo `text` flexível (com validação em nível de aplicação/código) ou expandir o enum de forma transacional para aceitar uma gama indefinida de provedores.

---

## Alternativas consideradas

### Manter o fluxo híbrido com condicionais
**Descartado.** Continuar adicionando blocos `if / else` em `whatsapp-sender.ts` a cada novo canal/provedor tornaria o arquivo ilegível, propenso a bugs de regressão e violaria o princípio de Aberto/Fechado (Solid).

### Isolar canais diferentes em microserviços de entrega
**Descartado para esta etapa.** Apesar de elegante para escala de produção massiva, adicionaria complexidade de infraestrutura desnecessária neste momento do monólito modular Next.js. O uso de adaptadores dinâmicos via injeção de dependência na rota resolve o problema com menor custo operacional.

---

## Consequências

**Positivas:**
- Capacidade de suportar múltiplos canais e múltiplos provedores de forma 100% plug-and-play.
- Testabilidade isolada de cada provedor de WhatsApp (mocks mais limpos).
- Código de pacing de entrega limpo e sem regras específicas de APIs de terceiros.

**Negativas / trade-offs:**
- Exige refatoração de código legado que hoje assume o envio síncrono da Meta ou assíncrono com polling da Z-API.
- Necessidade de migração de banco de dados para flexibilizar a coluna de provedores.

---

## Próximos Passos (Refinamento e Análise Macro)

1. **Varredura Completa**: Analisar todos os arquivos e testes que importam ou dependem de `zapi` no repositório para garantir que nenhum detalhe de infraestrutura "vaze".
2. **Definição do Contrato de Mídia**: Alinhar como múltiplos provedores gerenciam uploads de mídias (Vídeos/Imagens) que hoje dependem das URLs temporárias Z-API vs. IDs de mídia do Facebook Cloud API.
