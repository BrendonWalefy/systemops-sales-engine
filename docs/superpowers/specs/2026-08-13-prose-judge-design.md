# Judge de qualidade de prosa por comparação par a par

Data: 2026-08-13
Status: aprovado, execução autorizada
Posição no programa: spec 2 de 4 — instrumento que torna auditável a metade composer da spec 3

## 1. Decisão

Construir um avaliador offline que, para a mesma entrada, escolhe qual de **duas** respostas é
melhor — a de antes ou a de depois de uma mudança. Julgamento comparativo, nunca nota absoluta.

## 2. Por que par a par, e não nota

Nota absoluta de LLM deriva entre rodadas e é mal calibrada: o número muda sem nada ter
mudado, e a tentação de comemorar ou entrar em pânico com essa variação é grande. Julgamento
comparativo é substancialmente mais estável porque a tarefa é mais fácil — decidir qual das
duas é melhor não exige uma régua interna consistente ao longo do tempo.

E é a pergunta que a auditoria faz de verdade. A spec 3 vai propor remoções de regra do
prompt; a pergunta a responder é *"a resposta piorou depois de remover?"*, que é literalmente
uma comparação entre dois estados.

**O que o judge não vai poder dizer:** "nossa prosa está 85% boa". Ele não produz nota
absoluta e isso é deliberado. Quem quiser um número de painel não deve usar este instrumento.

## 3. De onde vêm as entradas

Do harness de replay que já existe — `scripts/run-approved-replay-dataset.ts`, com o fluxo de
aprovação de dataset em `src/application/replay/replay-dataset-approval.ts`.

Motivo: o replay produz **virada completa com contexto real** — histórico, estado de pipeline,
catálogo, oferta pendente. Uma mensagem isolada não exercita o composer de forma
representativa, porque a qualidade da prosa depende do que veio antes. O registro do projeto
também é explícito de que harness sintético de conversa engana e replay fiel não.

Consequência de escopo: o judge **depende** de existirem datasets de replay aprovados. Se não
houver cobertura suficiente, ampliá-la é pré-requisito e entra no plano desta spec, não como
suposição.

## 4. A rubrica sai da demo curada, não do gosto do modelo

`src/application/demo/demo-conversation-scripts.ts` contém **10 conversas curadas à mão** ponta
a ponta ("cenário perfeito", 72 blocos), com a recepcionista explicando procedimento,
contornando uma ou duas objeções reais e fechando horário.

A rubrica é **extraída** do que essas conversas fazem, não inventada. O passe de extração
produz critérios observáveis, e cada critério precisa ser demonstrável apontando para um trecho
concreto das 10 conversas. Critério que ninguém consegue exemplificar na demo curada não entra
na rubrica.

Dimensões esperadas, a confirmar na extração: acolhimento sem prolixidade; resposta à pergunta
feita antes de conduzir; contorno de objeção sem pressão; condução para o próximo passo
concreto; brevidade compatível com WhatsApp; ausência de afirmação que o sistema não autorizou.

A última é importante e delimita fronteira: **verificação de fato autorizado continua sendo do
`ResponseValidator`**, que é determinístico e roda no caminho vivo. O judge não substitui nem
duplica esse gate; ele avalia o que o validator já deixou passar.

## 5. Arquitetura

```
evals/prose/
  rubric.md              critérios extraídos da demo curada, com o trecho que os demonstra
  pairs.jsonl            pares (entrada, resposta A, resposta B) versionados
  judge.ts               monta o prompt de julgamento e interpreta o veredito
  report.ts              agrega vereditos: A melhor / B melhor / empate, por dimensão
scripts/eval-prose.ts    runner
```

Fronteiras: nada em `src/` de produção é alterado. O judge lê saídas do replay; não intercepta
nada em execução.

## 6. Controles contra viés do judge

Um judge ingênuo tem vieses conhecidos e mensuráveis. Os três que importam aqui:

**Viés de posição.** LLM tende a preferir a primeira ou a última opção apresentada. Controle:
cada par é julgado **duas vezes, com a ordem invertida**. Se o veredito mudar ao inverter, o
par é contado como **empate**, não como vitória. Isso é obrigatório, não opcional.

