# SystemOps Dental Conversion — Rebuild Design

**Status:** aprovado em brainstorming; aguardando revisão do documento pelo usuário

**Data:** 2026-08-09

**Primeiro produto de prateleira:** odontologia estética, com foco inicial em facetas/lentes em resina composta

**Documento:** desenho mestre do programa; cada marco de execução terá plano e branch próprios

## 1. Decisão executiva

O SystemOps deixa de ser apresentado como um CRM horizontal com IA e passa a ser uma **operação gerenciada de conversão para clínicas**. O software conduz o atendimento, agenda e recuperação; a equipe SystemOps configura, audita e melhora a operação; o cliente trabalha na clínica e intervém apenas em decisões rápidas ou exceções.

O primeiro produto é o **SystemOps Dental Conversion — Resina Composta v1**, destinado a clínicas odontológicas estéticas que investem em aquisição de leads, especialmente anúncios que levam ao WhatsApp, e que possuem ticket e volume suficientes para sentir economicamente a perda de conversão.

A conversão principal é:

> lead atribuível agenda e comparece a uma avaliação.

Aceitação do tratamento, procedimento realizado e pagamento são resultados posteriores que também devem ser medidos, sem transformar promessa comercial em garantia de receita.

Quatro clientes foram pausados e não estão sendo cobrados: Ximendes, Vitalli, NC Beauty e Maycon. Nenhum deles será reativado automaticamente. Ximendes não pode ser operada nem alterada; somente dados históricos sanitizados podem informar o desenho. O laboratório oficial será o tenant e número próprios **SystemOps Lab**.

## 2. Por que a primeira validação falhou

As falhas formam um sistema, não uma lista de funcionalidades ausentes:

1. O setup demorava e exigia informação demais. A fricção destruía confiança antes de o produto demonstrar valor.
2. A IA às vezes falava demais, respondia errado, enviava conteúdo sem sentido, inferia fatos que não possuía ou perdia o momento comercial.
3. O produto não dominava o atendimento e a venda vertical. Uma resposta gramaticalmente boa não compensava uma jornada comercial incompleta.
4. A navegação era lenta e a inbox não tinha a fluidez esperada de uma ferramenta que substitui parte do WhatsApp.
5. Campanhas e follow-ups não estavam prontos para uso confiável.
6. Dashboards misturavam heurísticas e indicadores sintéticos com fatos operacionais, reduzindo a credibilidade.
7. O produto foi levado a clientes antes de existir uma disciplina de ativação, replay, copilot e go-live gradual.
8. Não existia uma estratégia gerenciada de conversão ligando aquisição, atendimento, agenda, comparecimento e aprendizado comercial.

### 2.1 Evidências dos quatro clientes

| Cliente | Evidência principal | Regra para o rebuild |
| --- | --- | --- |
| Ximendes | Primeiro laboratório; expôs falhas reais de conversa, conteúdo e handoff. | Histórico somente sanitizado. Nenhuma ação, mensagem ou alteração no tenant. |
| Vitalli | A equipe humana cobria preço, quantidade fora do padrão, objeções, sinal e confirmação; a IA abria rápido, mas falhava no meio e no fim do funil. | Transformar padrões em cenários de replay; nunca copiar dado clínico/comercial sem aprovação e proprietário canônico. |
| NC Beauty | Permaneceu principalmente em teste/shadow, sem prova de operação autônoma real. | Shadow online não vale como evidência de qualidade; validação exige replay fiel e laboratório. |
| Maycon | Houve falha `clinic_not_resolved` durante onboarding. | Tenant precisa ser resolvido e testado antes de qualquer automação ou mensagem. |

### 2.2 Padrões reutilizáveis observados na Vitalli

- Responder a pergunta antes de despejar pitch.
- Fazer uma pergunta curta de contexto antes de mídia e explicação extensa.
- Tratar técnicas e pacotes como variantes comerciais explícitas, com aliases controlados.
- Nunca calcular preço de quantidade não cadastrada.
- Usar apenas horários provenientes da agenda real.
- Manter sinal, confirmação e comparecimento como estados diferentes.
- Parar e entregar ao humano em fratura, manutenção, garantia, queixa, urgência, foto clínica ou exceção financeira.
- Suprimir automação enquanto um operador está ativo.
- Interromper follow-up quando o lead responde, recusa, opta por sair ou entra em atendimento humano.

