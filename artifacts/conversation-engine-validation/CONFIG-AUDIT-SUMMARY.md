# Auditoria de configuração e banco real

Data: 24/07/2026
Fonte: consultas read-only ao banco real, com snapshots sanitizados.

## Resumo

| Clínica | Status | Playbooks total/ativos | Tratamentos | Campanhas | Módulos | Mídias |
|---|---|---:|---:|---:|---:|---:|
| Ximendes | active | 2 / 1 | 17 | 0 | 8 | 8 |
| Clínica Vitalli | paused | 6 / 1 | 27 | 2 | 9 | 11 |
| NC Beauty Clinic | test | 3 / 1 | 21 | 0 | 1 | 1 |

As três clínicas possuem exatamente um playbook ativo. Isso refuta uma violação atual na amostra, mas não elimina o risco estrutural: não há unique index parcial e os fluxos de ativação usam múltiplas statements sem transação/CAS.

## Matriz dos findings de configuração

| ID | Veredito | Evidência atual |
|---|---|---|
| CFG-01 | Confirmado | Banco real contém legado e exceções não inferíveis por seed/docs |
| CFG-02 | Parcial | Amostra íntegra; schema e ativação ainda permitem corrida |
| CFG-03 | Parcial | Nenhum tratamento combina `triggerTemplate` e pipeline; notes ativo da Ximendes contém trigger legado |
| CFG-04 | Confirmado | Ximendes ativa duplica um valor estruturado em `commercialPolicy`; Vitalli tem duplicações históricas |
| CFG-05 | Confirmado | Playbook ativo da Vitalli seleciona 8 mídias, 6 resolvem e 2 estão órfãs |
| CFG-06 | Confirmado | NC Beauty usa `shadowModeEnabled`, que ainda permite efeitos do engine |
| CFG-07 | Parcial | Resolver atual aposentou fallbacks importantes, mas schema/código de ativação conservam resíduos |
| CFG-08 | Confirmado | Conteúdo Premium/Estratificada da Vitalli está duplicado no core universal |
| CFG-09 | Confirmado | `depositEnabled` não modela se a avaliação é gratuita ou paga |
| CFG-10 | Confirmado | Runtime contorna `treatments.isAesthetic` com heurística de nome |

## Ximendes

### Declarado

- Organização ativa e auto-reply habilitado.
- Calendar mode interno; Google Calendar ID permanece configurado, mas inativo.
- Um playbook ativo.
- 17 tratamentos; 3 possuem pipeline.
- Nenhum `triggerTemplate` configurado nos tratamentos.
- O playbook ativo seleciona 4 mídias e as 4 resolvem.

### Divergências

1. O playbook ativo contém um valor manual em `commercialPolicy`.
2. Esse valor atualmente coincide com um fato estruturado, portanto não há divergência numérica observada; ainda assim existem dois donos e o valor pode se separar no futuro.
3. O playbook ativo contém um bloco `TRIGGER` em `notes`, que entra em `playbookText` da LLM enquanto o pipeline determinístico existe em tratamentos.
4. Uma versão histórica ainda contém `media_library` legado.
5. `googleCalendarId` configurado com `calendarMode=internal` é legado inativo, não falha de agenda.

### UI × runtime

- A UI atual bloqueia nova ativação se `commercialPolicy` contiver valor em R$.
- O dado ativo é anterior/grandfathered e continua consumido.
- O runtime prefixa preços derivados aos textos humanos, logo a duplicação ainda chega ao contexto.
- O runtime usa `pipelineSteps`; `triggerTemplate` não é mais lido. Entretanto `notes` continua sendo injetado no prompt.

## Clínica Vitalli

### Declarado

- Organização pausada, auto-reply desabilitado e reengajamento pausado.
- Calendar mode Google Calendar.
- Um playbook ativo.
- 27 tratamentos; 5 possuem pipeline.
- 2 campanhas cadastradas.
- Nenhum `triggerTemplate` configurado.
- Garantia estruturada configurada com duas faixas.
- Mensagem de localização configurada.

### Divergências

