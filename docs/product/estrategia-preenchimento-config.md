# Estratégia — Como fazer o cliente preencher a configuração (sem bloquear)

**Data**: 04/07/2026 · **Problema**: a IA só é excelente quando sabe tudo (preços,
parcelamento, manutenção — auditoria F5). Mas o cliente real (Ximendes) não para para
preencher formulário: não domina a ferramenta e se confunde com as configurações.

**Princípio**: não pedir para o cliente "ir configurar". Levar a pergunta certa, uma por
vez, no momento em que ela já tem contexto — e transformar trabalho que ele JÁ faz
(responder leads) em configuração.

---

## As 4 mecânicas, em ordem de valor

### 1. Caixa de perguntas não respondidas (prioridade máxima)
O sistema já detecta *treatment gaps* (perguntas que a IA não soube responder e virou
handoff). Transformar isso numa **caixa de pendências no dashboard**, uma pergunta por vez:

> 💬 "5 leads perguntaram o preço da manutenção este mês."
> A pergunta real da lead aparece como contexto ("*quanto fica a manutenção das lentes?*" — Mirelly).
> **[campo único de resposta] → Salvar → a IA responde isso para sempre.**

Por que funciona: o dono responde UMA pergunta concreta (que ele já sabe de cor), não
"preencha a política comercial". Cada resposta entra na política via fluxo normal de
publish (validação existente). O gap vira o formulário.

### 2. Capturar a correção do operador (1 clique)
Quando o operador responde no inbox algo que a IA não sabia (caso Hellen: "recontorno é
R$250/dente" corrigindo cotação de R$2.500-5.000), oferecer na própria conversa:

> ✨ "Ensinar isso à IA?" → [1 clique] → vai para revisão/publish da política.

Por que funciona: captura conhecimento no fluxo de trabalho real, custo zero de atenção.
O operador já digitou a resposta — só falta promovê-la de mensagem para conhecimento.

### 3. Medidor de completude (visibilidade, nunca bloqueio)
No dashboard, um medidor por clínica: **"Sua IA sabe X% do que precisa para vender"**,
com as 3 lacunas de maior impacto e link direto para o campo certo:

> ⚠️ Procedimento "Prótese" sem preço — *2 leads perguntaram esta semana*
> ⚠️ Parcelamento não configurado — *a IA responde vago sobre pagamento*

Regras: nunca bloquear publish por incompletude (só os bloqueios de integridade que já
existem, ex. R$ na descrição); sempre ligar a lacuna a uma consequência concreta
("perdeu N perguntas"), não a uma bronca abstrata. Se conecta à iniciativa config
ownership e aos guards de publish existentes (PR #115/#122).

### 4. Onboarding conversacional (para clínica nova)
No primeiro acesso, em vez de formulário: **a própria IA entrevista o dono** (no
simulador ou WhatsApp) — "Quanto custa a avaliação? Ela é abatida do tratamento? Até
quantas vezes parcela?" — 10-15 min, respostas viram a primeira política comercial
(rascunho para revisar e publicar). Bônus: o dono APRENDE como a IA conversa sendo
atendido por ela — resolve também o "não sabe usar a ferramenta". Conecta com o
onboarding comercial guiado já em andamento.

---

## Sequência de implementação sugerida

| Ordem | Mecânica | Esforço | Por quê primeiro |
|---|---|---|---|
| 1 | Caixa de perguntas (gaps → pendências respondíveis) | M | Infra de gaps já existe; resolve a Ximendes HOJE |
| 2 | Capturar correção do operador | M | Mesmo fluxo de promoção a política do item 1 |
| 3 | Medidor de completude | P | Leitura sobre dados que já temos |
| 4 | Onboarding conversacional | G | Maior valor para clínica NOVA; fazer quando houver funil de novas clínicas |

**Métrica de sucesso**: % de perguntas de leads respondidas sem handoff por falta de
conteúdo (hoje: manutenção, proporção de lentes, parcelamento real caem em gap) e tempo
até a política ficar "completa" numa clínica nova.
