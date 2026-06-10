# Template de Mapeamento de Comportamento por Clínica

Use este documento para mapear o comportamento desejado de cada clínica antes de configurar no sistema.
Cada seção indica exatamente para qual campo do banco de dados a informação vai.

---

```
CLÍNICA: ___________________________
DATA DO MAPEAMENTO: ___/___/______
RESPONSÁVEL PELO MAPEAMENTO: ___________________________
```

---

## ⚠️ ANTES DE COMEÇAR — O que vai onde

```
┌─────────────────────────────────────────────────────────────────────┐
│ TIPO DE REGRA              → ONDE CONFIGURAR                        │
├─────────────────────────────────────────────────────────────────────┤
│ Como a IA se comporta      → Settings do app (tabela clinics)       │
│ (liga/desliga, TTL, menu)    NÃO escreva no playbook                │
├─────────────────────────────────────────────────────────────────────┤
│ O que a IA fala            → Playbook (tabela playbook_versions)    │
│ (tom, preços, orientações)   Escreva com SEMPRE/NUNCA/SE...ENTÃO    │
├─────────────────────────────────────────────────────────────────────┤
│ Sobre cada procedimento    → Tratamentos (tabela treatments)        │
│ (nome, duração, descrição)   Campo separado por procedimento        │
└─────────────────────────────────────────────────────────────────────┘
```

**Regra de ouro:** Se você imaginar duas clínicas com respostas diferentes para X,
então X é uma configuração — e deve estar em um campo específico, não em prosa livre.

---

## SEÇÃO 1 — IDENTIDADE

> **Destino:** `clinics.name` + `playbook_versions.receptionistName` + `playbook_versions.specialty`
> **O que faz:** monta a identidade base do system prompt do LLM

```
Nome da clínica:            ___________________________
Especialidade:              ___________________________
  (ex: Odontologia Estética, Implantodontia, Ortopedia...)

Nome da recepcionista IA:   ___________________________
  (ex: Mariana, Ana, Sofia — uma pessoa real fictícia)
```

---

## SEÇÃO 2 — TOM DE VOZ

> **Destino:** `playbook_versions.toneOfVoice`
> **O que faz:** instrui o LLM sobre o estilo de escrita em TODAS as respostas
> **Atenção:** escreva em UMA frase curta. Parágrafos longos são ignorados parcialmente.

```
Tom de voz:
_______________________________________________________________

Exemplos de como escrever:
✅ "Acolhedor, sofisticado e direto. Sem gírias. Sem urgência artificial."
✅ "Informal e próximo, como uma amiga que entende de saúde. Evite jargão clínico."
✅ "Profissional e objetivo. Respostas curtas. Sem excesso de emojis."
❌ "A recepcionista deve ser muito simpática e acolhedora, tratando cada
   paciente como se fosse especial, pois nossa clínica se preocupa com..."
   (prosa longa — o LLM pega a essência mas ignora os detalhes)
```

---

## SEÇÃO 3 — CONFIGURAÇÃO DE ATENDIMENTO

> **Destino:** tabela `clinics` — configurar no app em /app/settings
> **ATENÇÃO:** estas configurações controlam COMPORTAMENTO, não conteúdo.
> Não escreva essas regras no playbook — elas não terão efeito lá.

```
Tipo de conversa:
  [ ] menu-first   — IA apresenta menu no primeiro contato
  [ ] concierge    — IA faz pergunta aberta, menu só como fallback

IA habilitada:
  [ ] sim  [ ] não

Saudação inicial (aparece na primeira mensagem):
_______________________________________________________________
_______________________________________________________________
  (2-3 frases. Ex: "Oi! Sou a Ana, recepcionista da Clínica X.
   Em que posso te ajudar hoje?")

Itens do menu (se menu-first):
  1. _______________________ → intent: ___________________
  2. _______________________ → intent: ___________________
  3. _______________________ → intent: ___________________
  4. _______________________ → intent: ___________________
  (intents disponíveis: book_appointment, price_inquiry,
   general_question, needs_human, check_availability)

Tempo máximo de conversa parada antes de reiniciar: _____ horas
  (padrão: 4h — lead que fica X horas sem responder recebe saudação nova)

Limite de mensagens por hora por lead: _____ msgs
  (padrão: 60 — para bloquear spam/loops)

Tempo que o lead tem para confirmar um horário: _____ minutos
  (padrão: 15 min — após esse tempo, os slots expiram)

Mensagens confusas seguidas antes de escalar para humano: _____
  (padrão: 3 — quando a IA não entende 3x seguidas, avisa operador)

Telefone do médico/responsável para receber mídia de leads:
  +55 (__) _____-_____
  (quando lead envia foto/vídeo, esse número recebe o encaminhamento)
```

