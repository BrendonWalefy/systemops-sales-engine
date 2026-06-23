# Demo & Marketing — Clínica fictícia "Odonto Marques"

> Documento vivo. Objetivo: ter uma base controlada para **gravar conteúdo de
> marketing** (vídeos, anúncios, demonstrações em reunião, treinamento) sem
> usar dado real de paciente e **sem criar caminho de código paralelo**.
>
> Princípio que guia tudo aqui: **não quebrar nada que já funciona em
> produção.** Cada melhoria abaixo é independente, pequena, reversível e entra
> uma de cada vez, conversada antes. Nada é agrupado.

Data de criação: 2026-06-22 · Branch de trabalho: `claude/demo-mode-marketing-06swl8`

---

## 1. Decisão de arquitetura (já tomada)

Avaliamos duas opções:

1. **Clínica fictícia real** (um tenant de verdade, populado por seed).
2. **Feature "modo demo"** que manipula dados em runtime.

**Escolhida: opção 1.** Motivos:

- O app é **multi-tenant e config-first** — uma clínica nova não exige código.
- O **dashboard, o inbox e a agenda são calculados 100% ao vivo** a partir de
  `leads / conversations / messages / appointments`. Não existe tabela de
  "números do painel" para preencher. Logo, um "modo demo" que finge números
  exigiria um caminho de código paralelo que **mente** e que vira dívida de
  manutenção. Com um tenant real, **o demo é o próprio produto funcionando** —
  mais crível na venda e ainda valida o app.

> Consequência prática importante: para o painel mostrar "184 leads", precisam
> **existir 184 leads de verdade**. Por isso o seed gera volume realista.

---

## 2. O que já está entregue ✅

**`scripts/seed-demo.ts`** + comando **`npm run seed:demo`**.

- Cria a **Odonto Marques** como tenant real, idempotente (reseta e
  re-data tudo a cada execução, pro painel ficar "fresco" no dia da gravação).
- Marcada `isTest: true` e `autoReplyEnabled: false` → **fica fora dos crons,
  do digest e de qualquer envio real** (segurança: nunca toca produção viva).
- Login da clínica para gravar como dona:
  `helena@odontomarques.com.br` / `OdontoMarques2026!`

### Como usar
```bash
npm run seed:demo   # cria/reseta a clínica demo e re-data os registros
```

### Conteúdo gerado (kit de marketing)
- **Clínica:** Odonto Marques · São Paulo/SP · seg–sex 08–19h, sáb 08–13h ·
  IA **Marina** · tom consultivo/acolhedor/premium · menu com labels curtos.
- **4 profissionais** com cor: Dra. Helena Marques (verde), Dr. Rafael Nogueira
  (azul), Dra. Camila Torres (roxo), Dr. André Vilela (dourado).
- **7 procedimentos** com preço (avaliação R$ 150, lentes a partir de R$ 1.800
  por dente, clareamento R$ 690, implante R$ 2.900, alinhadores R$ 350/mês,
  limpeza R$ 220, harmonização R$ 890).
- **Playbook ativo**, agenda da semana com bloqueios de almoço, follow-ups de
  recuperação, conversas de exemplo.

### Números-alvo do painel (todos derivados de dado real)
| Métrica | Alvo | Observação |
|---|---|---|
| Total de leads / últimos 7 dias | 184 / 42 | |
| Consultas marcadas / conversão | 63 / 34% | conversão = 63÷184 (é **derivada**) |
| Consultas hoje | 6 | |
| Autonomia IA | **97,8%** | exibe uma casa decimal (≈98%) |
| Mensagens fora do horário | 58 | |
| Tempo economizado | 42h | ~1.260 mensagens da IA |
| Leads quentes ativos | 12 | |
| Receita potencial / confirmada / ROI | R$ 68.400 / R$ 21.700 / **480%** | ROI hoje em % |
| Abas Inbox | 184 · 12 · 21 · 8 · 4 · 3 · 9 | todas/quente/morno/frio/atenção/pausado/recuperação |

### Decisões de consistência tomadas nesta conversa
- **Conversão:** 184 leads + 31 consultas dava 17% (é divisão). Optamos por
  **63 consultas → 34%**, mantendo os 184 leads.