## 3. Tese de produto e posicionamento

CRMs como Kommo, RD Station, Zenvia e HighLevel já oferecem combinações de WhatsApp, pipeline, automação e campanhas. Produtos de conversation intelligence como Gong, Salesforce e HubSpot transformam conversas em coaching e próxima ação. Soluções verticais como Liine e Patient Prism aproximam atendimento do resultado econômico da clínica.

O espaço defendível do SystemOps não é “ter IA no WhatsApp”. É:

> operar a conversão vertical, com decisões determinísticas, atendimento autônomo, prova auditável e consultoria de melhoria contínua.

### 3.1 O que começa como serviço

- Descoberta e importação da operação real.
- Configuração do template e políticas.
- Auditoria de conversas e perdas.
- Reunião ou grupo operacional de conversão.
- Recomendações sobre oferta, mídia, objeções, capacidade e qualidade do lead.
- Tratamento de exceções ainda não repetíveis.

### 3.2 O que merece virar software

Uma atividade vira funcionalidade somente quando:

1. aparece de forma semelhante em mais de uma clínica;
2. possui entradas e saídas objetivas;
3. pode ser executada sem julgamento clínico ou comercial não configurado;
4. pode ser testada deterministicamente;
5. produz evento e resultado auditáveis.

## 4. Escopo do primeiro produto

### 4.1 Incluído na v1

- SystemOps Lab isolado.
- Template odontológico versionado para resina composta.
- Onboarding gerenciado em três marcos.
- Motor conversacional seguro e modularizado progressivamente.
- Preço, agenda, reserva, sinal, confirmação e handoff determinísticos.
- Follow-ups ligados à jornada, com stop conditions.
- Ledger append-only de eventos comerciais.
- UX “Ação primeiro”.
- Inbox rápida, agenda operacional e Crescimento baseado em evidência.
- Captura de atribuição disponível no canal, com campos preparados para Meta.
- Operação humana assistida e piloto controlado.

### 4.2 Fora da v1

- Criação ou otimização automática de anúncios.
- Expansão simultânea para vários segmentos.
- Campanhas massivas antes da estabilização do atendimento e follow-up.
- Marketplace de templates em banco antes de existir um segundo segmento validado.
- Promessa de receita, ROAS ou conversão sem atribuição e eventos completos.
- Clínica fictícia anunciada ao público como se fosse uma operação real.

## 5. ICP e critérios de elegibilidade

O ICP inicial é uma clínica odontológica estética com:

- aquisição recorrente por Meta/Instagram para WhatsApp;
- foco em facetas/lentes em resina ou serviço estético de ticket relevante;
- volume suficiente para medir atendimento e agenda;
- capacidade real na agenda;
- preços, condições, responsáveis e exceções documentáveis;
- disposição para integrar agenda e concluir os eventos de comparecimento e venda;
- gestor que deseja autonomia, não um CRM para alimentar manualmente.

O relato de investimento de R$ 10–15 mil/mês em tráfego é evidência anedótica do círculo de validação, não média comprovada do mercado. Ele ajuda a identificar um ICP, mas não será publicado como benchmark.

## 6. Jornada comercial canônica

```text
anúncio/referral
  -> WhatsApp
  -> resposta útil e direta
  -> uma qualificação curta
  -> técnica/variante identificada
  -> preço estruturado
  -> prova ou mídia adequada
  -> dois horários reais
  -> reserva provisória
  -> sinal, quando configurado
  -> confirmação
  -> lembrete
  -> comparecimento
  -> tratamento aceito
  -> pagamento
```

O lead pode entrar em qualquer ponto da jornada. O sistema não repete apresentação, pitch ou mídia já entregues. Mudança de assunto interrompe o pipeline anterior e reavalia o próximo passo.

### 6.1 Regras conversacionais

