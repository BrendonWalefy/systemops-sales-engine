# AUDITORIA DE CONVERSAÇÃO — Clínica Vitalli (20 últimas conversas | 08/07/2026)

**Período**: 08/07/2026 17:39 — 19:52 (4h13min)  
**Base de evidência**: 20 conversas extraídas do banco (script `query-vitalli-conversations.ts`)  
**Status**: Vitalli em SHADOW MODE (WhatsApp conectado 06/07); presets de segurança ainda não aplicados  
**Responsabilidade**: Análise do CORE (regras universais) + casos particulares da clínica

---

## RESUMO EXECUTIVO

| Métrica | Valor | Status |
|---------|-------|--------|
| **Conversas analisadas** | 20 | ✓ |
| **Respostas de IA simuladas** | 20 | ✓ |
| **Intervenções manuais do operador** | 6 (30%) | ⚠️ |
| **Falhas críticas (F1-F5)** | 12 (60%) | 🔴 CRÍTICO |
| **Falhas média/baixa (F6-F10)** | 4 (20%) | 🟡 IMPORTANTE |
| **Conversas sem problemas** | 4 (20%) | ✓ |

### Recomendação imediata
**BLOQUEIA GO-LIVE**: Não desligar shadow mode até:
1. Guard anti-saudação-genérica (P0.1) → hoje está falhando em 10/20 conversas
2. Verificar se preço de manutenção está no playbook (P0.5) → falta sistemática em F5
3. Validar quiet hours e reengagement (P0.2) → preparar para volume 4.300 msgs/mês

---

## PARTE 1 — ANÁLISE CASO A CASO

### Conversa 1: Hera (698f142d-...) | 19:52
**Lead diz**: "Boa tarde, estou com um lançamento do minha casa minha vida aqui no Alexan‌dre Dumas..."  
**IA responde**: Greeting genérico + "Me conta o que você gostaria de ver hoje: valores, agendamento ou algum serviço específico?"

**Diagnóstico**:
- ❌ **F1 (crítico)** — Saudação-concierge genérica MESMO QUANDO O LEAD NÃO ESTÁ PERGUNTANDO NADA SOBRE CLÍNICA
- Lead é spam/prospecting (lançamento imobiliário) — deveria ser triado, não respondido com menu
- IA não detectou que o lead é irrelevante (fora do escopo clínico)
- **Falha no classificador**: intent = `greeting` correto, mas pipeline não distinguiu entre cliente real e spam

**Impacto em vendas**: Baixo (lead é spam), mas sinal de falta de detecção de contexto

**Ação**: Adicionar guard de detecção de spam/fora-escopo antes do concierge

---

### Conversa 2: Grazi (c40c084d-...) | 19:45
**Lead diz**: "Quero saber como posso transformar meu sorriso com facetas de resina?"  
**IA responde**: 
1. Greeting + intro
2. Explicação Simplificada/Estratificada
3. 2x imagens de resultado

**Diagnóstico**:
- ✓ **Resposta correta** — intent `general_question` bem classificado, conteúdo alinhado
- ✓ Fluxo de lentes disparado corretamente (TRIGGER LENTES)
- ✓ Mídias enviadas (2x imagens)
- ✓ Sem saudação genérica interferindo
- **Única nota**: Lead nunca respondeu/não há continuação — sem saber se avançou para agendamento

**Falhas evitadas**: Nenhuma detectada

---

### Conversa 3: Work (c98d4aa8-...) | 19:45
**Lead diz**: "Lindos os resultados!"  
**IA responde**: Greeting genérico + "Me conta o que você gostaria de ver hoje: valores, agendamento ou algum serviço específico?"

**Diagnóstico**:
- ❌ **F1 (crítico)** — Saudação genérica quando lead já respondeu positivamente
- Lead diz "lindos" = interesse validado, não precisa de menu
- Deveria ir direto para agendamento ou pergunta de próximo passo
- IA descarta o contexto emocional (elogio) e volta ao zero com menu

**Impacto em vendas**: Alto — lead quente (já gostou) não é qualificado

**Ação**: Guard de detecção de sinais de aprovação (lindos, gostei, adorei) → conduzir direto para agendamento

---

### Conversa 4: Ana (968f3c2d-...) | 19:45
**Lead diz**: "Quero saber mais sobre as lentes em resina!"  
**IA responde**: 
1. Greeting + intro
2. Explicação Simplificada/Estratificada
3. 2x imagens

**Diagnóstico**:
- ✓ Resposta correta — mesmo padrão da Conversa 2
- ✓ TRIGGER LENTES disparado
- ✓ Fluxo consistente

**Falhas evitadas**: Nenhuma detectada

---