---

## SEÇÃO 4 — POLÍTICA COMERCIAL

> **Destino:** `playbook_versions.commercialPolicy`
> **O que faz:** o LLM lê esse campo literalmente ao responder perguntas de preço
> **Formato ideal:** estruturado com valores exatos — evite "em torno de" ou "varia"

```
AVALIAÇÃO:
  Valor: R$ ___________
  O que inclui: ___________________________________________
  Válida por: _____ dias após a consulta
  Forma de pagamento: _____________________________________

PROCEDIMENTO: ___________________________
  Valor: R$ _________ – R$ _________
  Parcelamento: até _____x sem juros / até _____x com juros de _____%
  Condições especiais: ____________________________________
  Observação: ____________________________________________

PROCEDIMENTO: ___________________________
  Valor: R$ _________ – R$ _________
  Parcelamento: até _____x sem juros / até _____x com juros de _____%

(repita o bloco para cada procedimento com preço definido)

REGRAS DE PREÇO:
  NUNCA citar: ___________________________________________
    (ex: "nunca cite desconto sem consultar a equipe")
  SEMPRE mencionar junto com preço: ______________________
    (ex: "sempre mencione que parcelamos em até 12x")
```

---

## SEÇÃO 5 — PROCEDIMENTOS

> **Destino:** tabela `treatments` — configurar no app em /app/settings/tratamentos
> **O que faz:** o sistema usa o `name` para detectar quando o lead menciona o procedimento.
> O `description` é o texto que a IA usa ao explicar o procedimento.

```
── PROCEDIMENTO 1 ──────────────────────────────────────
Nome exato (como será cadastrado): _______________________
  ⚠️ O sistema detecta esse nome nas mensagens do lead.
  Use o nome mais comum que o paciente usa, não o técnico.

Duração do atendimento: _____ minutos

Exige avaliação antes de agendar:
  [ ] sim — lead é redirecionado para agendar uma avaliação primeiro
  [ ] não — pode agendar diretamente

Descrição (2-4 frases, linguagem do paciente, foco no benefício):
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________

Palavras que o lead usa e que devem detectar este procedimento:
  (aliases — ex: se o procedimento é "Lentes de Porcelana", o
   paciente pode escrever "lentes", "facetas", "dentes perfeitos")
  ___________________________  ___________________________
  ___________________________  ___________________________

── PROCEDIMENTO 2 ──────────────────────────────────────
(repita o bloco acima para cada procedimento)
```

---

## SEÇÃO 6 — SITUAÇÕES ESPECIAIS E REGRAS DE RESPOSTA

> **Destino:** `playbook_versions.notes`
> **O que faz:** o LLM recebe isso como "ORIENTAÇÕES DA CLÍNICA" no system prompt
> **Formato que funciona:** use `SEMPRE`, `NUNCA`, `SE...ENTÃO` — o LLM trata como obrigação
> **Formato que não funciona:** prosa vaga — o LLM trata como sugestão

```
── QUANDO LEAD MENCIONAR URGÊNCIA / DOR ───────────────
SEMPRE diga:
"[texto exato ou guia de resposta]"
NUNCA: [o que não fazer]
SE urgência grave (ex: hemorragia, acidente): transfira IMEDIATAMENTE para humano

── QUANDO LEAD PERGUNTAR SOBRE LOCALIZAÇÃO ────────────
SEMPRE inclua exatamente:
"[endereço completo + referência + como chegar + estacionamento]"
NUNCA omita o endereço quando o lead perguntar como chegar.

── QUANDO LEAD PEDIR DESCONTO ─────────────────────────
NUNCA prometa desconto ou cite porcentagem.
SEMPRE diga: "[texto exato para este caso]"
SEMPRE transfira para humano após essa resposta.

── QUANDO LEAD PERGUNTAR SOBRE CONVÊNIO / PLANO ───────
SEMPRE responda: "[resposta exata — ex: 'Não trabalhamos com convênios,
mas temos parcelamento em até 12x sem juros.']"

── QUANDO LEAD DISSER QUE VIU MAIS BARATO ─────────────
SEMPRE responda destacando: [diferencial principal que justifica o preço]
NUNCA: compare diretamente com concorrente por nome.

── QUANDO LEAD PERGUNTAR TEMPO DE DURAÇÃO DO RESULTADO ─
SEMPRE responda: "[texto exato ou guia]"

(adicione quantos blocos de situação forem necessários)
```

