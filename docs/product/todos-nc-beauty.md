# TODOs NC Beauty — insights da reunião 07/07/2026 para refinar

Backlog bruto extraído da reunião de pré-venda com a Natália (NC Beauty & Clinic,
estética/SP) + do shadow mode (7 conversas reais capturadas em 07/07). Cada item
está classificado para a triagem: **[FEATURE?]** candidato a virar feature genérica
(avaliar se atende qualquer organização), **[PRODUTO]** melhoria em algo que já
existe, **[OPERACIONAL]** ação pontual para esta cliente, **[COBERTO]** o produto
já resolve.

A config aplicada está em `scripts/seed-nc-beauty-config.ts` (rodado em 08/07/2026).

---

## 1. Agenda e follow-ups

- **[FEATURE?] Follow-up de retorno parametrizado por procedimento.** Quase todo
  agendamento de cílios sai com retorno em ~20 dias; limpeza de pele pede lembrete
  a cada 2–3 meses; cliente que fez a 1ª sessão e deixou a volta em aberto precisa
  de lembrete específico. Hoje o intervalo de retorno não é um campo do treatment.
  Candidato: `returnIntervalDays` (+ template de mensagem) por procedimento — o
  "layout para parametrizar os follow-ups personalizados" que ela pediu.
- **[FEATURE?] Confirmação de presença 24h antes + lembrete semanal.** Ela faz
  lembrete manual todo sábado e tenta confirmar 24h antes. Confirmação automática
  de agendamento é genérica e vale para qualquer segmento.
- **[FEATURE?] Mensagem de pré-reserva nos follow-ups.** A pré-reserva segura o
  horário até 3 dias antes; o follow-up deveria cobrar o sinal pendente com prazo.
  Conecta com o fluxo de sinal nativo (já mapeado como P2 na
  `ficha-setup-clinica.md`, Parte 2 item 5).
- **[FEATURE?] Notificação ao owner de horário vago + repost rápido.** Quando abre
  um buraco na agenda (cancelamento), notificar e oferecer botão rápido para
  divulgar (story do Instagram / lista no WhatsApp) e preencher com encaixe.
  Ela pediu explicitamente; genérico para qualquer agenda.
- **[FEATURE?] Resgate de clientes cancelados.** "Os clientes cancelados precisamos
  resgatar para encher agenda." Já existe `scripts/recovery-campaign.ts` como
  operação manual — candidato a virar campanha configurável no painel (respeitando
  caps do Channel Safety Engine).
- **[FEATURE?] Grade de procedimento por profissional.** "Cadastrar período de
  procedimento por profissional" + Daniela só faz *alguns modelos* do catálogo.
  Hoje `professionals.workSchedule` restringe horário, mas não há vínculo
  profissional×tratamento (Juliana só sobrancelha, Daniela só alguns cílios).
  Sem isso o SlotEngine não sabe quem pode atender o quê.
- **[PRODUTO] Parser de `business_hours` não modela "terça a sábado".**
  `parseBusinessHours` fixa days=[seg..sex](+sáb). A NC folga segunda → segunda
  entra indevidamente no cálculo de slots (o texto que a IA fala está correto).
  Mitigação atual: grade ter–sáb nas 3 profissionais (só vale em busca filtrada
  por profissional). Corrigir antes do go-live de agendamento.
- **[OPERACIONAL] Capacidade: 2 cadeiras, 3 profissionais, até 3 agendas
  simultâneas.** Cadeira fixa da Natália (manhã liberada para outra profissional)
  + 1 cadeira revezada. Clientes pedem para encher só a agenda da Natália (ela é
  a referência) — a flexibilidade de manipular horários entre profissionais ajuda
  a rotativa. A objeção "só quero com a Natália" já está no playbook.

## 2. Dinheiro e efetivação

- **[FEATURE?] Fluxo de sinal nativo (30%, Pix, abatimento).** Regra dela: cliente
  nova só confirma com sinal de 30% não reembolsável (<24h cancela e perde; >24h
  reagenda sem devolução); abatido do total; pré-reserva de 3 dias; **a partir do
  4º atendimento dispensa o sinal**. Já descrito na política comercial (a IA
  verbaliza), mas o produto não tem reserva-com-sinal de verdade. Era P2 na ficha;
  segunda cliente real pedindo — subir prioridade. Evidência do shadow: cliente
  Caah perguntou "Qual pix?" às 18:03 e só teve resposta às 18:58.