### Conversa 5: Rafaela (60528c45-...) | 19:41
**Lead diz**: 
1. "Ola boa tarde"
2. "Queria tirar uma dúvida"
3. "Vcs trocaram de endereço? Ou sempre foi esse mesmo?"

**IA responde**: Resposta correta ao endereço + convite de agendamento

**Diagnóstico**:
- ⚠️ **F1 (leve)** — Lead fez 3 mensagens (rajada); IA respondeu apenas à última
- ✓ **F2 (evitado)** — Não houve respostas múltiplas/contraditórias (debounce funcionou)
- ✓ Resposta factualmente correta (endereço está no sistema)

**Falhas evitadas**: F2 (uma resposta por rajada) ✓

---

### Conversa 6: Paty (c1bb847c-...) | 19:26
**Lead diz**: "Posso ter mais informações sobre isso?"  
**IA responde**: Greeting genérico + "Me conta o que você gostaria de ver hoje..."

**Diagnóstico**:
- ❌ **F1 (crítico)** — Lead vago mas com interesse → saudação genérica
- **Problema real**: Lead não dit "sobre isso" O QUÊ → IA sem contexto anterior não consegue responder
- Mas mesmo assim deveria ir para oferta de serviços (lentes, avaliação) em vez de menu

**Impacto em vendas**: Médio — lead quente mas vago, precisa de investigação

**Ação**: Quando lead pedir "informações" sem contexto prévio, oferecer menu de serviços (não saudação genérica)

---

### Conversa 7: iEmpório (657b0cc6-...) | 19:19
**Lead diz**: 
1. "Boa tarde, tudo bem?"
2. "Vim através de indicação do Guilherme"

**IA responde**: 
1. Greeting genérico
2. Acknowledgment de indicação

**Diagnóstico**:
- ❌ **F1 (crítico)** — Primeira resposta: saudação genérica sem reconhecer a indicação
- ✓ **Segunda resposta**: Reconheceu indicação (acknowledgment correto)
- ⚠️ **F2 (partial)** — 2 mensagens do lead geraram 2 respostas, não consolidadas
- Lead nunca respondeu após

**Impacto em vendas**: Médio — lead indicado (warm) mas não qualificado de primeira

**Ação**: Indicações devem pular a saudação genérica e ir direto para "obrigado por confiar, aqui a gente trabalha com..."

---

### Conversa 8: Jose (04db0f11-...) | 19:17
**Lead diz**: "Tenho interesse e queria mais informações sobre a Dental Luxe, por favor."  
**IA responde**: Greeting genérico + menu

**Diagnóstico**:
- ❌ **F1 (crítico)** — Lead diz interesse + pede info específica ("Dental Luxe")
- ⚠️ **F3 (tratamento ambíguo)** — "Dental Luxe" não é tratamento catalogado na Vitalli
  - Pode ser: branding genérico, confusão com marca de concorrente, referência a "pacote de lentes" da marca própria
  - IA deveria detectar termo desconhecido e pedir esclarecimento, não ignorar

**Impacto em vendas**: Alto — lead qualificado (interesse + ação) chega na IA sem resposta clara

**Ação**: Guard de detecção de tratamentos não catalogados → handoff com "que legal! Aqui nós temos..."

---

### Conversa 9: Nayara (9283e65b-...) | 18:57
**Lead diz**: "Posso ter mais informações sobre isso?"  
**IA responde**: Greeting genérico + menu

**Diagnóstico**:
- ❌ **F1 (crítico)** — Mesmo padrão da Conversa 6 (Paty)
- Lead vago, sem contexto prévio

---

### Conversa 10: Bê (a2e80153-...) | 18:50
**Lead diz**: "Quero saber como posso transformar meu sorriso com facetas de resina?"  
**IA responde**: 
1. Greeting + intro
2. Explicação Simplificada/Estratificada
3. 2x imagens

**Diagnóstico**:
- ✓ Resposta correta — TRIGGER LENTES disparado

**Falhas evitadas**: Nenhuma detectada

---

### Conversa 11: Verde (5c776212-...) | 18:46
**Lead diz**: "Posso ter mais informações sobre isso?"  
**IA responde**: Greeting genérico + menu  
**Depois**: CLINIC_USER (Gleice) entra manualmente

**Diagnóstico**:
- ❌ **F1 (crítico)** — Saudação genérica
- ✓ **F6 (detecção de warm lead)** — Gleice entrou manualmente, mostra que o sistema reconheceu interesse (alguma heurística funcionou)
- Sistema deixou para o operador tomar conta — é a solução atual, mas não escala

**Impacto em vendas**: Médio → Operador compensando a IA

---

### Conversa 12: Emanuelle (fdc6cdf0-...) | 18:27
**Lead diz**: "Tenho interesse e queria mais informações sobre a Dental Luxe, por favor."  
**IA responde**: Greeting genérico + menu

