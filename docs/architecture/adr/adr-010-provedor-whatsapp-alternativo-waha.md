# ADR-010: Provedor WhatsApp alternativo self-hosted (WAHA)

**Status:** Proposto — pesquisa concluída, implementação adiada
**Data:** 2026-09-01
**Depende de:** ADR-003 (Desacoplamento de Provedores de Canais) — proposta em 2026-07-06, **nunca implementada**
**Relacionada a:** ADR-005 (Provisionamento Z-API) — bloqueada

---

## Contexto

Hoje o SystemOps suporta dois provedores de WhatsApp, declarados no enum Postgres `whatsapp_provider`: `z_api` e `meta_cloud_api`. A operação real roda em Z-API.

Três pressões motivam a avaliação de um terceiro provedor:

1. **Custo linear por tenant.** A Z-API cobra **R$ 99,99/mês por instância** (por número conectado), com mensagens ilimitadas e sem cobrança por mensagem. Cada tenant novo é +R$ 99,99/mês fixos, inclusive demo, lab e piloto — que hoje pagam preço de produção sem gerar receita.
2. **Provisionamento travado.** A ADR-005 está bloqueada: o programa Partner da Z-API exige 10 instâncias e temos 4, então cada ativação é manual.
3. **Fornecedor único.** Não há caminho de saída se preço, disponibilidade ou termos mudarem.

---

## Pesquisa de mercado (agosto/2026)

### Achado principal: o risco de ban é comportamental, não da biblioteca

Baileys, Evolution API, WAHA, WPPConnect, whatsapp-web.js e whatsmeow são todos a mesma engenharia reversa do protocolo do WhatsApp Web, se passando por um navegador. **O que muda entre eles é empacotamento, não superfície de detecção.** Não existe provedor gratuito que "tome menos ban" por mérito técnico.

Os sinais que a pesquisa aponta como determinantes de ban em 2025-2026 são de comportamento: reply-ratio abaixo de ~10%, distância no grafo de contatos (mensagem para desconhecido), timing robótico, volume, número novo sem aquecimento e IP de datacenter compartilhado entre vários números.

### O ambiente piorou, e é recente