- Responder primeiro ao que foi perguntado.
- Uma ideia principal por mensagem ou grupo curto de bolhas.
- No máximo uma pergunta principal por turno.
- Não repetir informação já conhecida.
- Não enviar mídia antes de existir contexto e permissão no pipeline.
- Não apresentar preço, quantidade, técnica, prazo, condição ou promessa ausente da configuração ativa.
- Oferecer apenas horários retornados pela agenda naquele turno.
- Encerrar com próximo passo concreto.
- Entregar ao humano sem continuar vendendo quando houver exceção sensível.

## 7. Produto de prateleira e fontes de verdade

O template é um artefato de instalação versionado. Ele não é uma segunda fonte de verdade consultada pelo runtime.

### 7.1 Conteúdo do template

- segmento e caso de uso;
- vocabulário e aliases;
- tratamentos canônicos;
- variantes e pacotes comerciais;
- placeholders obrigatórios;
- pipeline por tratamento;
- perguntas de qualificação;
- objeções e respostas autorizadas;
- estrutura de mídia e captions;
- follow-ups e stop conditions;
- razões de handoff;
- módulos necessários;
- cenários de replay;
- critérios de ativação.

### 7.2 Instalação e atualização

1. A primeira versão vive como manifest versionado no código.
2. Um serviço de aplicação valida o manifest e produz um plano de instalação.
3. O plano escreve somente nos proprietários canônicos do runtime.
4. A instalação registra template, versão, digest, clínica, campos personalizados e ator.
5. O runtime usa `organizations`, `treatments`, `playbook_versions`, módulos e demais tabelas canônicas; não consulta o manifest para decidir conversa.
6. Uma atualização futura gera diff revisável e nunca altera automaticamente uma clínica ativa.
7. Um catálogo editável em banco só será introduzido após validar o segundo segmento.

### 7.3 Propriedade de dados

| Informação | Proprietário |
| --- | --- |
| Tom, objeções e conteúdo editorial | `playbook_versions` |
| Horários, timezone, buffers e limites | `organizations` / entidade Clinic |
| Tratamentos, aliases e pipeline | `treatments` |
| Preços e condições | `commercialPolicy` do playbook ativo |
| Estado da conversa | `conversation_states` |
| Reserva e agendamento | `SlotReservationService` e `BookingService` |
| Texto final | `ContentBlock`/LLM dentro do plano autorizado |

Nenhuma regra clínica específica será hardcoded em prompt. Nenhum dado terá dois donos.

## 8. Arquitetura conversacional alvo

O princípio permanece:

> O LLM entende e verbaliza; o sistema decide.

```text
inbound autenticado
  -> tenant resolvido
  -> snapshot de configuração/versionamento
  -> intenção e evidências
  -> plano de resposta autorizado
  -> ação determinística
  -> resultado da ação
  -> composição verbal
  -> validação da resposta
  -> outbox
  -> entrega
  -> evento comercial
```

### 8.1 Extração progressiva do orquestrador

Não haverá reescrita total. O `ConversationOrchestrator`, hoje excessivamente grande, será reduzido por seams testáveis:

- `TreatmentJourneyService`;
- `CommercialPolicyService`;
- `AgendaOfferService`;
- `ReservationAndDepositService`;
- `HandoffPolicy`;
- `FollowUpPolicy`;
- `ResponsePlanBuilder`;
- `ResponseValidator`;
- `CommercialEventRecorder`.

Cada unidade recebe tipos explícitos e não acessa dados de outra clínica sem `clinicId` resolvido. Rotas HTTP continuam finas.

### 8.2 Plano de resposta autorizado

Antes do composer, o sistema cria um plano contendo:

- fatos permitidos;
- fatos ausentes que não podem ser inferidos;
- ação executada e resultado;
- próxima ação permitida;
- número máximo de perguntas;
- mídia permitida;
- orçamento de tamanho;
- estado esperado ao terminar.

Depois do composer, o `ResponseValidator` bloqueia preço, condição, horário, promessa ou ação fora do plano. Uma falha de validação usa cópia determinística segura ou handoff; nunca envia a resposta inválida.

### 8.3 Acordar workers sem perder durabilidade