- **Autonomia × Atenção:** são o mesmo dado (`autonomia = 1 − Atenção÷184`).
  Optamos por **Atenção 4 → autonomia ~98%**.
- **Nomes:** trocados **Bianca Souza → Larissa Fonseca** e **Gregório Almeida →
  Thiago Barros** (eram nomes que pediu para evitar).

---

## 3. Backlog incremental de melhorias de UI

> Estas melhorias **apareceram nesta conversa** (seção "ajustes de tela").
> Elas mexem em **componentes compartilhados por TODAS as clínicas**, não só na
> demo. Por isso ficaram **fora** do seed e entram **uma de cada vez**, com
> preview validado, conversadas antes. Ordem sugerida: do mais seguro para o
> mais sensível.

Legenda de risco: 🟢 baixo (cosmético, reversível) · 🟡 médio (mudança de
significado ou layout) · 🔴 alto (toca lógica de negócio — evitar).

### 3.1 🟢 Remover o ano da data do cabeçalho do dashboard
- **Origem:** "evitar data futura estranha" — o ano (2026) distrai no vídeo.
- **Onde:** `dashboard/page.tsx` → `todayFormatted()` (e o header mobile).
- **O que muda:** "Segunda-feira, 22 de junho" em vez de "...de 2026".
- **Risco:** 🟢 cosmético, sem dependência lógica. Reversível em 1 linha.
- **Cuidado:** é texto exibido a **todas** as clínicas — é uma melhoria geral
  legítima (ninguém precisa do ano no cabeçalho diário), então recomendo
  aplicar para todos, não só na demo.
- **Recomendação:** **fazer.** Bom primeiro item, risco quase nulo.

### 3.2 🟢 Arredondar a "Autonomia IA" para inteiro
- **Origem:** o ring mostra "97,8%"; o kit pede "98%".
- **Onde:** `DashboardRingMetrics.tsx` (`automationRate.toFixed(1)`).
- **O que muda:** `Math.round(automationRate)` → "98%".
- **Risco:** 🟢 cosmético; o componente só exibe o valor.
- **Cuidado:** confirmar que nenhum outro lugar depende da casa decimal (hoje
  só este componente formata assim). Melhoria geral válida.
- **Recomendação:** **fazer.**

### 3.3 🟡 Saudação do dashboard com nome amigável
- **Origem:** "Olá, Brendonwalefyom!" — pega o local-part do email.
- **Estado atual na demo:** já sai **"Olá, Helena!"** (porque o login é
  `helena@…`). O que falta é o prefixo "Dra." e robustez geral.
- **Onde:** `dashboard/page.tsx` → `emailToFirstName(userEmail)`.
- **O que muda (proposta):** preferir um **nome de exibição do membro** quando
  existir, caindo para o nome da clínica, e só então para o email.
- **Risco:** 🟡 hoje não há coluna de nome em `clinic_members`. Fazer "bonito"
  para todos implicaria **migration** (coluna `display_name`) — mudança de
  schema = mais cuidado. Sem migration, dá para melhorar só o fallback
  (cosmético, 🟢), mas não vira "Dra. Helena" automático.
- **Recomendação:** **discutir.** Para a gravação, "Olá, Helena!" já resolve.
  O "Dra." pleno fica para quando decidirmos a coluna `display_name`
  (melhoria real de produto, não só de vídeo).

### 3.4 🟡 Labels do menu truncados ("...len", "...pagamer")
- **Origem:** opções cortadas matam a percepção premium.
- **Estado atual na demo:** já usamos **labels curtos** no seed (`menuItems`),
  então na Odonto Marques não trunca.
- **Onde investigar:** onde `menuItems` é renderizado (simulador de playbook /
  preview do menu) — provável `text-overflow: ellipsis` com largura fixa.
- **O que muda (proposta):** permitir quebra de linha ou aumentar a largura do
  contêiner, para qualquer clínica com label mais longo.
- **Risco:** 🟡 mexer em CSS de layout pode empurrar outros elementos; precisa
  de preview em desktop e mobile.
