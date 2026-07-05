# Channel Safety Engine + Provider Router — Refinamento

Refinamento técnico e de produto das duas ideias propostas em
`systemops_channel_safety_engine.md` e no PDF `systemops_channel_safety_engine (1).pdf`,
confrontadas com a arquitetura viva descrita em `docs/architecture/current.md`.

Data: 2026-07-05.

## Veredito executivo

A tese central dos documentos está correta e é **compatível com o princípio já
estabelecido da plataforma** ("o sistema decide, a LLM verbaliza"): reputação de
número é comportamento, não provider; portanto o produto precisa de um motor de
governança (gates determinísticos + score + modos operacionais), e o roteamento
de provider é um problema separado, de disponibilidade e custo.

O refinamento muda três coisas em relação aos documentos originais:

1. **O SystemOps já tem ~70% do esqueleto do Safety Engine.** A outbox
   (`outbound_messages` + sender worker) é o ponto único de interceptação que o
   doc propõe criar — ela já existe, com ordenação por conversa, dedupe, retry e
   claim atômico. O que falta não é um motor novo: é fechar os furos (3
   automações fora da outbox), adicionar consentimento durável e caps de
   cadência.
2. **"Provider Router com failover automático" do mesmo número não é viável
   como descrito.** Sessões de providers não oficiais são pareadas por QR ao
   número; migrar Z-API → Evolution exige re-pareamento. O router refinado vira:
   escolha de provider no onboarding + monitor de sessão + **migração
   assistida** + número backup/oficial para clientes críticos.
3. **Dimensionamento por fase.** O doc propõe 6 entidades novas e 7 scores. Para
   o estágio atual (pré-primeira venda, operação conversational-first sem
   campanhas frias), isso é sobre-engenharia. Começamos com 3 mudanças de schema
   e 1 score de regras auditável.

## O que os documentos acertam

- Separar **Reputation Engine** (comportamento) de **Provider Router**
  (rota técnica). Correto e deve ser mantido como princípio.
- **Nunca vender anti-ban.** Vender governança de reputação, monitoramento
  preventivo e continuidade operacional. Alinha com a postura conservadora do
  repo (regras de negócio em código determinístico, não em prompt).
- **Gates antes do envio** como peça mais importante do módulo. Correto — e o
  lugar deles já existe (ver abaixo).
- **Cooling mode e warmup** como modos operacionais simples e explicáveis ao
  cliente. Bom design de produto.
- Manter **trilha oficial** (Meta Cloud API / BSP) para clientes maiores e
  números sensíveis. O adapter Meta já existe como compatibilidade — vira
  argumento comercial, não custo novo.

## Confronto: o que a plataforma já tem

| Proposta do documento | Estado atual | Onde |
| --- | --- | --- |
| "Interceptar todo outbound antes do provider" | **Parcial.** Fluxo conversacional principal já passa por outbox + sender worker; 3 automações enviam direto | `src/application/jobs/send-message-job.ts`, `docs/architecture/current.md` ("O que ainda é híbrido") |
| Gate de cadência / anti-comportamento robótico | **Embrião.** Pacing de 1,2s entre partes + confirmação de saída da fila Z-API antes da próxima parte | `outbound-delivery-service.ts` (`minGapMs`, `waitForDelivery`) |
| Limite de tentativas sem resposta | **Parcial.** Recovery campaign tem cap lifetime de 3 por lead; follow-ups são contextuais (pós-vídeo, pós-conversa) | `api/cron/recovery-campaign/route.ts` |
| Monitor de sessão / alerta de queda | **Existe.** Probe de saúde do canal por clínica ativa + e-mail crítico ao owner | `api/cron/channel-health-alert/route.ts`, `application/health/channel-health.ts` |
| Multi-provider por tenant | **Existe (2 rotas).** `z_api` \| `meta_cloud_api` por clínica, credencial cifrada, sem fallback global por env | `channel-config.ts`, `whatsappProviderEnum` |
| Telemetria de custo por categoria WhatsApp | **Existe.** `whatsapp_message_costs` + enum service/utility/marketing/authentication | `schema.ts` |
| Pausa operacional por conversa | **Existe.** `aiPaused` / takeover humano; shadow mode por clínica (envia nada, persiste tudo) | `ConversationOrchestrator`, `send-message-job.ts` |
| Opt-out / consentimento durável | **Não existe.** Nenhum intent de "pare de me mandar mensagem"; nenhum campo de consentimento no lead | — |
| Caps por número/dia/hora aplicados no envio | **Não existe.** Volume é limitado indiretamente (cron schedule, caps de campanha), não por gate | — |
| Health score / temperatura / cooling / warmup | **Não existe** | — |
| Categoria de outbound (reply vs automação vs campanha) | **Não existe** na outbox — sem ela nenhuma política diferenciada é possível | `outbound_messages` |