Um `JobWakeupPort` será chamado depois da persistência de evento/job:

1. persiste `inbound_event` e job;
2. tenta acordar o worker imediatamente;
3. se falhar, o cron atual continua como reconciliação;
4. dedupe e lease impedem duplicidade.

Meta do Lab: primeira resposta útil p95 abaixo de 15 segundos.

### 8.4 Falhas seguras

| Falha | Comportamento |
| --- | --- |
| Configuração incompleta | Bloqueia ativação. |
| Classificador indisponível | Resposta curta determinística ou handoff. |
| Composer indisponível | Cópia segura baseada no resultado real. |
| Agenda indisponível | Não oferece slot; registra retomada. |
| Canal indisponível | Outbox, retry, alerta e idempotência. |
| Evento duplicado | Dedupe sem segundo efeito. |
| Humano ativo | Automação suprimida. |
| Foto/tema clínico sensível | Pausa durável e handoff. |
| Quantidade/preço desconhecido | Não infere; solicita confirmação humana. |
| Incidente crítico repetido | Kill switch por clínica. |

## 9. Follow-ups e campanhas

Follow-up é parte da jornada v1, não campanha genérica.

Cada follow-up possui:

- motivo e estado de origem;
- horário permitido e timezone da clínica;
- prazo de validade;
- limite de tentativas;
- conteúdo autorizado;
- stop conditions;
- dedupe key;
- evento de disparo, entrega, resposta e encerramento.

O follow-up é cancelado quando há resposta, agendamento, opt-out, atendimento humano, mudança incompatível de estado ou expiração. Falha de canal permanece na outbox e não recompõe texto a cada retry.

Campanhas massivas e reativação em lote só entram depois de zero incidentes críticos no piloto. Elas devem usar os mesmos contratos de consentimento, quiet hours, outbox, idempotência, supressão humana e atribuição. A funcionalidade atual não é considerada pronta enquanto targets permanecerem apenas como `queued` sem reconciliação terminal confiável.

## 10. Eventos comerciais e métricas confiáveis

O sistema terá um ledger append-only. Eventos mínimos:

- `lead_received`;
- `first_useful_reply_sent`;
- `technique_identified`;
- `price_presented`;
- `media_presented`;
- `slot_offered`;
- `booking_reserved`;
- `deposit_requested`;
- `deposit_confirmed`;
- `booking_confirmed`;
- `attended`;
- `treatment_accepted`;
- `payment_confirmed`;
- `lost`;
- `opt_out`.

Cada evento contém `clinicId`, tipo, horário, ator/origem, versão de schema, dedupe key e referências opcionais a lead, conversa, agendamento e atribuição. Metadados devem ser mínimos e não duplicar corpo de mensagem ou dado clínico.

Dashboards e recomendações leem eventos ou projeções derivadas. Todo número exibido ao cliente abre sua composição e chega até conversas/eventos de origem. Indicadores atuais sem cadeia de evidência — incluindo autonomia, tempo economizado, score ou receita inferida — serão removidos ou explicitamente marcados como estimativa interna, nunca KPI comercial.

## 11. UX “Ação primeiro”

A tela inicial não é dashboard nem inbox. É uma fila priorizada do trabalho que ainda precisa de pessoa.

### 11.1 Navegação principal

- **Agora:** decisões, exceções, oportunidades e resultados.
- **Conversas:** execução no padrão de fluidez do WhatsApp.
- **Agenda:** capacidade, reservas, confirmações, faltas e slots recuperáveis.
- **Crescimento:** funil, campanhas, perdas e recomendações comprováveis.
- **Organização:** configuração, equipe, biblioteca e detalhes administrativos.

Pipeline é lente/filtro, não destino principal.

### 11.2 Contrato de work item

Cada item de “Agora” possui:

- sinal observado;
- evidência;
- impacto;
- ação recomendada;
- responsável;
- SLA;
- estado;
- resultado.

Há uma ação principal e alternativa segura para assumir a conversa. Alertas genéricos e insights sem fonte são proibidos.

### 11.3 Experiência por papel