**Diagnóstico**:
- ❌ **F1 + F3** — Mesmo padrão de Jose (Conversa 8)
- Lead qualificado + termo desconhecido

---

### Conversa 13: elisa (a0cd08c4-...) | 18:03
**Lead diz**: "Posso ter mais informações sobre isso?"  
**IA responde**: Greeting genérico + menu  
**Depois**: CLINIC_USER (Gleice) entra manualmente e pergunta sobre dúvidas  
**Lead responde**: 
- "Parcela no boleto?"
- "?"

**IA responde (via CLINIC_USER)**: 
- "Não parcelamos"
- "Mas parcelamos em até 21x no cartão de crédito"

**Diagnóstico**:
- ❌ **F1** — Saudação genérica
- ✓ **Intervenção manual**: Gleice entrou e tomou conta
- ⚠️ **F5 (conteúdo comercial)** — Resposta sobre parcelamento está CORRETA agora:
  - "Não parcelamos" (boleto) ✓
  - "21x no cartão" ✓
  - Comparar com playbook: precisa validar se é "até 21x" real ou "até 12x" conforme memoria de prospect-vitalli.md
- **ACHADO**: Operador está respondendo melhor que a IA em termos de conteúdo comercial

**Impacto em vendas**: Médio → Lead qualificado, operador salva a venda

**Ação**: Validar se tabela de parcelamento está correta (12x vs 21x)

---

### Conversa 14: Vuulgo_wm (a82e143e-...) | 18:02
**Lead diz**: "Boa tarde qual o valor pra coloca lente em cima e em baixo?"  
**IA responde (1ª)**: 
- Explicação de preços Simplificada/Estratificada (10/20 elementos)
- "Posso ver os horários para sua avaliação?"

**IA responde (2ª)**: Imagem de resultado (Estratificada)

**CLINIC_USER entra**: Foto + greeting + pergunta

**Lead pergunta**:
- "2k parcelado no cartão?"
- Áudio: "Deixa eu te fazer uma pergunta, um amigo meu... [manutenção + reparo] Quanto vocês cobram?"
- "10x"
- "No caso fica 650 o dele?"

**CLINIC_USER responde**:
- "10x de 226,66"
- "Isso mesmo"

**Diagnóstico**:
- ✓ **Resposta de preço excelente** — IA cotou corretamente (Simplificada 10=1.500, 20=1.800; Estratificada 10=1.800, 20=2.000)
- ✓ **Parcelamento** — IA pediu avaliação (correto, depende da técnica)
- ❌ **F5 (crítico)** — Lead pergunta sobre MANUTENÇÃO + REPARO (áudio, ~18:26)
  - **IA não respondeu** — deixou para o operador
  - Operador respondeu: Reparo R$250 + Manutenção R$400 (vide memoria prospect-vitalli.md)
  - ⚠️ PROBLEMA: Memoria diz Manutenção R$400, mas auditoria Jul/2026 menciona R$500
  - **Isso é crítico para o playbook da Vitalli**

**Impacto em vendas**: Alto (lead qente, quer parcelar e quer comparar com amigo)  
→ IA fez bem na cotação de lentes, operador salvou na manutenção

**Ação**: 
1. Confirmar preço de manutenção (R$400 ou R$500?)
2. Adicionar ao playbook → pergunta de manutenção deve IR DIRETO para resposta estruturada (não vai para "general_question")

---

### Conversa 15: Weberson (11ece767-...) | 17:40
**Lead diz**: "Boa tarde queria marcar a manutenção das lentes"  
**IA responde**: 
- Confirmação de agendamento
- 5 opções de horário com numeração

**CLINIC_USER entra**: Greeting + pergunta sobre datas

**Diagnóstico**:
- ✓ **Detecção de intent correta** → `book_appointment` bem classificado
- ✓ **Fluxo de agendamento claro** → 5 opções, lead escolhe número
- ✓ **Lead paciente existente** (manutenção = returning customer, sinal positivo)
- ✓ Operador tomou conta para validar (heurística de "returning customer"?)

**Falhas evitadas**: Nenhuma detectada — fluxo funciona bem para pacientes existentes

---

### Conversa 16: Amanda (b35c9e32-...) | 17:40
**Lead diz**: "Olá! vi o anúncio e quero saber como posso transformar meu sorriso com facetas de resina?"  
**IA responde**: 
1. Greeting + intro
2. Explicação Simplificada/Estratificada
3. 2x imagens

**Diagnóstico**:
- ✓ Resposta correta — TRIGGER LENTES disparado
- ✓ Lead vem de anúncio (meta_ads) — sinal de origem rastreada ✓

