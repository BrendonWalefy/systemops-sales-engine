# Playbook Editor Patterns

Use esta referencia ao melhorar editores de playbook, setup de IA e simuladores.

## Information Architecture

Ordenar o editor por leitura operacional:

1. Contexto base: especialidade, tom de voz, procedimento.
2. Argumentos: diferenciais, politica comercial, regras de abordagem.
3. Objecoes e respostas: objecao curta, resposta preparada, status.
4. Teste/simulacao: laboratorio lateral com o playbook atual.
5. Publicacao/versionamento: rascunho, ativo, historico, completude.

## Objections UX

Quando houver muitas objecoes:

- Nao exibir todas as respostas abertas.
- Usar linhas compactas com uma unica resposta expandida por vez.
- Mostrar contadores: total, prontas, pendentes.
- Incluir busca por texto da objecao e da resposta.
- Incluir filtro de pendentes para completar rapido.
- Numerar itens ou usar status visual para orientacao.
- Ao adicionar nova objecao, abrir o item novo automaticamente.
- Ao remover, preservar foco em um item vizinho quando existir.

Campos:

- Objecao deve ser curta e escaneavel.
- Resposta pode ser textarea maior.
- Status deve indicar "Resposta pronta", "Sem resposta" ou "Nova".

## Sandbox / Chat De Teste

O simulador deve parecer laboratorio de validacao, nao chat generico.

- Mostrar status "IA sincronizada" ou equivalente.
- Usar prompts rapidos baseados nas objecoes cadastradas.
- Diferenciar Lead e IA por alinhamento, avatar, cor e label.
- Manter scroll interno na lista de mensagens.
- Evitar `scrollIntoView` em elementos fora do painel; isso pode puxar a pagina inteira ao focar textarea.
- Campo de mensagem deve manter altura controlada e nao sobrepor a barra inferior.

## Save / Confidence

- Mostrar salvamento automatico de forma discreta: aguardando, salvando, salvo.
- Completude deve ser apoio, nao a acao principal.
- Botao primario deve ser claro mesmo se o autosave existir.

## Responsive Rules

- Em desktop, editor principal + sandbox sticky lateral.
- Em mobile, sandbox vira bloco normal com altura fixa/rolagem interna.
- Filtros e busca quebram em uma coluna.
- Badges secundarios podem ocultar em telas estreitas, mas status critico deve permanecer.