- **[FEATURE?] Score do cliente / fidelidade.** "A partir do 4º atendimento é
  cliente confiável" → dispensa sinal, ganha mimo, entra em campanha promocional.
  O app "Minha Agenda" que ela usa já ranqueia melhores clientes. Candidato:
  contador de atendimentos concluídos por lead + regras por faixa (sinal, brinde,
  campanha) — genérico para retenção em qualquer segmento.
- **[FEATURE?] Comissão por procedimento para não-owner.** O app de quem não é
  owner deve mostrar só a gestão da agenda + cálculo de comissões por
  procedimento realizado. Hoje não existe comissionamento.
- **[OPERACIONAL] Coletar chave Pix do sinal + nome que aparece no comprovante**
  (ficha bloco D4). Sem isso a IA não fecha o loop do sinal.

## 3. Funil, campanhas e vendas

- **[FEATURE?] Atribuição de campanha por lead.** "Na mensagem automática que chega
  no WhatsApp o cliente precisa identificar qual é a propaganda." Separar
  procedimento por lead/campanha, ranquear procedimentos que mais fecham e mostrar
  no painel. Google Ads + Instagram + Facebook ativos. Genérico e valioso (fecha o
  loop anúncio→receita).
- **[FEATURE?] Follow-up inteligente com incentivo progressivo.** Após o 2º/3º
  follow-up sem resposta, mensagem calorosa com desconto para fechar. Precisa de
  guardrails (desconto máximo autorizado pelo owner; nunca a LLM decidir valor).
- **[FEATURE?] Venda casada / ticket médio.** Entender o caso e oferecer
  procedimento complementar. Exige *briefing de compatibilidade*: procedimentos de
  pele têm restrições do que pode mesclar no mesmo dia (agride a pele). Candidato:
  matriz de compatibilidade entre treatments + sugestão de combo pela IA.
- **[FEATURE?] Venda consultiva com catálogo visual.** O método dela: entende a
  necessidade (desenho, formato, sutil ou marcado), elenca do catálogo o modelo
  mais próximo do perfil e envia a foto para despertar desejo. Depende da
  biblioteca de mídia (iniciativa já em `biblioteca-midia-plano.md`) + pipeline
  por treatment. O funil textual já está no playbook; falta a mídia por modelo.
- **[COBERTO] Não passar preço no primeiro interesse.** Regra "qualificar antes de
  informar valores" no notes do playbook v1, com funis de pele/cílios modelados
  nas mensagens reais dela.
- **[OPERACIONAL] Subir o catálogo de modelos (cílios/sobrancelhas) e o Guia de
  Serviços como media assets** e vincular aos treatments quando a biblioteca de
  mídia estiver pronta.

## 4. Conversa e canal

- **[FEATURE?] "Posso te mandar um áudio?" (voz para quem não lê).** Clientes que
  não sabem ler/escrever: a IA deveria oferecer resposta em áudio. A entrega por
  voz existe (`voiceResponseEnabled`/TTS); falta o gesto de *perguntar* e trocar o
  formato por conversa (não por clínica inteira).
- **[PRODUTO] Advisor de objeções redige mal.** "Parece que o modelo está só
  redigindo o que foi escrito do jeito do cliente" — a sugestão de
  objeção/resposta precisa elevar o texto (nível das conversas curadas da demo),
  senão o cliente leva a dúvida para outro agente. Encaixa no plano de excelência
  conversacional / `engenheiro-conversa`.
- **[OPERACIONAL] Desligar o autoresponder do WhatsApp Business dela antes do
  go-live.** O shadow capturou a mensagem automática de ausência (que ainda cita
  "Nandaa" como atendente e horários de WhatsApp seg–sex 10h–19h / sáb 10h–16h,
  diferentes do estúdio). Dois robôs no mesmo número colidem; a persona oficial é
  **Bia** (confirmado na reunião).