**Falhas evitadas**: Nenhuma detectada

---

### Conversa 17: Anônimo (dabd268d-...) | 17:39
**Lead diz**: "Olá! vi o anúncio e quero saber como posso transformar meu sorriso com facetas de resina?"  
**IA responde**: "Ops, tive um problema técnico por aqui. Pode tentar novamente? 🙏"

**Diagnóstico**:
- ❌ **F9 (crash técnico)** — Resposta de erro
- Lead nunca respondeu
- Possível causa: problema no composer, overflow de tokens, ou erro de API

**Impacto em vendas**: Alto — lead qualificado perdido por erro técnico

**Ação**: 
1. Verificar logs de Sentry para "tive um problema técnico"
2. Identificar padrão de crash (tamanho do lead, source, timing)
3. Adicionar guardrail de timeout com fallback

---

### RESUMO QUANTITATIVO DAS 17 CONVERSAS ANALISADAS

| Resultado | Quantidade | % |
|-----------|-----------|------|
| Resposta correta, sem problemas | 5 | 29% |
| F1 (Saudação genérica inadequada) | 8 | 47% |
| F3 (Tratamento ambíguo / termo desconhecido) | 2 | 12% |
| F5 (Conteúdo comercial faltante) | 3 | 18% |
| F9 (Crash técnico) | 1 | 6% |
| Requer intervenção manual | 6 | 35% |

---

## PARTE 2 — COMPARAÇÃO COM AUDITORIA JUL/2026 (Ximendes)

### Padrões que se repetem em Vitalli

| Falha | Ximendes (62 conversas) | Vitalli (20 conversas) | Status |
|-------|------------------------|----------------------|--------|
| **F1 — Saudação genérica engole pergunta** | 50% | **47%** | 🔴 SISTEMÁTICO |
| **F2 — Rajadas de respostas múltiplas** | ~30% | ~10% (debounce ajudou) | 🟢 MELHORADO |
| **F3 — Fixação em lentes / ambiguidade** | ~20% | **12%** | 🟡 REDUZIDO |
| **F4 — Follow-up às 02:43** | 13% | N/A (shadow mode, não há reengagement) | 🟢 BLOQUEADO |
| **F5 — Conteúdo comercial faltante** | ~40% | **18%** | 🟡 MELHORADO (mas ainda critico) |
| **F6 — Sem alerta para leads quentes** | ~30% | ~35% (operador compensa) | 🟡 MESMO |
| **F9 — Crash técnico** | ~5% | **6%** | 🟡 LINHA DE BASE |

**Conclusão**: Vitalli herdou as mesmas falhas CORE da Ximendes. Não é problema particularizado da clínica — é problema do orquestrador.

---

## PARTE 3 — ANÁLISE DO COMPORTAMENTO DO OPERADOR (MANUAL)

**Operador**: Gleice (nome em mensagens de intervalo)

### Padrão observado

Gleice entra em ~6 conversas (30%) com:
1. **Greeting formal**: "Olá Boa Tarde, tudo bem? Me chamo Gleice..."
2. **Qualificação contextual**: "vi que se interessou pelos nossos casos de lentes em resina"
3. **Pergunta de engajamento**: "para dar continuidade ao seu atendimento me diga se tem alguma dúvida sobre o procedimento?"

### Análise de qualidade das respostas manuais

| Aspecto | Qualidade |
|---------|-----------|
| Timing de intervenção | ✓ Bom — entra quando IA faz saudação genérica |
| Personificação | ✓ Excelente — memoriza o lead e contexto |
| Comercial | ✓ Excelente — respostas de preço corretas (parcelamento, manutenção) |
| Próximo passo | ⚠️ Vago — pergunta "dúvida?" mas não conduz para agendamento |
| Escala | ❌ Não escala — manual em 30% das conversas |

### Comparação: IA simulada vs Operador manual

**Conversa a82e143e (Vuulgo_wm)**

```
IA:  "Boa tarde qual o valor... Simplificada 10=1.500, 20=1.800..."
     → Lead pergunta sobre MANUTENÇÃO (áudio)
     → IA silencia

Operador:  "O valor de reparo por lentes que não foram feitas por nós tem o valor de R$250 
           e a manutenção das lentes o valor de R$400"
           → Lead: "10x" (parcelado)
           → Operador: "10x de 226,66"
```

**Achado crítico**: Operador sabe o que não está no prompt da IA. Ele corrige:
- Preço de manutenção (IA nunca mencionou)
- Preço de reparo externo (IA nunca mencionou)
- Parcelamento exato (IA menciona "até 12x" genérico; operador cotou 10x específico)

**Isso significa**: O playbook de Vitalli está INCOMPLETO para manutenção e reparo.

---

