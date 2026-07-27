/**
 * Lint puro do campo `notes` — sem imports de servidor, utilizável em client components.
 *
 * Detecta quando `notes` está sendo usado como depósito de informações que pertencem
 * a campos estruturados. Retorna lista de avisos; nunca bloqueia publicação.
 */
export function lintPlaybookNotes(notes: string | null | undefined): string[] {
  if (!notes?.trim()) return [];
  const warnings: string[] = [];
  if (CONCRETE_PRICE_PATTERN.test(notes)) {
    warnings.push('Contém padrão de preço (R$). Preços pertencem ao campo Política Comercial.');
  }
  if (/parcel[ao]|entrada(?= em| de)|forma(?:s)? de pagamento/i.test(notes)) {
    warnings.push('Menciona condições de pagamento. Isso pertence ao campo Política Comercial.');
  }
  if (/\bobjeç[aã]o\b|desconto|(?:muito )?caro|barato/i.test(notes)) {
    warnings.push('Menciona objeções ou preço relativo. Use o campo Objeções para isso.');
  }
  if (PLAYBOOK_FLOW_PATTERNS.some((pattern) => pattern.test(notes))) {
    warnings.push(
      'Contém comando de fluxo, mídia ou sequenciamento. Esse comportamento pertence ao pipeline do procedimento.',
    );
  }
  return warnings;
}

// Valor de preço CONCRETO: "R$" seguido (após espaços opcionais) de ao menos um
// dígito. Não casa "R$" solto nem "R$ para" — só um valor de fato.
const CONCRETE_PRICE_PATTERN = /R\$\s*\d[\d.,]*/;

// `notes` pode orientar tom e conduta, mas não é um motor de workflow. Estes
// padrões são intencionalmente estreitos: procuram comandos explícitos, não
// simples menções a vídeo, foto, etapa ou agendamento.
const PLAYBOOK_FLOW_PATTERNS = [
  /\b(?:envie|mande|mostre|apresente|compartilhe|dispare)\b[^.!?\n]{0,120}\b(?:vídeo|video|vídeos|videos|mídia|midia|mídias|midias|imagem|imagens|foto|fotos|áudio|audio|áudios|audios)\b/i,
  /\b(?:inicie|comece|avance|retome|reinicie)\b[^.!?\n]{0,100}\b(?:pipeline|fluxo|etapa|passo)\b/i,
  /\b(?:trigger|gatilho)\s+(?:de|do|da|para)\b/i,
  /\b(?:aguarde|espere)\b[^.!?\n]{0,120}\b(?:antes de|até que|ate que)\b/i,
];

/**
 * Subconjunto BLOQUEANTE do lint de `notes`: padrões que carregam um FATO com
 * casa estruturada e portanto não devem publicar. Diferente de `lintPlaybookNotes`
 * (avisos, nunca bloqueiam), estes TRAVAM a ativação do playbook.
 *
 * Mantido deliberadamente ESTREITO: fatos com casa estruturada e comandos
 * explícitos de workflow. Padrões fuzzy (palavra "parcelamento", "desconto" ou
 * mera menção a mídia) continuam apenas como aviso, para não bloquear orientação
 * comportamental legítima.
 */
export function blockingPlaybookNotesIssues(notes: string | null | undefined): string[] {
  if (!notes?.trim()) return [];
  const issues: string[] = [];
  if (CONCRETE_PRICE_PATTERN.test(notes)) {
    issues.push(
      'O campo de conduta (notes) contém um valor em R$. Preço pertence ao valor do procedimento (cadastro do tratamento) — a IA fala o preço a partir dele. Remova o valor daqui antes de publicar.',
    );
  }
  if (PLAYBOOK_FLOW_PATTERNS.some((pattern) => pattern.test(notes))) {
    issues.push(
      'O campo de conduta (notes) contém comando de fluxo, envio de mídia ou sequenciamento. Esse comportamento pertence ao pipeline estruturado do procedimento. Remova o comando daqui antes de publicar.',
    );
  }
  return issues;
}