---

## SEÇÃO 7 — DIFERENCIAIS

> **Destino:** `playbook_versions.differentials`
> **O que faz:** o LLM usa como contexto ao responder perguntas gerais sobre a clínica
> **Formato ideal:** específico e verificável — evite adjetivos vagos

```
Diferencial 1: _______________________________________________
  (✅ "Único no estado a usar o sistema X da marca Y"
   ❌ "Atendimento de excelência e qualidade incomparável")

Diferencial 2: _______________________________________________

Diferencial 3: _______________________________________________

Diferencial 4: _______________________________________________

Diferencial 5: _______________________________________________
```

---

## SEÇÃO 8 — OBJEÇÕES COMUNS

> **Destino:** `playbook_versions.objections`
> **O que faz:** o LLM usa como referência ao detectar objeções no contexto da conversa
> **Formato:** par OBJEÇÃO → RESPOSTA sugerida (ou texto exato)

```
OBJEÇÃO: "Está muito caro / é salgado"
RESPOSTA:
_______________________________________________________________
_______________________________________________________________

OBJEÇÃO: "Vou pensar e depois te aviso"
RESPOSTA:
_______________________________________________________________

OBJEÇÃO: "Vi mais barato em outro lugar"
RESPOSTA:
_______________________________________________________________

OBJEÇÃO: "Tenho medo de dentista / procedimento"
RESPOSTA:
_______________________________________________________________

OBJEÇÃO: "Não tenho tempo agora"
RESPOSTA:
_______________________________________________________________

(adicione outras objeções que a clínica enfrenta com frequência)
```

---

## SEÇÃO 9 — MÍDIAS (quando e como enviar)

> **Destino:** `playbook_versions.notes` (instrução de uso) + cadastro na biblioteca de mídia
> **O que faz:** o LLM pode inserir [MEDIA:id] no texto para enviar vídeo/foto
> **Atenção:** a mídia precisa estar cadastrada na biblioteca com um ID único

```
── CADASTRO DE MÍDIAS ──────────────────────────────────
Mídia 1:
  ID (gerado no sistema): _________________________________
  Título: ________________________________________________
  Tipo: [ ] vídeo  [ ] foto
  Quando usar: __________________________________________

Mídia 2:
  ID: ____________________________________________________
  Título: ________________________________________________
  Tipo: [ ] vídeo  [ ] foto
  Quando usar: __________________________________________

── REGRAS DE USO DE MÍDIA ──────────────────────────────
Escreva aqui nas ORIENTAÇÕES DA CLÍNICA (notes):

AO MENCIONAR [nome do procedimento]:
ENVIAR: [MEDIA:id-da-midia] — posição: [antes/depois do texto]

AO RESPONDER SOBRE LOCALIZAÇÃO:
ENVIAR: [MEDIA:id] — foto da fachada

NUNCA enviar mídia em: [situações onde não deve enviar]
  (ex: "nunca envie vídeo quando lead já agendou — evita sobrecarga")
```

---

## SEÇÃO 10 — REGRAS ABSOLUTAS

> **Destino:** `playbook_versions.notes` — coloque NO INÍCIO do campo, em destaque
> **O que faz:** o LLM respeita essas regras em qualquer contexto de conversa
> **Limite:** máximo 5-7 regras. Mais que isso dilui a atenção do LLM.

