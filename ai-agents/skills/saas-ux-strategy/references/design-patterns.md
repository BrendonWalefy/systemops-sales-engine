# SaaS Design Patterns For AI Health Systems

Use estes padroes para manter o SystemOps premium, operacional e consistente.

## Color System

Preferir tokens do projeto. Quando precisar aproximar:

- Background main: `#09090B` ou `#0F1117`
- Surface: `#111113`
- Elevated surface: `#161B27`
- Cards/panels: `#18181B`
- Border subtle: `rgba(255,255,255,0.06)` a `rgba(255,255,255,0.10)`
- Text primary: `#FAFAFA`
- Text secondary: `#A1A1AA`
- Accent/action: `#00D4AA` ou token `--accent`
- Warning/attention: `#F59E0B`
- Danger/urgent: `#EF4444`

## Morphism / Glass

Aplicar como linguagem de hierarquia, nao decoracao.

- Surface morphic: fundo translucido escuro, borda clara sutil, `backdrop-filter: blur(...)`, sombra baixa e `inset 0 1px 0 rgba(255,255,255,0.05)`.
- Primary action: acento teal/cyan com texto escuro, peso 700 e sombra curta.
- Secondary controls: superficie escura translucida, borda sutil e texto muted.
- Related glass elements devem compartilhar radius, spacing e intensidade.
- Evitar: excesso de glow, gradientes roxos genericos, cards aninhados e superficies glass competindo entre si.

## Component Patterns

### AI Status

- Mostrar "IA ativa", "IA sincronizada", "Rascunho", "Publicado" ou "Intervencao humana" perto do fluxo afetado.
- Usar iconografia consistente: robot/sparkles/check para IA; warning para intervencao.
- Usar alerta forte apenas quando ha impasse real.

### Conversation Cards / Inbox

- Borda lateral ou marcador de status para temperatura do lead.
- Badge pequeno de IA quando automatizado.
- Acao humana destacada em amber/orange, sem poluir conversas normais.

### Dashboard Widgets

- Priorizar ROI: conversao, tempo economizado, leads agendados, custo de IA e saude do funil.
- Usar badges pequenos para tendencia; evitar graficos decorativos.
- Linha para tendencias, donut para distribuicoes simples.

### Settings / Setup IA

- Separar por modulos: Geral, Playbooks, Procedimentos/Conhecimento, Regras comerciais.
- Mostrar estado de versao: rascunho, em producao, historico.
- Configuracoes longas precisam de resumo, busca, filtros e edicao focada.

## UX Principles

- **Clareza antes de efeito:** se o efeito visual reduz legibilidade, remova.
- **Uma acao principal por bloco:** cada secao deve ter uma intencao obvia.
- **Controle humano:** sempre mostrar como testar, pausar ou revisar a IA.
- **Baixa curva de aprendizado:** operadores de clinica nao devem precisar entender engenharia de prompt.
- **Consistencia de status:** usar as mesmas cores e labels para lead, IA e versoes em todo o produto.