- A Meta atualizou os termos do WhatsApp Business em **out/2025**, com vigência em **15/01/2026**, restringindo chatbots de IA de propósito geral. *Nuance a favor do produto:* bot de tarefa estruturada — atendimento, agendamento — segue explicitamente permitido; o alvo são bots de domínio aberto. Isso vale para a Cloud API oficial; no não oficial não existe permissão de nenhum tipo.
- Baileys [issue #1869](https://github.com/WhiskeySockets/Baileys/issues/1869), aberta em **05/10/2025**: 5 bots banidos em uma semana, dois deles rodando havia mais de 3 anos sem incidente. A issue morreu como *stale*, sem resposta de mantenedor.
- Blogs brasileiros estimam 40-60% das contas em API paralela sofrendo suspensão no Q1/2026, com bans em até 48h. **Tratar como sinal de direção, não como dado auditado** — são fontes comerciais vendendo alternativa.
- **Supply chain:** em **abr/2026** o pacote `lotusbail`, vendido como "anti-ban" e com 56 mil downloads, foi confirmado exfiltrando credenciais de sessão e roubando mensagens. Regra decorrente: **nenhum pacote "anti-ban" de terceiro entra no projeto.**

### Candidatos avaliados

| Projeto | Arquitetura | Gratuito de verdade? | Ponto decisivo |
| --- | --- | --- | --- |
| **WAHA** | REST + Docker, 4 engines: WEBJS (Chromium), WPP, NOWEB (Baileys), **GOWS (Go/whatsmeow)** | **Sim**, desde a versão 2026.6.1 | Tudo que era "Plus" pago virou Core gratuito; tier de US$ 5/mês é apoio, sem perks |
| Evolution API | REST sobre Baileys | Grátis, mas com atrito | **v2.4.0 exige ativação de licença** pelo Manager — [issue #2534](https://github.com/evolution-foundation/evolution-api/issues/2534): container sobe e a API fica inutilizável até alguém clicar. Incompatível com deploy automatizado |
| evolution-go | Go sobre whatsmeow, Apache-2.0 | Sim | Novo, sem histórico de produção |
| Baileys / whatsapp-web.js / WPPConnect | Bibliotecas, não serviços | Sim | Exigem implementar sessão, reconexão e storage. whatsapp-web.js roda Chromium (RAM alta por sessão) |
| Venom | Browser automation | Sim | Em declínio |

---

## Decisão

Adotar **WAHA com engine GOWS** como **terceiro provedor opcional**, selecionável na ativação de um tenant.

**Não** pela premissa de tomar menos ban — a pesquisa mostra que essa premissa é falsa — mas pelos eixos que de fato controlamos:

1. **Gratuito sem pegadinha** desde jun/2026, sem ativação manual travando deploy.
2. **Troca de engine sem trocar de integração.** Quando a Meta muda o protocolo e o Baileys quebra, troca-se `NOWEB` → `GOWS` em variável de ambiente em vez de reescrever o adapter. É o único candidato com esse hedge.
3. **GOWS (whatsmeow, Go)** é o mais econômico por sessão.

### Escopo de uso — regra dura

| Uso | Provedor |
| --- | --- |
| Cliente pagante | **Z-API** (ou Meta Cloud API) |
| Lab, demo, piloto, número de teste | **WAHA** |

Cliente pagante **não migra** para WAHA. O ban de API não oficial é permanente e sem apelação, e o número banido é o ativo do cliente. Trocar risco absorvido pelo fornecedor por risco próprio, para poupar ~2% do ticket, não compensa.

---

## Pré-requisito: executar a ADR-003

A ADR-003 identificou três pontos de acoplamento estático a `z_api`. **Verificado em 2026-09-01: os três continuam intactos.** Um terceiro provedor não pode ser adicionado sem tratá-los.

1. **Roteamento de envio.** [`whatsapp-sender.ts`](../../../src/infrastructure/adapters/channels/whatsapp/whatsapp-sender.ts) usa `if (config.provider === "z_api") { ... }` em `sendTextMessage`, `sendMediaMessage` e `sendButtonListMessage`, com o **else caindo implicitamente em Meta**.
   > **Armadilha concreta:** acrescentar `"waha"` ao enum sem tocar neste arquivo faz todo envio WAHA cair no ramo da Meta e estourar `"Meta WhatsApp credentials are not configured for this clinic"`. Falha silenciosa em ativação, não em teste.
2. **Polling de entrega.** [`outbound-delivery-service.ts:140`](../../../src/infrastructure/adapters/channels/whatsapp/outbound-delivery-service.ts#L140) valida `config.provider !== "z_api"` para decidir se espera confirmação de entrega. Pacing de mídia precisa virar comportamento do adapter.
3. **Enum do schema.** [`schema.ts:100-103`](../../../src/infrastructure/db/schema.ts#L100-L103) declara `pgEnum("whatsapp_provider", ["meta_cloud_api", "z_api"])`. Exige migração.

---

## Custos

**Data:** 2026-09-01. **Região:** São Paulo (BR). **Premissas:** engine GOWS; um container WAHA por VPS; preços de tabela consultados na data, sujeitos a promoção.

### Requisito de infraestrutura

WAHA exige um processo com WebSocket permanentemente aberto contra o WhatsApp. **Não roda em serverless** — function da Vercel morre em segundos e derruba a sessão. Exige VPS ligada 24/7.

O IP precisa ser **brasileiro**: IP estrangeiro com número brasileiro é sinal de risco na detecção. Isso elimina Hetzner e Contabo (baratos, sem datacenter no Brasil).

### Consumo por sessão (números oficiais do WAHA)

| Sessões | WEBJS | NOWEB | GOWS |
| --- | --- | --- | --- |
| 1 | 0,3 CPU / 400 MB | 0,1 CPU / 200 MB | 0,1 CPU / 200 MB |
| 10 | 3 CPU / 2,5 GB | 1 CPU / 2 GB | 0,5 CPU / 1 GB |
| 50 | 15 CPU / 20 GB | 2 CPU / 4 GB | 1,5 CPU / 3 GB |
| 100 | — | 4 CPU / 8 GB | 3-5 CPU / 5 GB |

Mínimo recomendado pelo projeto: **2 vCPU / 4 GB**, mesmo para uma sessão.

### Opções de VPS

| Opção | Config | Preço | Nota |
| --- | --- | --- | --- |
| Hostinger KVM, São Paulo | 1 vCPU / 4 GB NVMe | ~R$ 28/mês (plano 24 meses) | **Abaixo do mínimo de 2 vCPU**; conferir preço do KVM2 |
| Vultr São Paulo | a partir de 1 vCPU | ~US$ 6/mês | Cobrança por hora, bom para testar |
| Mercado geral BR | 2 vCPU / 4 GB | R$ 80-200 / US$ 18-30 | Referência de teto |
| Oracle Always Free | — | R$ 0 | **Não contar com isso:** cortado de 4 OCPU/24 GB para 2/12, e falta capacidade em São Paulo |

### Economia bruta

| Tenants | Z-API | WAHA | Diferença/mês |
| --- | --- | --- | --- |
| 1 | R$ 100 | R$ 60 | R$ 40 |
| 4 | R$ 400 | R$ 60 | R$ 340 |
| 10 | R$ 1.000 | R$ 60 | R$ 940 |
| 20 | R$ 2.000 | R$ 120 (2 VPS) | R$ 1.880 |

### Por que essa conta é otimista

1. **Separação de IP.** Empilhar 10 números de clínicas no mesmo IP de datacenter é o padrão que a detecção lê como fazenda de contas. Resolver com proxy residencial BR por tenant custa R$ 30-80/mês **por número** — e a economia praticamente evapora.
2. **Tempo de operação.** Sessão caindo às 2h da manhã passa a ser problema nosso. Uma noite disso por mês já custa mais que os R$ 940.
3. **Custo do ban.** Perder o número de um cliente pagante não é custo de infra; é perder o cliente.

**Conclusão de custo:** o WAHA vale como opção arquitetural — não ficar refém de fornecedor único e destravar demo/piloto sem custo marginal. **Não** vale como plano de corte de custo do que já está em produção.

---

## Alternativas consideradas

**Evolution API.** Descartada. Mais popular no Brasil e com ecossistema n8n/Chatwoot, mas a ativação de licença obrigatória desde a v2.4.0 quebra deploy automatizado, e é Baileys puro — sem hedge de engine.

**Baileys ou whatsapp-web.js direto.** Descartadas. São bibliotecas, não serviços: exigiriam construir sessão, reconexão, storage e REST do zero — trabalho que o WAHA já entrega. whatsapp-web.js ainda carrega Chromium por sessão.

**Migrar tudo para WAHA.** Descartada. Ver "Escopo de uso".

**Não fazer nada.** Descartada, mas é a opção com maior valor imediato de curto prazo: as instâncias Z-API de clínicas pausadas devem ser auditadas antes de qualquer implementação. Cancelar instância ociosa pode render mais, hoje, que este projeto inteiro.

---

## Consequências

**Positivas**
- Custo marginal zero para demo, lab e piloto — hoje R$ 99,99/mês cada.
- Fim da dependência de fornecedor único no canal WhatsApp.
- Força a execução da ADR-003, que já era dívida arquitetural.
- Ativação de tenant de teste vira `docker run` + QR code, sem depender do Partner da Z-API.

**Negativas / trade-offs**
- **Reintroduz um servidor ligado 24/7 na arquitetura** — exatamente o que o trabalho de suspensão do compute do Neon acabou de eliminar. A arquitetura deixa de ser puramente serverless.
- Uptime da sessão passa a ser responsabilidade nossa.
- Terceiro caminho de código no canal WhatsApp: mais superfície de teste e de regressão.
- Quebras de protocolo passam a depender de upstream comunitário.

---

## Riscos abertos

1. **[WAHA issue #2068](https://github.com/devlikeapro/waha/issues/2068)** relata contas banidas logo após a criação da sessão na engine GOWS, pedindo configuração anti-ban recomendada. Não invalida a escolha — é a natureza do não oficial — mas confirma o escopo restrito a números descartáveis.
2. **IP de datacenter compartilhado** entre tenants é sinal de risco. O teto prudente de números por VPS é bem menor que o teto técnico, e ainda não está definido.
3. **Sem SLA e sem suporte.** Só fórum.

---

## Próximos passos

1. **Antes de qualquer código:** auditar o painel da Z-API e cancelar instâncias de clínicas pausadas. Ganho imediato, custo zero.
2. Executar a ADR-003: `resolveChannelAdapter`, mover pacing/polling para o adapter, flexibilizar o enum `whatsapp_provider`.
3. Provisionar uma VPS em São Paulo e subir WAHA com engine GOWS; validar sessão, webhook e mídia com número descartável.
4. Implementar `waha-channel-adapter.ts` ao lado de `zapi-channel-adapter.ts`, com credenciais por organização (URL da instância, API key, nome da sessão) no cofre de credenciais.
5. Expor o provedor como opção no wizard de ativação de tenant, com o escopo de uso visível na tela.
6. Definir o teto de números por IP antes de qualquer uso além de um único número de lab.