1. O playbook ativo seleciona 8 IDs de mídia; apenas 6 resolvem na biblioteca atual.
2. Os 2 IDs órfãos ativos não aparecem nos 17 blocos de mídia dos pipelines resolvidos. O impacto observado é omissão no conjunto editorial, não quebra comprovada do pipeline.
3. As outras referências órfãs estão em versões históricas e são dívida de migração, não runtime ativo.
4. Duas versões históricas contêm preço manual; o playbook ativo não contém.

### UI × runtime

- O resolver consulta os IDs existentes da mesma organização e omite IDs ausentes.
- Como `mediaAssetIds` não está vazio, não há fallback para `media_library`.
- A ativação atual possui gates contra preço em texto livre, mas não há constraint que preserve referências de um array JSONB.

## NC Beauty Clinic

### Declarado

- Organização de teste.
- Auto-reply desabilitado.
- `shadowModeEnabled=true`.
- Um playbook ativo.
- 21 tratamentos, sem pipeline e sem campanha.
- Uma mídia selecionada e resolvida.

### Divergência

O nome “shadow” pode sugerir execução sem efeitos, mas a flag somente suprime a entrega técnica. O pipeline e outros efeitos do motor continuam possíveis. Nesta clínica não há pipelines, porém a semântica global da flag permanece inadequada para V2 shadow.

## Ownership e resíduos

### Já corrigido no código atual

- Preço efetivo é resolvido de `treatments` + campanha ativa.
- `composePriceSection()` deriva a prosa de preço.
- `procedureDescription` do playbook foi aposentado no runtime.
- `triggerTemplate` não é consumido pelo orquestrador atual.
- IntentClassifier e ResponseComposer usam a mesma janela `.slice(-8)`.
- Lembretes ao lead, follow-up e recovery cron já usam outbox.

### Ainda pendente

- Dados grandfathered violam gates novos.
- `notes` pode reintroduzir comando de fluxo no prompt.
- `media_library` e `trigger_template` continuam no schema.
- A ativação ainda possui um `compileToClinicFields()` legado; os campos retornados não existem mais em `organizations`, e o SQL gerado atualiza apenas `updated_at`.
- Não existe constraint para um único playbook ativo.
- Referências de mídia em JSONB podem ficar órfãs.
- O mesmo conteúdo Premium/Estratificada do playbook da Vitalli existe em
  `buildMediaClarificationClinicContext()` e pode ser acionado por outro tenant.
- A gratuidade da avaliação está embutida no template de depósito, embora a
  Ximendes tenha avaliação paga e o schema não relacione os dois conceitos.
- `isAesthetic` está configurável no tratamento, mas o runtime ainda decide por
  palavras no nome e usa critérios diferentes conforme o caminho.

## Snapshots

- `artifacts/config-audit/ximendes-config-snapshot.sanitized.json`
- `artifacts/config-audit/clinica-vitalli-config-snapshot.sanitized.json`
- `artifacts/config-audit/nc-beauty-clinic-config-snapshot.sanitized.json`

O exportador está em `scripts/audit-clinic-config.ts`. Ele:

- executa apenas `SELECT`;
- registra branch e commits de integração/produção;
- redige e-mail, telefone, CPF, CNPJ, credenciais, chaves Pix e URLs;
- não exporta URLs de assets/canais;
- usa o mesmo schema agora compartilhado por `develop` e `main`;
- inclui somente presença/contagem para endereço complementar, Maps, mensagem de
  localização e política/faixas de garantia.

## Recomendações

1. Corrigir dados ativos por fluxo humano, não por script automático.
2. Adicionar lint bloqueante de comando de fluxo em `notes`, com migração assistida.
3. Limpar os dois IDs órfãos do playbook ativo da Vitalli após confirmação visual.
4. Planejar unique index parcial para playbook ativo somente depois de auditoria global e fluxo transacional.
5. Remover dual-write/no-op legado em PR mecânico separado.
6. Não remover colunas legadas até medir zero leituras e concluir backfill de todas as versões necessárias.
7. Remover conteúdo clinic-specific do core e resolver a resposta pela mídia,
   pipeline e tratamento do tenant.
8. Modelar preço/abatimento de avaliação separadamente da política de depósito.
9. Fazer `Treatment.isAesthetic` ser o owner único da decisão em runtime.