| Papel | Prioridade |
| --- | --- |
| Gestor | Resultados, risco, capacidade e exceções. |
| Recepção | Fotos, pagamentos, handoffs e fila pessoal. |
| Dentista | Decisões clínicas essenciais. |
| SystemOps | Qualidade, incidentes e oportunidades entre clínicas. |

### 11.4 Inbox

Desktop usa fila, conversa e painel de evidência/contexto. Mobile usa conversa em tela cheia e gaveta de contexto. Requisitos:

- texto, áudio e mídia;
- estado enviando/enviado/falhou;
- rascunho persistente;
- assumir e devolver à automação;
- abrir origem, interesse, próximo passo, agenda e histórico;
- paginação reversa do histórico;
- nenhuma mudança inesperada de posição ou perda de texto.

## 12. Arquitetura de desempenho

A lentidão não será tratada apenas com servidores maiores.

### 12.1 Causas estruturais confirmadas

No código atual:

- a Inbox busca todas as conversas da clínica sem paginação;
- o conjunto completo alimenta várias consultas de mensagens, agendamentos, estados e revisões;
- `/api/inbox/check` roda a cada cinco segundos e executa quatro agregações;
- existe refresh completo forçado a cada minuto;
- o chat consulta uma versão a cada três segundos;
- várias mutations chamam `router.refresh()`;
- páginas principais são `force-dynamic`;
- não há índice composto para a leitura principal `clinicId + lastMessageAt`.

Esse padrão faz o custo crescer com usuários ociosos e histórico acumulado, mesmo sem eventos novos.

### 12.2 Modelo híbrido aprovado

```text
shell persistente
  -> cache local por tenant
  -> UI otimista
  -> APIs por cursor/delta
  -> read models
  -> banco e ledger

evento de domínio
  -> RealtimeEventPort
  -> canal privado da clínica
  -> cliente invalida somente o recurso afetado
  -> polling adaptativo como fallback
```

Decisões:

- Primeira página de listas: 30–50 registros por cursor.
- Histórico de conversa: 60 mensagens iniciais, busca reversa incremental.
- Virtualização de listas grandes.
- Cache preservado ao navegar; prefetch apenas de destinos prováveis.
- Mutations otimistas com operation ID, confirmação e rollback visual.
- Mídia lazy e thumbnails.
- Read models para Inbox, Agora e contadores.
- Índices compostos alinhados às consultas medidas.
- Nenhum refresh total para alteração de um único item.

### 12.3 Tempo real sem explosão de infraestrutura

O domínio depende de `RealtimeEventPort`, não de um SDK específico. No piloto, o adapter inicial usa um serviço gerenciado de pub/sub com canais privados por clínica. A decisão inicial é **Ably**, sujeita ao contrato de dados e aprovação de produção.

Motivos:

- evita manter uma Vercel Function presa por cada conexão;
- oferece reconexão e fallback prontos;
- permite começar no limite gratuito do Lab e migrar para plano de produção previsível;
- deixa a aplicação independente por meio da port.

Somente eventos pequenos de invalidação atravessam o canal: tipo, recurso, versão e ID opaco. Corpo de conversa, nome, telefone, foto, dados clínicos, preço ou pagamento não atravessam o fornecedor de tempo real.

Realtime não é fonte de verdade. O evento só é publicado depois da escrita durável; o cliente usa a versão recebida para buscar o delta na API. Se perder um evento, o cursor persistido e o sync incremental recuperam a diferença.

Se realtime falhar:

- UI permanece operacional;
- polling inicia em 15–30 segundos;
- backoff chega a 60 segundos sem mudanças;
- polling pausa com aba oculta;
- retorno à aba força apenas sync incremental;
- push cobre eventos críticos quando o app está fechado.

O Lab opera dentro do tier gratuito vigente. No piloto, haverá alerta ao atingir o equivalente a US$ 25/mês e kill switch ao projetar US$ 50/mês de realtime. O kill switch fecha as conexões, interrompe publicação e ativa o fallback; atendimento, escrita e outbox continuam operando. O polling de fallback consulta uma única versão materializada por tenant/recurso, nunca repete as quatro agregações atuais. O adapter pode ser trocado por WebSocket próprio ou outro provedor sem alterar UI ou domínio.

