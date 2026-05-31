# Skill Maintenance

Use esta referencia quando uma execucao mostrar que a skill precisa ficar mais pratica.

## Update Loop

1. Registre a friccao observada: onde o agente hesitou, perguntou demais, poluiu a UI ou esqueceu um padrao.
2. Transforme a friccao em uma regra pequena e acionavel.
3. Coloque a regra no menor arquivo possivel:
   - `SKILL.md` para workflow essencial e gatilhos.
   - `references/design-patterns.md` para linguagem visual geral.
   - `references/playbook-editor-patterns.md` para setup de IA, playbook e simulador.
4. Remova duplicacao. A mesma regra nao deve viver em varios lugares.
5. Rode o validador da skill depois de editar.

## Writing Rules

- Escrever para outro agente executar, nao para humanos aprenderem teoria.
- Preferir comandos curtos: "Use", "Evite", "Mostre", "Agrupe".
- Incluir exemplos de UI apenas quando eles mudam a decisao pratica.
- Manter `SKILL.md` enxuto; mover detalhes para referencias.

## Folder Rules

- Nao criar README, changelog ou guias extras dentro da skill.
- Manter referencias em um nivel: `references/*.md`.
- Adicionar scripts somente quando houver operacao repetitiva e deterministica.
- Manter assets somente se forem usados diretamente na entrega.