Leitura importante do confronto: o SystemOps opera **conversational-first**
(responde quem chamou; automações são contextuais e capadas). Esse é exatamente
o "modo seguro" que o próprio documento descreve como alvo de resfriamento. O
risco hoje não vem de campanhas frias (não existem) — vem de (a) automações que
insistem com quem pediu para parar, (b) ausência de teto de volume quando a
base crescer, (c) furos de interceptação. É isso que a Fase 0 fecha.

## Correções às propostas originais

### 1. Provider Router ≠ failover em tempo de mensagem

Para providers não oficiais (Z-API, Evolution, WAHA), a sessão é um pareamento
QR do número. Não existe "se Z-API falhar, manda pela Evolution" para o mesmo
número no mesmo instante. As decisões de roteamento reais são:

- **No onboarding:** escolher provider pelo perfil do cliente (SaaS gerenciado
  vs. self-hosted vs. oficial).
- **Na queda de sessão:** pausar outbound + alertar owner (já existe) — nunca
  reenviar às cegas por outra rota.
- **Na migração:** processo assistido com re-pareamento, janela controlada e
  verificação — um playbook operacional, não um balanceador.
- **Para críticos:** número backup ou trilha oficial como redundância real
  (números diferentes, não providers diferentes do mesmo número).

### 2. Evolution API como "provider barato principal": ainda não

O doc recomenda Evolution self-hosted como base. Discordância para o estágio
atual: self-hosted significa VPS, sessões, atualizações e observabilidade
próprias — exatamente o tipo de carga operacional que o norte atual (fechar as
primeiras vendas, confiabilidade primeiro) manda evitar. Z-API SaaS permanece a
rota principal; Evolution entra como **otimização de margem com gatilho
explícito** (quando `nº de clientes × custo Z-API/instância` superar custo de
VPS + manutenção + risco, análise do `especialista-infra`). Nunca trocar para
economizar degradando confiabilidade.

### 3. Dos 7 scores para 1 score auditável

Sem histórico próprio, 7 scores são chute com casas decimais. Começar com um
`health_score` único por regras (a fórmula simples do próprio doc), calculado
sobre contadores que já são deriváveis do banco (`messages`, `conversations`,
quedas registradas pelo probe). Os sub-scores viram evolução natural quando
houver dados reais de produção — o próprio doc admite isso na seção 7.2.

### 4. Das 6 entidades para 3 mudanças de schema

`ChannelAccount`, `ProviderInstance`, `PhoneReputation`, `ConsentRecord`,
`SafetyEvent`, `RouteDecision` — no monólito atual, o equivalente enxuto é:

1. coluna `category` em `outbound_messages` (a peça-chave: sem ela não há
   política por tipo de envio);
2. consentimento no lead (`contact_consent` + timestamp + origem);
3. tabela `channel_health_snapshots` (Fase 1) para score e temperatura.

`ChannelAccount`/`ProviderInstance` já são as colunas de canal em
`organizations`; `RouteDecision` só faz sentido quando existir mais de uma rota
por tenant.

## Arquitetura refinada