### 12.4 Metas de desempenho

| Métrica | Meta p75 |
| --- | --- |
| Feedback visual após toque | < 100 ms |
| Tela já visitada | < 300 ms |
| Primeira abertura da aplicação | < 1,5 s |
| Abrir conversa | < 800 ms |
| Nova mensagem visível | <= 1 s |
| Primeira resposta útil no Lab | p95 < 15 s |

Medição separa navegação, rede, servidor, banco, tamanho de payload, renderização e atraso do evento. Nenhuma meta será declarada atingida sem telemetria de produção ou ambiente equivalente.

## 13. Onboarding gerenciado

O cliente não preenche um formulário extenso nem decide arquitetura.

### Marco 1 — Conectar

- WhatsApp;
- agenda;
- usuários;
- origem dos leads.

### Marco 2 — Ensinar

SystemOps importa site, documentos, materiais e amostra sanitizada de conversas. O sistema/equipe apresenta um resumo estruturado e um diff. O cliente apenas confirma ou corrige:

- tratamentos e nomes;
- preços e condições;
- agenda e responsáveis;
- objeções e handoffs;
- mídia e permissões.

### Marco 3 — Ensaiar e ativar

- replay fiel;
- cenários do template;
- SystemOps Lab;
- copilot;
- live limitado;
- autonomia.

Responsabilidade do cliente: parear integrações, confirmar fatos essenciais e aprovar go-live. Responsabilidade SystemOps: instalar, configurar, testar, acompanhar e produzir evidência.

## 14. SystemOps Lab e segurança de canal

O nome alterado na Z-API não muda o tenant no banco. O vínculo ocorre por instance ID.

Procedimento obrigatório:

1. rotacionar o token Z-API exposto anteriormente;
2. nunca usar o token presente em screenshot ou histórico;
3. criar `SystemOps Lab` com `isTest=true` e automação desativada;
4. remover qualquer associação do instance ID com Ximendes;
5. anexar a credencial nova ao Lab;
6. validar `resolveClinicByZapiInstance`;
7. validar segredo/autenticação do webhook;
8. usar agenda sintética e contatos controlados;
9. marcar eventos e métricas como Lab;
10. ativar automação somente depois dos gates.

É proibido usar o laboratório para se passar por clínica real em publicidade ou atendimento público.

## 15. Replay e gates de qualidade

O conjunto mínimo possui 12 famílias:

1. abertura genérica de anúncio de resina;
2. pergunta ambígua de preço;
3. pacote exato e parcelamento;
4. quantidade/arcada não padrão;
5. prova, cor e resultado;
6. foto para pré-avaliação;
7. data/horário explícito;
8. slot, sinal e confirmação;
9. promoção antiga;
10. manutenção, garantia ou caso atípico;
11. takeover e continuidade humana;
12. follow-up seguro.

Cada família possui variações de linguagem, áudio, burst, repetição, troca de assunto e retorno posterior. O replay entra pelo webhook e atravessa filas, orquestrador, estado e sender de captura conforme o contrato de fidelidade existente.

### 15.1 Gates absolutos

- zero vazamento de tenant;
- zero preço ou condição inventados;
- zero horário inexistente;
- zero envio duplicado;
- zero automação durante takeover;
- zero follow-up fora da política;
- 100% dos handoffs obrigatórios;
- 100% dos golden paths no estado correto;
- >= 99% de entrega controlada;
- nenhuma regressão em datasets sanitizados e assinados.

## 16. Operação humana assistida

No primeiro estágio, o produto é serviço gerenciado apoiado pelo software.

### 16.1 Sala de Conversão

- grupo operacional com responsáveis definidos;
- revisão semanal de funil e qualidade;
- perdas por motivo;
- objeções e gaps de configuração;
- capacidade e horários ociosos;
- origem/campanha quando disponível;
- plano de ação com responsável, prazo e resultado.

O grupo não serve para o cliente configurar o sistema. Serve para a SystemOps mostrar o que observou, recomendar a ação e executar o que for de sua responsabilidade.

