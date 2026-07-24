# Baseline da validação

Data: 24/07/2026  
Modo: descoberta read-only; sem alteração de comportamento, schema ou configuração.

## Isolamento

- Worktree: `/Users/brendonwalefy/Dev/Projetos/systemops-sales-engine-v1-v2-validation`
- Branch: `chore/conversation-engine-validation`
- Base obrigatória: `origin/develop@6f7d5706e9abbebfc0b3adc9434a0cf89c39f9f4`
- Produção auditada em paralelo, somente leitura: `origin/main@d8c0fd0c7602fe635601afeb0778b1f982301fc7`
- Worktree original de `main`: não alterado por esta auditoria.

## Divergência de branches

`origin/main` está 27 commits à frente de `origin/develop`; `develop` não possui commits exclusivos.

| Referência | Último commit | Migration journal | Orchestrator |
|---|---|---:|---:|
| `origin/develop` | `6f7d570` — PR #215 | `0077_material_blur` | 7.543 linhas |
| `origin/main` | `d8c0fd0` — PR #243 | `0085_previous_iron_patriot` | 8.222 linhas |

Consequência: `develop` foi mantido como base da branch por exigência do repositório, mas o parecer técnico usa `main` como verdade do runtime de produção. Nenhum patch deve começar antes de reconciliar oficialmente as branches.

## Pacote recebido

- Pasta lida: `/Users/brendonwalefy/Downloads/systemops-safe-v1-v2-handoff`
- 50 arquivos regulares verificados contra `SHA256SUMS.txt`
- ZIP original conferido contra o `.sha256`
- Segundo ZIP passou no teste de integridade e contém o mesmo payload, além de metadados `__MACOSX`
- `PROMPT-PARA-O-AGENT.md` é idêntico ao prompt mestre em `06-handoff-agent`

## Verificação do código

### Produção (`origin/main@d8c0fd0`)

Executado em worktree temporário destacado e removido após a verificação:

```text
npm run db:check   OK
npm run lint       OK, 7 warnings preexistentes e 0 erros
npm run typecheck  OK
npm test           197 arquivos aprovados
                   1.960 testes aprovados
                   10 testes ignorados
                   1.970 testes no total
```

### Integração (`origin/develop@6f7d570`)

```text
npm run verify     OK
npm run db:check   OK
npm run lint       OK, 7 warnings preexistentes e 0 erros
npm run typecheck  OK
npm test           176 arquivos aprovados
                   1.634 testes aprovados
                   10 testes ignorados
                   1.644 testes no total
```

O pacote antigo registrava impossibilidade de typecheck; essa limitação não existe nas duas referências atuais.

## Banco

- Acesso somente leitura usando a configuração local já existente.
- Clínicas amostradas: Ximendes, Clínica Vitalli e NC Beauty Clinic.
- Nenhuma seed, migration, `UPDATE`, `INSERT`, `DELETE` ou script `apply-*` foi executado.
- Snapshots exportados com credenciais, chaves Pix, telefones, e-mails, documentos e URLs redigidos.
- Campos aditivos existentes apenas no schema de produção foram lidos por presença/contagem, sem exportar seu texto sensível.

## Sinal fora do escopo

`npm ci` reportou 15 vulnerabilidades de dependências (1 baixa, 4 moderadas, 8 altas e 2 críticas). `npm run verify` não inclui `npm audit`. Este sinal deve ir para uma trilha de segurança separada; não foi usado para ampliar o escopo desta auditoria.