- **Recomendação:** **investigar e corrigir como bug real** (beneficia todas as
  clínicas), mas só depois de ver o componente e validar o layout.

### 3.5 🟡 ROI como "4,8x" em vez de "480%"
- **Origem:** o kit pede "ROI 4,8x"; o painel exibe percentual.
- **Onde:** bloco "Pipeline de Receita" em `dashboard/page.tsx`.
- **O que muda:** formatar `confirmado ÷ mensalidade` como `4,8x`.
- **Risco:** 🟡 **mudança de significado percebido.** Donos reais podem estar
  acostumados a ler "% da receita mensal". Trocar a notação para todos é uma
  decisão de produto, não só estética.
- **Recomendação:** **discutir.** É o mesmo número (480% = 4,8x). Para a demo,
  o valor já aparece correto; a notação "x" pode ficar para uma decisão
  consciente sobre como queremos comunicar ROI no produto.

### 3.6 🟢 Estados vazios sem "R$ 0" cru
- **Origem:** "R$ 0" passa sensação de sistema vazio.
- **Estado atual:** o pipeline de receita **já tem empty-state** ("Cadastre
  preços… para ver o pipeline"). Na demo não aparece R$ 0 porque há dados.
- **Risco:** 🟢. Se quisermos, podemos revisar outros cards que mostram 0.
- **Recomendação:** **baixa prioridade.** Resolvido para a gravação; revisitar
  só se algum card específico incomodar no vídeo.

---

## 4. O que **não** vamos fazer (para não quebrar nada)

- ❌ Nenhum "modo demo" em runtime que injete/finja dados — decisão da seção 1.
- ❌ Não reutilizar credenciais Z-API/Meta reais na clínica demo (ela fica sem
  canal e com `autoReplyEnabled: false`).
- ❌ Não marcar a clínica demo como produção ativa nos crons (`isTest: true`).
- ❌ Não agrupar as melhorias da seção 3 num único PR. Uma de cada vez.
- ❌ Não tocar em lógica de negócio (cálculo de slots, booking, state machine,
  classificação de intent) para "embelezar" tela. Risco 🔴, fora de escopo.

---

## 5. Ideia futura (opcional)

**Botão "Carregar clínica demo" no painel owner** que dispara o mesmo
`seed-demo` sob demanda (sem terminal). Útil para reset rápido antes de gravar.
- Só faz sentido **depois** que o seed estiver maduro e usado algumas vezes.
- Deve ficar **restrito ao owner** e **bloqueado em produção** por flag, para
  nunca rodar acidentalmente contra dados reais.
- Não é prioridade: o comando `npm run seed:demo` já destrava a gravação hoje.

---

## 6. Status / próximos passos

| Item | Risco | Status |
|---|---|---|
| `scripts/seed-demo.ts` (Odonto Marques) | — | ✅ entregue |
| 3.1 Data sem ano | 🟢 | ✅ aplicado |
| 3.2 Autonomia arredondada (98%) | 🟢 | ✅ aplicado |
| 3.3 Saudação "Dra. Helena" | 🟢 | ✅ aplicado **sem migration** (via profissional vinculado) |
| 3.4 Menu truncado | 🟡 | 🔎 investigado — só no editor; demo ok; sem ação |
| 3.5 ROI "4,8x" | 🟡 | ✅ aplicado ("4,8x sobre a mensalidade") |
| 3.6 Estados vazios | 🟢 | resolvido na demo; baixa prioridade |
| Botão "Carregar clínica demo" | 🟡 | futuro |

> **Nota 3.3:** A saudação "Olá, Dra. Helena!" foi resolvida **sem mudança de
> banco**. O membro já tem `professionalId`; o dashboard agora deriva a
> saudação do nome do profissional vinculado ("Dra. Helena Marques" → "Dra.
> Helena"), com fallback para o email. Mais seguro que a coluna nova
> cogitada — não toca em schema/migration, então não há risco de CI/produção.

> Forma de trabalho: escolhemos um item, eu mostro o componente e o preview,
> validamos juntos, aí sim aplico — em mudança pequena e isolada.