## 17. Piloto, autonomia e cobrança

Ordem de ativação:

```text
configuração
  -> replay
  -> Lab
  -> copilot
  -> live limitado
  -> autonomia
  -> expansão
```

Um piloto precisa acumular **30 dias e pelo menos 50 leads elegíveis**. Casos clínicos/sensíveis e exceções comerciais configuradas não entram no denominador de autonomia.

Critérios:

- gates absolutos da seção 15;
- primeira resposta útil p95 < 15 segundos;
- autonomia >= 90% dos casos elegíveis;
- nenhum incidente crítico aberto;
- métricas rastreáveis;
- lead-to-booked e booked-to-attended não piores que a baseline acordada da mesma origem, quando houver amostra histórica utilizável;
- se não houver baseline confiável, meta explícita é assinada antes do piloto.

Os quatro clientes pausados não recebem cobrança retroativa. Um design partner volta a pagar somente após aceitação formal do piloto. A oferta comercial posterior combina implantação, mensalidade de plataforma/operação e, apenas no futuro, componente variável ligado a resultado auditável.

## 18. Meta Ads e ecossistema futuro

### 18.1 Preparar agora

Capturar, quando o canal fornecer:

- origem/referral;
- UTM;
- campanha, conjunto, anúncio e criativo;
- identificador de click-to-message;
- primeira resposta útil;
- qualificação;
- agendamento;
- comparecimento;
- aceitação;
- pagamento;
- perda e motivo.

Campos são nullable; dado ausente não pode ser inventado. Hoje o adapter Z-API não entrega atribuição completa, portanto `campaignId=null` é resultado válido e explícito.

### 18.2 Construir depois

1. Diagnóstico de campanhas por qualidade e resultado downstream.
2. Recomendações humanas de tráfego e oferta.
3. Feedback de conversões permitido para a Meta, com consentimento e governança.
4. Criação assistida de campanha.
5. Otimização automática somente após dados suficientes, compliance e limites de gasto.

A Biblioteca de Anúncios da Meta serve para estudar mensagem, oferta e criativo públicos; ela não prova spend, CPL ou conversão de concorrentes.

## 19. Compliance, privacidade e marketing odontológico

- Dados de saúde são sensíveis sob LGPD; coletar apenas o necessário.
- Replays reais exigem sanitização, revisão humana e dataset assinado.
- O canal de tempo real não transporta PHI ou conteúdo de conversa.
- Fotos clínicas exigem consentimento, acesso restrito, retenção definida e handoff humano.
- Uso publicitário de antes/depois precisa passar por validação da clínica e regras vigentes do CFO.
- Não prometer resultado clínico, não usar caso de terceiro, não transformar diferença comercial entre técnica simplificada e estratificada em superioridade clínica universal.
- “Simplificada”, “Slim”, “Premium” ou “Estratificada” são vocabulário comercial específico da clínica, não taxonomia clínica universal.

## 20. Ordem de reconstrução

| Fase | Entrega | Gate para avançar |
| --- | --- | --- |
| 0 | Segurança, token, tenant e Lab | Tenant resolution e webhook testados; zero vínculo com Ximendes. |
| 1 | Telemetria e baseline de desempenho | Tempo de navegador, servidor, banco e payload observáveis. |
| 2 | Motor conversacional seguro | Response plan, validator, fallbacks e eventos nos golden paths. |
| 3 | Leitura incremental e realtime | Metas de navegação atingidas em carga controlada. |
| 4 | Template odontológico | Manifest validado, instalação/diff e 12 famílias de replay. |
| 5 | UX e onboarding gerenciado | Agora, Inbox, Agenda e Crescimento sem métricas sintéticas. |
| 6 | Follow-ups seguros | Stop conditions, dedupe, outbox e auditoria. |
| 7 | Piloto assistido | 30 dias, 50 leads e critérios da seção 17. |
| 8 | Cobrança e expansão | Aceitação formal e operação estável. |
| 9 | Inteligência Meta | Atribuição confiável antes de recomendações/automação. |