```text
ConversationOrchestrator / automações (reminder, follow-up, recovery)
  -> enqueueOutboundMessage(category)          ← TODAS as saídas passam aqui
     -> outbound_messages (category, dedupe, sequence)
     -> jobs(message.send)

/api/cron/sender-worker
  -> SendMessageJobHandler
     -> SAFETY GATE (novo, determinístico, nesta ordem):
        1. consentimento: lead opted-out?     → cancel + evento
        2. modo do canal: cooling/frozen?     → política por category
        3. cadência: cap hora/dia estourado?  → defer (re-agenda), nunca drop
        4. quiet hours da clínica?            → defer para janela comercial
     -> OutboundDeliveryService (pacing + confirmação — já existe)
     -> ChannelProviderAdapter (port; z_api | meta_cloud_api hoje)
     -> telemetria → contadores → health score → modo do canal
```

Propriedades que essa forma preserva ou ganha:

- **Segurança:** gates são código determinístico no ponto único de saída;
  nenhuma política depende de prompt; consentimento é durável e auditável.
- **Resiliência:** falha de gate = defer ou cancel explícito com razão
  persistida — nunca exceção solta; retry/dead-letter da outbox já existem.
- **Confiabilidade:** unificar as 3 automações na outbox **remove** três
  caminhos de envio paralelos (menos código divergente, mais cobertura de
  teste no mesmo funil).
- **Escalabilidade:** caps por tenant impedem que um cliente de volume alto
  queime o próprio número (e o pipeline); a port de provider permite adicionar
  Evolution/360dialog sem tocar no core.
- **Disponibilidade:** probe + alerta já existem; cooling degrada gradualmente
  (só reply) em vez de desligar tudo; trilha oficial/backup vira plano de
  continuidade para clientes críticos.

## Roadmap refinado

### Fase 0 — Fechar os furos (pré/durante primeiro cliente pago, ~1 sprint)

Pré-requisito de todo o resto e valor imediato para o prospect Vitalli.

1. **`outbound_messages.category`** (`reply` | `follow_up` | `reminder` |
   `recovery` | `campaign` | `operational`) e migração de
   `appointment-reminder`, `follow-up-dispatcher` e `recovery-campaign` para a
   outbox (fronteira já apontada em `current.md`).