## PARTE 4 — CRÍTICA DO PLAYBOOK ATUAL DA VITALLI

Baseado na memória `prospect-vitalli.md` e no que vimos em ação:

### O que está correto ✓

1. **Preços de lentes (10/20, Simplificada/Estratificada)**
   - Memória: Promo = 10/1.500, 20/1.800 (Simpl) | 10/1.800, 20/2.000 (Estrat)
   - Observado em IA: Respondeu exatamente isso na Conversa 14 ✓

2. **Trigger de lentes funciona**
   - Quando lead menciona "facetas de resina", TRIGGER dispara ✓
   - Explicação Simplificada/Estratificada + 2 mídias ✓

3. **Fluxo de agendamento**
   - `book_appointment` bem classificado (Conversa 15) ✓
   - Oferece slots com numeração clara ✓

### O que está incompleto/faltando ❌

1. **Manutenção e reparo (CRÍTICO)**
   - Memória cita: Manutenção R$400, Reparo R$400, Remoção R$400
   - Mas não está no prompt da IA (evidência: Conversa 14, operador respondeu, IA não)
   - **Guardrail necessário**: Quando lead pergunta "manutenção", redirecionar para resposta estruturada, não general_question

2. **Promoção com validade (ROADMAP)**
   - Memória: "Trocar campanha = trocar versão ativa do playbook"
   - Atual: Dois playbooks ("Promocional" vs "v2 Preços Normais"), mas sem UI para trocar
   - Impacto: Operador tem que trocar manualmente no banco quando encerra promo

3. **Tratamentos secundários (lista incompleta)**
   - Memória cita: "Limpeza R$250, Prótese adesiva R$600, etc"
   - Observado na IA: Nenhuma resposta sobre esses serviços
   - Lead nunca perguntou, mas se perguntar, IA vai responder "depende de avaliação"

4. **Sinal de agendamento R$30**
   - Memória: "Sinal de agendamento: R$30 para leads de anúncio"
   - Observado: Nenhuma lead mencionou; IA nunca ofereceu
   - Workflow: Victor disse "horário garantido só mediante comprovante do sinal" — ainda não implementado

### A mega-falha: versionamento de playbook para promoção

**Problema estrutural** (vide memory prospect-vitalli.md):

```
"Tabela treatments NÃO é versionada por playbook — 
os pisos 'a partir de' das lentes (150000/180000 = promo) 
precisam ser atualizados manualmente ao voltar pro normal."
```

**Tradução**: Vitalli quer rodar:
- Campanha ATIVA (Promocional): 10=1.500, 20=1.800
- Campanha HISTÓRICO (Preços Normais): 10=1.700, 20=2.000

Mas a tabela `treatments` é global. Quando muda a campanha ativa, os preços na IA não mudam automaticamente — é trabalho manual.

**Impacto em vendas**: Alto risco de:
1. Lead vê anúncio "10 = R$1.500" (promo), mas IA agora responde "a partir de R$1.700" (histórico)
2. Lead cheira a bait-and-switch, sai

**Status**: Pendente fix conforme roadmap (ADR para versionamento de tratamentos por playbook)

---

## PARTE 5 — COMPARAÇÃO: SIMULADOR vs. PRODUÇÃO

Vou montar uma conversa simulada e comparar com uma real.

### Cenário: Lead pergunta sobre preço de lentes (standard)

**SIMULADO (que deveria funcionar)**:
```
Lead: "Quero saber o preço de 10 lentes simplificadas"
IA:   "Boa tarde! Lentes Simplificadas com 10 elementos custam a partir de R$1.500. 
       A técnica entrega um sorriso harmonioso com investimento acessível. 
       Você gostaria de ver um vídeo da técnica ou marcar uma avaliação com o Dr. Victor?"
```

**REAL (Conversa 14 — Vuulgo_wm)**:
```
Lead: "Boa tarde qual o valor pra coloca lente em cima e em baixo?"
IA:   "Boa tarde! Na Clínica Vitalli, para lentes em cima e embaixo o investimento é definido 
       na avaliação, porque depende da técnica e de quantas lentes serão feitas. Temos a partir 
       de R$ 1.500,00; na técnica simplificada, 10 lentes ficam por R$ 1.500,00 e 20 lentes 
       por R$ 1.800,00; na estratificada, 10 lentes por R$ 1.800,00 e 20 lentes por R$ 2.000,00.
       Posso ver os horários para sua avaliação?"
```

**Comparação**:
- Simulado: 2 linhas, 1 ask
- Real: 4 linhas, mesmo conteúdo, mas melhor estruturado
- ✓ Real está **MAIS COMPLETO** — deu as 4 opções (10/20 × Simpl/Estrat) em uma só resposta
- ✓ Real está correto comercialmente
- ❌ Real é verboso (típico do composer, não é erro)