Cada fase é uma unidade de mudança revisável. Schema/migração, core conversacional, UI e integração externa não serão misturados em um único commit ou deploy.

## 21. Estratégia de testes

### 21.1 Contratos obrigatórios

- isolamento de tenant;
- webhook e dedupe;
- state transitions;
- intent/action decisions;
- preço e política comercial;
- slot e double booking;
- takeover e suppress automation;
- follow-up e opt-out;
- outbox, retry e ordering;
- template install/diff;
- commercial event dedupe;
- realtime authorization e payload sem dado sensível;
- cursor pagination e sync incremental.

### 21.2 Desempenho

- plano de consulta e índices com volume representativo;
- payload e número de queries por navegação;
- carga com múltiplas clínicas e usuários ociosos;
- reconexão realtime;
- fallback polling;
- mutation otimista, rollback e idempotência;
- lista longa e mídia lazy em mobile.

### 21.3 Release

Antes de push, PR, merge ou deploy: `npm run verify`. Mudanças de agenda também executam a suíte dedicada definida em `AGENTS.md`. Produção só recebe mudança após CI, preview e QA manual. `main` continua produção e `develop` integração.

## 22. Observabilidade e kill switches

Painel interno mínimo:

- queue age e dead letters;
- primeira resposta útil;
- entrega e retry;
- validação bloqueada por motivo;
- handoffs e SLA;
- realtime connections/events/custo;
- polling fallback;
- query latency e payload;
- incidentes críticos por clínica;
- versão de template/playbook por turno.

Kill switches separados:

- automação conversacional por clínica;
- follow-up por clínica;
- campanhas por clínica;
- realtime sem afetar escrita/operação;
- integração Meta futura.

## 23. Definição de pronto do programa v1

A v1 está pronta para venda repetível quando:

1. Lab e um piloto real cumprem todos os gates.
2. Onboarding pode ser executado pela SystemOps sem código específico da clínica.
3. O cliente toma somente decisões essenciais em poucos cliques.
4. Toda afirmação do dashboard possui evidência navegável.
5. A conversa não inventa preço, slot, condição ou promessa.
6. Follow-ups não sobrepõem humano nem violam opt-out.
7. A experiência atende às metas de desempenho.
8. Há runbook, rollback e kill switch.
9. A operação humana possui rotina e responsável.
10. A clínica aceita formalmente pagar pelo resultado operacional entregue.

## 24. Decomposição para implementação

Este documento é o desenho mestre. Ele não autoriza um “big bang”. O próximo artefato será um plano executável para **Fases 0 e 1: segurança do Lab, baseline e observabilidade de desempenho**. Ao concluir esse marco, cada fase seguinte recebe plano próprio, mantendo as decisões deste documento como guardrails.

## 25. Referências

### Internas

- `README.md`
- `docs/architecture/current.md`
- `docs/architecture/sources-of-truth.md`
- `docs/architecture/replay-fidelity-contract.md`
- `docs/architecture/replay-and-decision-trace.md`
- `docs/operations/change-control.md`

### Mercado e plataforma

- Meta, click-to-message ads: <https://www.facebook.com/business/ads/click-to-message-ads>
- Meta, lead ads with messaging: <https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-messaging>
- Meta, Conversions API: <https://www.facebook.com/business/help/AboutConversionsAPI>
- Meta Ads Library: <https://www.facebook.com/ads/library/>
- Vercel, WebSockets em Functions: <https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections>
- Ably, pricing e limites: <https://ably.com/docs/platform/pricing>
- Pusher Channels: <https://pusher.com/docs/channels/>
- CFO, Resolução 196/2019: <https://website.cfo.org.br/resolucao-cfo-196-2019/>
- Kommo: <https://www.kommo.com/>
- Zenvia: <https://www.zenvia.com/>
- HighLevel: <https://www.gohighlevel.com/>
- RD Station: <https://www.rdstation.com/>
- Gong: <https://www.gong.io/>
- Salesforce: <https://www.salesforce.com/>
- HubSpot: <https://www.hubspot.com/>
- Liine: <https://www.liine.com/>
- Patient Prism: <https://www.patientprism.com/>