/**
 * Item 3 (config ownership): a partir da derivação de preço, o número em R$ tem
 * casa em `treatments.priceCents` — a prosa da IA é gerada dele. Escrever preço à
 * mão na `commercialPolicy` reintroduz o drift que a derivação elimina. AVISO
 * (não bloqueia): a política pode carregar enquadramento legítimo (parcelamento,
 * condições) enquanto clínicas antigas ainda não migraram o preço para o cadastro.
 */
export function lintCommercialPolicy(policy: string | null | undefined): string[] {
  if (!policy?.trim()) return [];
  const warnings: string[] = [];
  if (CONCRETE_PRICE_PATTERN.test(policy)) {
    warnings.push(
      'Contém valor em R$. Preço de lista: cadastre no procedimento (aba Financeiro) e marque "cotável no chat". Preço promocional/temporário: cadastre uma Campanha para o procedimento. A IA fala os dois a partir de lá, nunca desta política.',
    );
  }
  return warnings;
}

/**
 * Coerência de persona: o `greetingMessage` da clínica é o OPENER do primeiro contato
 * (modo concierge), enquanto o `receptionistName` é quem a LLM diz ser nas respostas
 * seguintes. Se o nome configurado não aparece na saudação, o lead conhece dois
 * personagens: abre com "sou a recepcionista virtual" e depois recebe "aqui é a Marina".
 *
 * Caso real (Ximendes, jul/2026): receptionistName="Marina" mas a saudação não a
 * nomeava — 62 mensagens diziam "Marina" e 31 "recepcionista virtual" na mesma clínica.
 * Descobrimos lendo conversa; este lint pega o drift no editor.
 *
 * AVISO (nunca bloqueia): a clínica pode legitimamente escolher um opener sem nome.
 */
export function lintPersonaCoherence(
  greetingMessage: string | null | undefined,
  receptionistName: string | null | undefined,
): string[] {
  const greeting = greetingMessage?.trim();
  const name = receptionistName?.trim();
  if (!greeting || !name) return [];

  const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (normalize(greeting).includes(normalize(name))) return [];

  return [
    `A saudação não menciona "${name}". Como ela é o texto de abertura do primeiro contato, o lead vai ler a saudação e depois receber respostas assinadas por "${name}" — dois personagens diferentes. Inclua o nome na saudação (ex.: "Me chamo ${name}, ...") ou ajuste o nome da recepcionista.`,
  ];
}

/**
 * Item 6 §6C (config ownership): agora que campanhas promocionais (`price_campaigns`)
 * têm casa estruturada própria, não sobra motivo legítimo para digitar um preço à
 * mão na `commercialPolicy` — nem o valor de lista (mora em `treatments.priceCents`)
 * nem o promocional (mora em `price_campaigns`). BLOQUEIA a ativação até ser
 * removido, mesma régua do fact-guard. Antes deste ponto era só aviso porque
 * clínicas migrando ainda não tinham onde cadastrar promoção.
 */
export function blockingCommercialPolicyIssues(policy: string | null | undefined): string[] {
  if (!policy?.trim()) return [];
  const issues: string[] = [];
  if (CONCRETE_PRICE_PATTERN.test(policy)) {
    issues.push(
      'A política comercial contém um valor em R$. O preço de lista mora no cadastro do procedimento (aba Financeiro) e o preço promocional mora em Campanhas — a IA fala os dois a partir de lá. Remova o valor daqui antes de publicar.',
    );
  }
  return issues;
}

/**
 * Item 6 §6C (config ownership): gate anti-drift no publish. A descrição do
 * procedimento é FATO factual — o preço mora em `treatments.priceCents` e a IA o
 * fala derivado (Item 3). Um valor em R$ na descrição é o mesmo fato em dois
 * lugares: BLOQUEIA a ativação até ser removido. Mesma régua do fact-guard, agora
 * na ENTRADA humana.
 */
export function blockingTreatmentDescriptionIssues(
  treatments: { name: string; description: string | null }[],
): string[] {
  const issues: string[] = [];
  for (const t of treatments) {
    if (t.description && CONCRETE_PRICE_PATTERN.test(t.description)) {
      issues.push(
        `O procedimento "${t.name}" tem um valor em R$ na descrição. O preço mora no valor do procedimento (a IA fala a partir dele) — remova o valor da descrição antes de publicar.`,
      );
    }
  }
  return issues;
}
