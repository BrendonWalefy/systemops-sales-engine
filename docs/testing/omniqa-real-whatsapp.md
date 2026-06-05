# omniQA — WhatsApp Real Com Segunda Clinica

Este modo complementa o sandbox `/api/playbook/simulate`. Ele usa webhook,
persistencia, estado de conversa, agenda interna e envio Z-API reais, mas
mantem os testes fora da Ximendes.

## Clinica De Validacao

- Nome: `BW odontologia`
- Slug: `bw-odontologia`
- `isTest = true`
- `calendarMode = internal`
- `conversationExperience = concierge`
- `autoReplyEnabled = true`

A BW odontologia funciona como uma segunda clinica completa para validacao real.
Ela nao possui credenciais Z-API proprias. Usa `whatsapp_qa_routes` para
enviar pelos tokens da clinica fonte apenas quando o telefone do lead esta
allowlistado.

`isTest = true` deixa a clinica fora do MRR e do custo fixo no financeiro
enquanto ela estiver em validacao; nao altera o comportamento da conversa.

## Telefones Allowlistados

| Telefone | Uso |
| --- | --- |
| `5511940617713` | Aline whatsapp clinica / recepcao QA |
| `5511953628848` | Lead testes |
| `5511954368563` | Gregorie, lead testes |

Mensagens desses telefones que chegam pela instancia Z-API da Ximendes sao
registradas na BW odontologia. Outros telefones continuam indo para a Ximendes.

## O Que Este Modo Valida

- webhook Z-API real;
- dedupe por `messageId` e por conteudo;
- pausa humana via `fromMe`;
- persistencia de lead, conversa e mensagens;
- agenda interna sem Google Calendar;
- slots, bloqueios, criacao, cancelamento e reagendamento;
- envio real pelo canal WhatsApp compartilhado;
- follow-up e lembrete quando o lead esta allowlistado.

## Como Reproduzir Conversas Reais

1. Escolha uma conversa real da Ximendes que expôs problema.
2. Copie somente as mensagens do lead, em ordem.
3. Reenvie o mesmo texto a partir de um dos numeros allowlistados.
4. Compare a resposta, intent, estado de conversa e agenda gerada na BW.
5. Se o comportamento for ruim, transforme a sequencia em teste automatizado
   antes de corrigir producao.

Nao use novos leads reais da Ximendes para regressao. A Ximendes pode continuar
captando mensagens reais, mas o teste de comportamento deve acontecer na BW com
telefones controlados.

## Diferenca Para O Simulate

`/api/playbook/simulate` e rapido e barato para validar linguagem/intents, mas
nao testa canal, estado persistido nem webhook. O modo WhatsApp real e o caminho
para cenarios criticos antes de voltar a operar em producao.