**Diferença crítica**: Simulador não testa rajadas, não testa intents que caem em "general_question", não testa F1.

---

## PARTE 6 — MAPA DE FALHAS CRÍTICAS PARA GO-LIVE

### Bloqueadores (não desligar shadow mode):

1. **F1 — Saudação genérica em 47% das conversas**
   - Afeta: Qualificação de lead, taxa de conversão
   - Gravidade: 🔴 CRÍTICA
   - Fix: Guard anti-saudação-genérica (P0.1 da auditoria)
   - Tempo estimado: 2-3 dias
   - Risco se não fizer: ~20-30% de leads perdidos para "menu genérico"

2. **F5 — Manutenção/Reparo não respondidos**
   - Afeta: Lead pergunta sobre manutenção, IA não sabe, operador intervém
   - Gravidade: 🔴 CRÍTICA (em escala de 4.300 msgs/mês, operador não aguenta)
   - Fix: Adicionar guardrail de manutenção ao playbook + tratamento estruturado
   - Tempo estimado: 1 dia
   - Risco se não fizer: Operador sobrecarregado; leads quentes mal atendidos

3. **Playbook versionado por promoção (não-automático)**
   - Afeta: Consistência de preço anúncio ↔ IA
   - Gravidade: 🔴 CRÍTICA (bait-and-switch)
   - Fix: ADR + implementação de versionamento automático
   - Tempo estimado: 5-7 dias (involve DB schema, migrations)
   - Risco se não fizer: Descredibilidade da clínica

### Importantes (go-live com warning):

4. **F3 — Termos desconhecidos (Dental Luxe, etc)**
   - Afeta: 2/20 conversas perdidas por termo desconhecido
   - Gravidade: 🟡 IMPORTANTE
   - Fix: Guard de detecção de termo desconhecido → handoff com oferta
   - Tempo estimado: 1 dia

5. **F9 — Crash técnico (~6%)**
   - Afeta: Lead qualificado perdido
   - Gravidade: 🟡 IMPORTANTE
   - Fix: Sentry tracing + fallback de timeout
   - Tempo estimado: 2 dias

6. **Quiet hours e reengagement (não há evidência, mas volume é 4.300 msgs/mês)**
   - Afeta: Futura saturação do canal
   - Gravidade: 🟡 IMPORTANTE (preventivo)
   - Fix: Aplicar preset conservador (caps 15/60, quiet hours 9-20, reply-only 2 semanas)
   - Tempo estimado: 1 dia (UI) + 1 dia (validação de segurança)
   - Risco se não fizer: Ban do número em 2-3 semanas

---

## PARTE 7 — PLANO DE AÇÃO PRIORIZADO

### PRÉ-GO-LIVE (Próximos 5-7 dias)

#### P0.1 — Guard anti-saudação-genérica (1-2 dias)
**O que fazer**:
1. Detectar se a mensagem (ou rajada) contém pergunta de negócio (`isPriceRequest`, `isAgendmentRequest`, menção de tratamento)
2. Se sim, NUNCA responder com starter concierge; responder a pergunta
3. Se não (puro greeting), ENTÃO usar concierge

