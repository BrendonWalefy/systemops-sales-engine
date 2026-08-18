# Turnos sem resposta e o balde `other`

Data: 2026-08-15
Ciclo: C.5 — calibração, antes de autorizar o Ciclo D

Dois relatórios **descritivos**. Nenhum rótulo, eixo, schema ou comportamento foi
alterado a partir deles. Servem de entrada para D/E, não de autorização.

Medição por `SELECT` apenas, sobre os quatro tenants reais.

---

## 1. Turnos sem resposta — o número anterior estava errado

O relatório do Ciclo C afirmava que **48,8%** dos turnos de lead ficavam sem
resposta em duas horas, e tratava isso como o maior problema de conversão visível
no dado. **O número era artefato do extrator.**

O extrator credita a resposta ao *último* turno de lead antes dela. Numa rajada —
e rajada é 20,3% do volume — as mensagens anteriores do próprio lead ficam sem
resposta atribuída, ainda que a conversa tenha sido respondida normalmente. Ele
não erra o que foi construído para fazer, que é montar um turno julgável; erra
como base para uma estatística de atendimento.

Medido direto no banco, sem a janela do extrator:

| | Turnos | % |
| --- | ---: | ---: |
| Total de turnos de lead | 7.720 | 100% |
| **Respondidos em até 2h** | **6.123** | **79,3%** |
| Respondidos depois de 2h | 1.333 | 17,3% |
| Nunca respondidos | 264 | 3,4% |

### Os 1.597 não respondidos em 2h, em categorias exclusivas

Cada turno entra em uma categoria só, na ordem abaixo.

| Categoria | Turnos | % dos 1.597 | Leitura |
| --- | ---: | ---: | --- |
| O próprio lead escreveu de novo antes da resposta | 564 | 35,3% | Não é ausência de resposta: a resposta foi ao turno seguinte da mesma rajada |
| Respondido no mesmo dia, fora da janela de 2h | 536 | 33,6% | Demora de atendimento humano, não silêncio |
| Chegou fora do horário comercial | 340 | 21,3% | Fora de 8h–18h no fuso da clínica |
| Conversa em takeover humano (`ai_paused`) | 37 | 2,3% | A IA estava desligada por decisão do operador |
| Última mensagem da conversa | 115 | 7,2% | Fim de fio: despedida, agradecimento, encerramento |
| **Sem explicação nos dados** | **5** | **0,3%** | Dentro do horário, sem rajada, sem takeover, conversa continuou e ninguém respondeu |

**O que isto muda.** "A IA não responde metade dos turnos" não se sustenta. O que
o dado mostra é: a maior parte do que parecia silêncio é rajada ou demora, e o
resíduo verdadeiramente inexplicado são **5 turnos em 7.720** — 0,06%.

**O que isto não responde.** As categorias saem de estado que o banco guarda
hoje. Não é possível separar, com este dado, "a IA decidiu não responder" de "a
IA falhou ao responder": o trace não é persistido em produção. Essa distinção
depende da instrumentação que o Ciclo C já registrou como requisito da V2.

---

## 2. O balde `other`

2.683 turnos de 7.720 (**34,8%**) não casam com nenhuma regra de jornada. É o
maior balde do banco, e ele existe porque a heurística de amostragem é de
palavra-chave — o balde não é uma categoria, é a ausência de uma.

Distribuição por tenant: 1.537 · 457 · 418 · 271.

### Formato

| Medida | Valor |
| --- | ---: |
| Mediana de caracteres | 14 |
| Até 15 caracteres | 1.411 (52,6%) |
| Até 3 palavras | 1.503 (56,0%) |
| **Vêm logo após um turno do agente ou do operador** | **2.369 (88,3%)** |

O dado mais informativo é o último: quase nove em dez desses turnos são **resposta
a algo que a clínica acabou de dizer**. Isoladamente são incompreensíveis; em
contexto, quase todos são claros. É a descrição de um turno que só significa algo
contra o estado da conversa.

### Padrões recorrentes

Classificação heurística e exclusiva, na ordem abaixo. É descrição, não taxonomia
proposta.

| Padrão | Turnos | % | Exemplos observados |
| --- | ---: | ---: | --- |
| Resposta curta a turno anterior | 840 | 31,3% | "Ambas", "Eu moro do lado", "Irmão" |
| Pergunta que nenhuma jornada modela | 585 | 21,8% | "Quais procedimentos vocês realizam?", "Tem garantia essas lentes?", "Tem cores mais branca que essas" |
| Acknowledgement curto | 575 | 21,4% | "Sim", "Tabom", "Ok" |
| Carrega entidade ou dado | 328 | 12,2% | "Na cor azul marinho na malha pique", "Cheguei" |
| Verdadeiramente desconhecido | 267 | 10,0% | — |
| Conversa social | 84 | 3,1% | "Boa tarde", "Boa noite" |
| Mídia ou anexo sem texto | 4 | 0,1% | — |

### O que o dado sugere, sem propor nada

1. **21,8% são requests reais que ninguém modelou.** Garantia, catálogo de
   procedimentos, atributo de produto ("cor mais branca") e chegada do paciente
   aparecem repetidamente. São perguntas com resposta objetiva, não ruído.
2. **52,7% são acknowledgement ou resposta curta dependente de contexto.** Não
   têm pedido próprio, e é exatamente onde a V1 devolve enchimento — dois casos
   `filler-response` do corpus vêm daqui.
3. **12,2% carregam entidade sem pedido explícito.** "Cheguei", "azul marinho":
   dado que o sistema precisa capturar mesmo sem um `request` associado.
4. **10% permanecem desconhecidos** e devem continuar assim até alguém os ler um
   a um. Nenhuma categoria foi criada para acomodá-los.

Um achado incidental: aparece `"reset"` como mensagem de lead, o que corresponde
a um dos predicados de entrada estruturada da V1. Vale como evidência no Ciclo D,
quando os 30 predicados forem classificados entre *feature* e *cicatriz*.

### O que não foi feito

Nenhuma jornada nova, nenhum `request` novo, nenhum rótulo alterado, nenhum caso
reclassificado. `other` continua sendo o balde declarado de sobra.