2. **Opt-out durável:** intent `stop_contact` no `IntentClassifier` ("não me
   mande mais mensagem", "sai dessa lista", "para de mandar") → grava
   consentimento revogado no lead → gate bloqueia toda categoria exceto `reply`
   a inbound novo do próprio lead. Resposta de confirmação respeitosa via
   composer. **É o gap de maior risco hoje** — a recovery campaign pode
   reabordar quem pediu para parar.
3. **Gate de cadência mínimo:** caps por clínica no banco (defaults
   conservadores, a calibrar: ~40 outbound/hora, ~200/dia, ~25 contatos
   novos/dia) + quiet hours pela janela comercial da clínica. Estouro → defer.
4. **Trilha de decisão:** cancelamentos/deferrals do gate persistem razão
   (`status=cancelled` + motivo) e logam evento estruturado — auditoria sem
   tabela nova nesta fase.

### Fase 1 — Trust Engine v1 (primeiros clientes ativos)

5. **`channel_health_snapshots`** por clínica/dia: enviadas 24h/7d, contatos
   novos, taxa de resposta, opt-outs, quedas de sessão → `health_score` por
   regras (fórmula simples e auditável).
6. **Modos operacionais** no canal: `normal` | `atencao` | `cooling` |
   `frozen`, com política determinística por `category` (cooling = só `reply` +
   `reminder` de compromisso confirmado). Automático por score, manual pelo
   owner — reusa o padrão do shadow mode.
7. **Warmup:** número novo entra com caps reduzidos que sobem por semana de
   idade (config no onboarding).
8. **Painel:** visão cliente (nota + temperatura + recomendação objetiva) e
   visão owner (comparativo por clínica, fila de cooling). UI com
   `designer-ux`; vira a feature comercial **Reputation Guard**.

### Pareamento no nosso portal (encaixa no onboarding comercial guiado)

Hoje a conexão do número exige acessar o painel da Z-API. A Z-API expõe por API
tudo o que é preciso para trazer isso para dentro do SystemOps:

- `GET .../qr-code/image` — QR em base64 para renderizar no nosso onboarding
  (expira; exige polling/refresh);
- `GET .../phone-code/{phone}` — código de pareamento digitado no próprio
  WhatsApp ("Conectar com número de telefone"), sem câmera — UX melhor quando o
  cliente faz o onboarding pelo celular;
- webhooks de conectado/desconectado para acompanhar o status em tempo real
  (o probe de saúde já consulta status hoje).

O método de pareamento em si **não** muda a reputação do número. O ganho é
indireto, mas real:

1. menos re-pareamentos e QR repetido (sinal de risco: sessão instável/relogin
   frequente) — fluxo guiado reduz tentativas falhas;
2. a conexão vira ponto de controle: capturar idade do número, iniciar warmup
   com caps reduzidos, registrar consentimento e configuração antes do primeiro
   envio;
3. o cliente nunca entra no painel da Z-API — não desconecta sem querer, não
   mexe em configuração, não usa disparo manual;
4. experiência 100% SystemOps (white-label), menos suporte.

Entregável junto com o onboarding comercial guiado; independente do Safety
Gate, pode andar em paralelo.

### Fase 2 — Provider layer (escala/margem)

9. **Port `ChannelProviderAdapter`** formal (send text/media/audio, status,
   health) extraída dos adapters atuais sem mudar comportamento.
10. **Evolution API** como adapter novo quando o gatilho de margem disparar
    (decisão `especialista-infra`); WAHA opcional como rota de laboratório.
11. **Trilha oficial** (Meta Cloud direto ou 360dialog) como oferta
    Scale/Enterprise para números sensíveis + **migração assistida** de
    provider/número (playbook + tooling) — nunca vendida como failover
    transparente.

Fica de fora (por ora, alinhado ao doc V2): modelo preditivo, análise semântica
de risco, Policy Watcher automatizado, benchmark por segmento.

## Relação com o systemops-platform

Dois módulos conceituais (Safety Engine e Provider layer), **um repositório por
fase de vida**:

- **Agora (Fases 0–1): dentro do sales-engine**, como módulos do monólito
  modular — `src/application/channel-safety/` (gates e políticas como funções
  puras testáveis) e os adapters de provider onde já vivem
  (`infrastructure/adapters/channels/`). O gate precisa estar inline no caminho
  de envio, com acesso transacional a outbox/jobs/leads; extrair para outro
  serviço agora adicionaria rede, auth, versionamento e novos modos de falha
  exatamente onde queremos confiabilidade. O próprio platform declara o
  princípio: "event-driven, but not prematurely distributed".
- **Longo prazo: o platform é o destino natural** — `packages/contracts/*`
  ("provider-neutral capability contracts") é onde o contrato de Channel
  Provider pertence, e channel safety é capability segment-agnostic (o platform
  nunca conhece segmento; reputação de canal não tem segmento). O que migra é o
  **contrato e o aprendizado** (telemetria real de opt-out, caps, warmup da
  operação do sales-engine), não necessariamente o código.
- Regra de extração: extrair quando houver **segundo consumidor** ou
  necessidade de escala divergente — nunca por estética. Fronteiras limpas de
  módulo no monólito tornam a extração mecânica no dia em que fizer sentido.

## Posicionamento comercial

- Nome de feature: **Reputation Guard** (ou "Governança de Canais") como
  diferencial de plano Growth+ — consistente com o roteamento de composer
  premium por plano já em produção.
- Discurso: "o SystemOps não garante que um número nunca será bloqueado; ele
  reduz risco, detecta sinais cedo e protege o ativo que faz a clínica vender".
- Termo de uso deve declarar o risco de providers não oficiais
  (item para `estrategista-gtm` + revisão legal).
- Para a Vitalli: o comportamento conversational-first + monitoramento já é o
  argumento; a trilha oficial existente é o plano de continuidade.

## Decisões em aberto

1. **Sequenciamento vs. observabilidade:** a recomendação é concluir Sentry
   (branch `chore/sentry-observability`) antes da Fase 0 — exceto o item 2
   (opt-out), que pode adiantar por ser risco reputacional/legal direto com o
   primeiro cliente.
2. **Valores default dos caps** (propostos acima como placeholder conservador)
   — calibrar com o volume real da primeira clínica ativa.
3. **Nome comercial** da feature (Reputation Guard vs. Governança de Canais).