- **[OPERACIONAL] Template dela saiu com "[Nome]" sem preencher** na campanha de
  inverno capturada no shadow ("Oi, [Nome]! Tudo bem? 🤎") — argumento de venda:
  personalização automática de verdade. O texto da campanha de inverno dela é bom
  material para reengajamento sazonal.

## 5. Onboarding e prova de valor

- **[FEATURE?] Fotografia antes/depois do SystemOps.** Aproveitar os números do
  diagnóstico comercial (já capturados em `organizations.commercial_diagnostic`)
  como baseline e comparar com os resultados pós-go-live, para case de venda.
  Baseline NC Beauty: ~30 leads/mês → 5–7 fecham (~20%); anúncios já chegaram a
  R$ 700/mês com retorno ~R$ 3k; hoje ~R$ 190/mês, ~3 leads/dia; 1 anúncio de
  extensão de cílios rende ≥1 cliente/semana; sobrancelha teve pouco retorno com
  anúncio; produto mais forte: cílios.
- **[FEATURE?] Métrica "quanto a plataforma vendeu este mês".** Personalizar a
  visão de receita *gerada pela plataforma* separada do dinheiro que entra por
  retorno/recorrência.
- **[OPERACIONAL] Prompt de extração para a cliente rodar no ChatGPT** (pedido da
  reunião) — versão v1 abaixo; enviar para a Natália e estruturar a resposta na
  config:

  > Você vai me ajudar a organizar as informações do meu negócio de estética para
  > eu configurar minha recepcionista virtual. Me entreviste, UMA pergunta por
  > vez, e no final gere um resumo organizado em listas. Precisa cobrir:
  > (1) para cada procedimento que ofereço: nome, apelidos que as clientes usam,
  > preço, quanto tempo dura a sessão na cadeira, de quanto em quanto tempo a
  > cliente volta; (2) meus horários de atendimento por dia da semana e bloqueios
  > fixos; (3) quem atende o quê na equipe e em que dias/horários; (4) regras de
  > sinal e cancelamento (valor, prazo, chave Pix e nome que aparece no
  > comprovante); (5) formas de pagamento e parcelamento; (6) as 5 perguntas que
  > as clientes mais fazem no WhatsApp e como eu respondo cada uma, com minhas
  > palavras; (7) o que a atendente NUNCA deve prometer ou falar. Não invente
  > nada: se eu não souber, marque como "confirmar depois". No final, gere o
  > resumo em tópicos curtos, sem texto corrido.

## 6. Pendências de coleta (ficha de setup)

- Durações reais de cada procedimento na cadeira (as do seed são **estimativas**).
- Chave Pix + nome no comprovante (item 2 acima).
- Grades individuais reais de Juliana e Daniela (hoje as 3 usam a grade do
  estúdio: ter–sex 13h–19h, sáb 10h–17h).
- Quais modelos do catálogo a Daniela faz (depende do vínculo
  profissional×tratamento do item 1).
- Instagram oficial (@nataliacostabeautyclinic, confirmar) e referências de
  localização para o FAQ.
- Manutenção até 120 dias: confirmar se vale para todas as técnicas com
  manutenção.

## Decisões de config tomadas no seed v1 (revisar com a Natália)

- Persona **Bia**, tom caloroso modelado nas mensagens reais (apelido carinhoso,
  "me conta uma coisinha", 1 pergunta por vez, emojis 🥰💕✨ com moderação).
- 21 procedimentos com preço fixo do Guia de Serviços, todos cotáveis no chat,
  mas com conduta "qualificar antes de informar valor".
- Manutenção de cílios virou 3 procedimentos (até 15 dias / 16–21 / gringas) para
  o preço certo por janela; pacotes (Reconstrução 5x, Hydra Gloss 3x,
  Manchas/Espinhas) viraram procedimentos próprios.
- Vocabulário: cliente / horário / procedimento (não paciente/consulta).
- `postAppointmentBufferMinutes` 60→15 (estética emenda atendimentos; validar).
- Horário do estúdio (ter–sáb) no `business_hours`; limitação do parser documentada
  no item 1.