**Viés de verbosidade.** Judges tendem a preferir a resposta mais longa. Controle: o
comprimento de cada resposta é registrado, e o relatório reporta a correlação entre vitória e
comprimento. Correlação alta invalida a rodada e exige ajuste da rubrica, porque significa que
o judge está medindo tamanho em vez de qualidade.

**Autopreferência.** Modelo tende a preferir texto gerado por ele mesmo. Controle: o judge
usa um modelo **de família diferente** do composer. O composer roda OpenAI
(`OPENAI_COMPOSER_MODEL_*`); o judge usa Anthropic, que já está disponível no projeto via
`src/infrastructure/llm/advisor-llm.ts` e `@anthropic-ai/sdk`.

## 7. Escolha de modelo para o judge

Aqui modelo de fronteira **faz sentido**, ao contrário do classificador.

O benchmark de 13/08 mostrou que para classificação em 17 vias com schema estrito o modelo de
fronteira perde de um modelo pequeno: `gpt-5.6-sol` fez 83,3% contra 95,2% do `gpt-5.4-mini`,
a seis vezes o preço. Julgar prosa é a tarefa oposta — raciocínio aberto e comparativo, sem
resposta enumerável. É onde a capacidade extra entra no resultado.

E o custo não pesa: o judge roda **offline**, sobre um conjunto fixo de pares, algumas vezes
por semana. Não entra no custo por conversa. Um judge caro é irrelevante para a margem; um
classificador caro não é.

## 8. Saída

```
Rubrica: evals/prose/rubric.md (7 critérios)
Pares: 40   Julgamentos: 80 (cada par nos dois sentidos)

Vencedor por par:   B melhor 24   empate 11   A melhor 5
Vereditos instáveis ao inverter a ordem: 11 (contados como empate)

Por dimensão (B melhor / empate / A melhor):
  responde antes de conduzir      18 / 15 /  7
  brevidade                       21 /  9 / 10
  contorno de objeção              9 / 26 /  5

Correlação vitória × comprimento: 0,08  (aceitável, < 0,3)
Erros de execução: 0
```

`--json` desde o início.

## 9. Verificação

O judge está pronto quando:

1. `npm run eval:prose` roda ponta a ponta e imprime o relatório.
2. **O gate é provado, não presumido:** injetar uma resposta deliberadamente degradada — que
   ignora a pergunta do lead, ou despeja preço não autorizado, ou responde em quatro
   parágrafos — e exigir que o judge prefira a boa em pelo menos 90% dos pares. Judge que não
   reprova lixo óbvio não serve para julgar diferença fina.
3. A taxa de inversão de veredito ao trocar a ordem está registrada e é menor que 25%. Acima
   disso o judge é ruído e a rubrica precisa ser afiada antes de qualquer uso.
4. A correlação vitória × comprimento é menor que 0,3.
5. Todo critério da rubrica aponta para um trecho concreto da demo curada.
6. `npm run verify` continua passando sem chave de LLM.

O item 3 merece ênfase: **se o judge se contradisser em mais de um quarto dos pares, esta spec
falhou** e a conclusão honesta é que prosa não é mensurável com esta abordagem, não que a
prosa está boa.

## 10. Riscos

- **O judge pode simplesmente não funcionar.** É resultado possível e aceitável. Melhor
  descobrir isso num instrumento isolado do que descobrir depois de reescrever o prompt do
  composer confiando nele.
- **A rubrica herda o gosto da demo curada.** As 10 conversas são o alvo declarado do produto,
  então isso é intencional; mas significa que o judge premia o que já decidimos ser bom, e não
  descobre um jeito melhor de conversar que ninguém escreveu ainda.
- **Cobertura de replay.** 10 conversas curadas e os datasets de replay aprovados podem não
  cobrir os cenários que a auditoria vai mexer. Onde não cobrirem, a auditoria fica sem
  medição naquele ponto e precisa dizer isso em vez de opinar.

## 11. Fora de escopo

- Nota absoluta de qualidade.
- Qualquer participação no caminho vivo — o `ResponseValidator` permanece o único gate de
  produção.
- Julgar voz e áudio (TTS). Só texto.
- Rubrica de vendas ou taxa de conversão: conversão se mede por evento comercial, não por
  opinião de modelo.