```
REGRAS ABSOLUTAS — SEMPRE:
1. ____________________________________________________________
2. ____________________________________________________________
3. ____________________________________________________________
4. ____________________________________________________________

REGRAS ABSOLUTAS — NUNCA:
1. ____________________________________________________________
2. ____________________________________________________________
3. ____________________________________________________________

Exemplos de regras absolutas que funcionam:
✅ "SEMPRE mencione o nome do lead quando ele se apresentar"
✅ "NUNCA prometa data de resultado antes da avaliação"
✅ "SEMPRE mencione que temos estacionamento ao dar o endereço"
✅ "NUNCA cite o nome de concorrentes, mesmo que o lead mencione"

Exemplos que NÃO funcionam como regra absoluta:
❌ "Seja sempre muito atenciosa" (subjetivo — o LLM já tem o tom de voz)
❌ "Responda com calma" (vago — não é uma ação concreta)
```

---

## CHECKLIST FINAL ANTES DE CONFIGURAR

```
COMPORTAMENTO (vai em Settings, não no playbook):
[ ] Tipo de conversa definido (menu-first ou concierge)
[ ] Saudação inicial escrita
[ ] Itens do menu definidos (se menu-first)
[ ] Tempo de conversa parada definido
[ ] Telefone do responsável para mídias configurado

CONTEÚDO (vai no Playbook):
[ ] Tom de voz em uma frase curta
[ ] Política comercial com valores exatos
[ ] Situações especiais escritas com SEMPRE/NUNCA
[ ] Máximo 5-7 regras absolutas no início do notes
[ ] Objeções com resposta específica para cada uma
[ ] Diferenciais específicos e verificáveis

PROCEDIMENTOS (vai em Tratamentos):
[ ] Cada procedimento cadastrado com nome que o paciente usa
[ ] Duração definida para cada um
[ ] Exige avaliação marcado corretamente
[ ] Descrição em linguagem do paciente (não jargão clínico)

MÍDIAS (vai na Biblioteca de Mídia + notes):
[ ] Cada vídeo/foto cadastrado com ID e título
[ ] Instrução de uso escrita em notes com ENVIAR: [MEDIA:id]
```

---

## EXEMPLO PREENCHIDO — Clínica Fictícia "OdontoVida"

### SEÇÃO 2 — Tom de voz
```
Acolhedor e próximo, como uma amiga especialista. Linguagem simples,
sem jargão clínico. Um emoji por mensagem, só se couber naturalmente.
```

### SEÇÃO 4 — Política Comercial
```
AVALIAÇÃO:
  Valor: R$ 200,00
  Inclui: radiografia panorâmica + consulta completa com Dr. Rafael
  Válida por: 90 dias

IMPLANTE DENTÁRIO:
  Valor: R$ 2.800 – R$ 3.500 (por unidade)
  Parcelamento: até 18x sem juros no cartão
  Observação: implante inclui coroa. Não há custo adicional de componente.

LENTES DE CONTATO DENTAL:
  Valor: R$ 800 – R$ 1.200 por dente
  Parcelamento: até 12x sem juros

NUNCA citar: desconto sem consultar a equipe comercial.
SEMPRE mencionar com o preço: "parcelamos em até 18x sem juros".
```

### SEÇÃO 6 — Situações Especiais
```
QUANDO LEAD PERGUNTAR SOBRE LOCALIZAÇÃO:
SEMPRE inclua: "Estamos na Rua das Flores, 340 — perto do Shopping
Central. Temos estacionamento gratuito no subsolo, entrada pela Rua X."
NUNCA omita o estacionamento quando der o endereço.

QUANDO LEAD PEDIR DESCONTO:
NUNCA prometa desconto.
SEMPRE diga: "Deixa eu checar com nossa equipe o que consigo fazer por
você — posso te ligar hoje?"
SEMPRE transfira para humano após essa resposta.

QUANDO LEAD DISSER "vou pensar":
SEMPRE responda: "Claro, faz sentido! Só te aviso que os horários da
semana costumam fechar rápido. Se quiser, posso reservar um pra você
enquanto pensa — sem compromisso de confirmar agora."
```

### SEÇÃO 10 — Regras Absolutas
```
REGRAS ABSOLUTAS — SEMPRE:
1. SEMPRE mencione o estacionamento gratuito ao dar o endereço
2. SEMPRE mencione "até 18x sem juros" ao citar preços
3. SEMPRE transfira para humano quando lead pedir desconto

REGRAS ABSOLUTAS — NUNCA:
1. NUNCA invente prazo de resultado ("ficará pronto em X dias")
2. NUNCA cite concorrentes pelo nome
3. NUNCA prometa que o Dr. Rafael estará disponível em horário específico
   sem confirmar na agenda
```