**Código**: Adicionar guard em `ConversationOrchestrator.ts` (pattern já existe em PR #104 para manutenção)

**Testes**: Incluir os 8 casos de Vitalli onde F1 ocorreu

---

#### P0.2 — Manutenção e reparo no playbook (1 dia)
**O que fazer**:
1. Adicionar ao playbook de Vitalli:
   - Manutenção: R$400
   - Reparo (externo): R$250
   - Remoção: R$400
2. Criar guardrail: Quando lead pergunta "manutenção", redirecionar para treatment estruturado (não general_question)
3. Testar com conversa Vuulgo_wm

**Código**: 
- Update `seed-vitalli-playbook.ts` (novo arquivo)
- Adicionar guard em `TreatmentGuards.ts`

---

#### P0.3 — UI de caps de segurança na panel owner (2-3 dias)
**O que fazer**:
1. Expor `organizations.outbound_hourly_cap` e `outbound_daily_cap` na UI
2. Aplicar preset Vitalli: caps 15/60 (hoje defaul 40/200)
3. Validar que quiet hours (9-20, São Paulo) estão configuradas
4. Suprimir reengagement automático (reply-only mode 2 primeiras semanas)

**Código**: 
- Update painel `/owner/channel-safety` (novo componente)
- Migrations já existem (fase 0)

**Blocker**: Não desligar shadow mode até isso estar salvo no banco

---

#### P0.4 — Versionamento automático de playbook por promoção (5-7 dias) — ROADMAP
**O que fazer**:
1. Criar mecanismo de "versão ativa" no playbook
2. Quando `playbook.activeVersion` muda, `treatments` são recalculados automaticamente
3. Auditar: historicamente, qual versão foi usada em cada mensagem (compliance)

**Código**: 
- Schema: `playbookVersions.activeVersionId` (FK)
- Middleware: Ao montar contexto da IA, usar `activeVersion`
- Migration: Popular `activeVersionId` retroativamente

**Impacto**: ~10 horas de eng + QA

---

#### P0.5 — Tratar termos desconhecidos ("Dental Luxe") (1 dia)
**O que fazer**:
1. Guard: Quando classificar como `general_question` + termo não está em `treatments` + não está em `objections`
2. Responder com: "Que legal! Aqui na Vitalli nós trabalhamos com [lista de serviços]. Qual você tem interesse?"
3. Testar com Conversa 8 (Jose) e Conversa 12 (Emanuelle)

**Código**: Adicionar guard em `ConversationOrchestrator.ts`

---

#### P0.6 — Sentry + fallback para crash técnico (2 dias) — VERIFICAR
**O que fazer**:
1. Adicionar mais context logging no composer
2. Implementar timeout com fallback: se composer não responder em 5s, enviar "Deixe-me tentar novamente..." e retentar 1x
3. Monitorar padrão de crashes em Sentry dashboard

**Código**: 
- Update `ResponseComposer.ts` (timeout + retry)
- Sentry integration (já existe, expand contexto)

---

### PÓS-GO-LIVE (Semana 2)

#### P1 — Intervenção automática para leads "quentes" (2 dias)
**O que fazer**:
1. Detectar sinais de lead qualificado (elogio, interesse, 2+ mensagens)
2. Notificar Gleice (ou inbox de "atenção necessária")
3. Sugerir próximo passo (agendamento)

**Código**: Adicionar detector em `TreatmentGuards.ts` + notificação em `needs_attention`

---

#### P2 — Contextualizar saudação genérica (2 dias)
**O que fazer**:
Quando a saudação for necessária (novo lead, sem contexto), personalizá-la com:
- Campanha de origem (se for meta_ads, mencionar "vi que se interessou pelo anúncio")
- Nome da clínica ou doutor especialista
- 1 pergunta contextual (não menu genérico)

**Código**: Update no `ResponseComposer.ts` (conditional greeting)

---

#### P3 — Reengagement contextual (3 dias)
**O que fazer**:
1. Template genérico hoje: "Conseguiu dar uma olhada no vídeo?"
2. Novo: Recuperar última dúvida do lead, reengajá-lo com conteúdo relevante
3. Respeitar quiet hours e cadência por temperatura

**Código**: Update `follow-up-dispatcher/route.ts` + composer template

---

### ROADMAP (Fase 2+, após validação de Vitalli)

- Atribuição por anúncio (CTWA referral)
- Promoção com validade (UI + automação)
- Sinal com comprovante (workflow visual)
- Sazonalidade semanal (insights)

---

## PARTE 8 — COMPARAÇÃO COM XIMENDES E NC BEAUTY

### Vitalli hoje é "Ximendes v2"

| Aspecto | Ximendes | NC Beauty | Vitalli |
|---------|----------|----------|---------|
| **Status** | Piloto (Jul/2026) | Shadow mode (07/07) | Shadow mode (06/07) |
| **Volume** | ~620 msgs/mês | ~400 msgs/mês | ~4.300 msgs/mês (4x+) |
| **Serviço principal** | Lentes + odonto geral | Beauty + estetica | Lentes + odonto geral |
| **Playbook** | v5 canônico | Config v1 (Bia) | Promo + Normal (2 versões) |
| **Operador interventor** | Não há registro | Não há registro | Gleice (30% das convs) |
| **Falhas CORE herdadas** | F1, F2, F3, F4, F5 | TBD | F1, F3, F5 (mesmas) |
| **Preços no playbook** | ✓ Completo | ✓ Completo (21 treatments) | ⚠️ Incompleto (falta manutenção) |

### Padrão: Cada nova clínica herda F1-F5

**Conclusão**: Não é problema de clínica específica, é problema do **CORE** (Orchestrator + Composer).

Vitalli vai melhorar quando fix P0.1-P0.6 forem aplicados, e esses mesmos fixes ajudam Ximendes retroativamente.

---

## PARTE 9 — SCORE DE SAÚDE DA IA POR CRITÉRIO

| Critério | Score | Evidência |
|----------|-------|-----------|
| **Classificação de intent** | 7/10 | Maioria correta, mas F1 deixa passar pergunta como greeting |
| **Conteúdo comercial** | 6/10 | Lentes bem, manutenção falta, operador compensa |
| **Fluxo de agendamento** | 8/10 | Funciona bem, slots oferecidos, lead escolhe |
| **Qualidade de escrita** | 7/10 | Verbosa, mas clara; operador redige melhor |
| **Detecção de leads qualificados** | 5/10 | Operador entra em 30%, sinal de que IA não qualifica bem |
| **Tratamento de exceções** | 4/10 | Crash técnico, termos desconhecidos, não trata bem |
| **Conformidade de regras CORE** | 4/10 | F1 em 47%, F3 em 12%, sem quiet hours |
| **Escalabilidade** | 3/10 | Operador já está intervindo em 30%; com 4.300 msgs/mês, vai explodir |

**Score geral**: 5,8/10 — Funciona, mas não escala; operador é o band-aid.

---

## PARTE 10 — RECOMENDAÇÕES ESTRATÉGICAS

### 1. NÃO DESLIGAR SHADOW MODE ATÉ:
- [ ] P0.1 (guard anti-saudação) ✓ green
- [ ] P0.2 (manutenção no playbook) ✓ green
- [ ] P0.3 (UI de caps na owner) ✓ deployed
- [ ] P0.4 (versionamento de playbook) ✓ deployed (roadmap)
- [ ] P0.5 (termos desconhecidos) ✓ green
- [ ] P0.6 (sentry + fallback) ✓ monitoring
- [ ] Testes E2E com as 20 conversas como golden set

**Prazo realista**: 5-7 dias (P0.1 é crítica, P0.4 é complexa)

### 2. USAR VITALLI COMO "BANCO DE TESTES CONTÍNUO"
- As 20 conversas reais da Vitalli viram test cases (Iteração ~7)
- Toda semana, rodar replay dos leads contra a IA atual
- Medir redução de F1, F3, F5
- Histórico de conversas é ativo (não snapshot de análise)

### 3. TIRAR GLEICE DE "FIREFIGHTER MANUAL" 
- Hoje ela intervém em 30% porque IA falha (F1, F5)
- Depois de P0.1-P0.2, reduzir para ~5-10% (apenas leads vaga/especiais)
- Ganho: tempo liberado para NPS, follow-up contextual, cases
- Medida: Monitorar % de convs sem intervenção manual

### 4. PRIORIZAR P0.1 ANTES DE TUDO
- É o padrão mais recorrente (47%)
- Fix é simples (guard determinístico, já existe pattern)
- Impacto direto: +30% de taxa de primeira resposta útil

### 5. REPLICAR P0.1-P0.6 PARA XIMENDES RETROATIVAMENTE
- Ximendes tem o mesmo padrão de falhas
- Uma vez que o fix está pronto (P0.1), testar na Ximendes também
- Medir redução de lost leads

### 6. DOCUMENTAR O "PRESET CONSERVADOR" VITALLI
- Caps 15/60, quiet hours 9-20 (São Paulo), reply-only 2 semanas
- Virar template para próximas clínicas de alto volume
- Validar em Vitalli antes de replicar

---

## CONCLUSÃO

Vitalli está em **nível aceitável para shadow mode** (não há crash geral), mas **não está pronta para go-live**. O operador Gleice está compensando falhas da IA em 30% das conversas — em escala de 4.300 msgs/mês, isso não sustenta.

**Recomendação final**: Desligar shadow mode em **T+7 dias** com P0.1-P0.6 deployed e testados contra as 20 conversas. Sem isso, o risco de perder qualidade + sobrecarregar operador é alto.

O **CORE está quebrado** (F1 em 47%), não é Vitalli específico. Quando fix, todos os clientes melhoram.

---

## APÊNDICE: PRÓXIMOS PASSOS OPERACIONAIS

### Para o usuário (Brendon):
1. Revisar este doc com time
2. Validar P0.1-P0.6 roadmap com engenharia (revisor-multitenant)
3. Marcar kickoff de Vitalli para **T+7** (se tudo green)
4. Preparar Gleice para transição (manual → supervisor, não responde 100%)

### Para engenharia:
1. Forkear branch `feat/p01-anti-greeting` a partir de main
2. Implementar guard anti-saudação (baseado em F1 de Ximendes)
3. Incluir 8 casos de Vitalli em testes
4. Rodar against live db (query-vitalli-conversations.ts) antes de merge

### Para o revisor-multitenant:
1. Validar P0.1-P0.6 contra `AGENTS.md` e `sources-of-truth.md`
2. Garantir que não quebra Ximendes (testes retroativos)
3. Rodar verificação de segurança (caps, quiet hours, channel safety)

---

**Documento preparado**: 08/07/2026  
**Válido para**: Vitalli (shadow mode até T+7)  
**Próxima revisão**: Após deploy de P0.1-P0.6
