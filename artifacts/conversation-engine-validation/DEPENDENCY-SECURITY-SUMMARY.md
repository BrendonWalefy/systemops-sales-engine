# Resumo de segurança de dependências

Data da consulta: 24/07/2026
Base: `origin/develop == origin/main == d8c0fd0`

## Resultado

O sinal de vulnerabilidades do pacote é real, mas é uma trilha separada dos
erros de arquitetura conversacional.

`npm audit --omit=dev --json` encontrou, na árvore de produção:

| Severidade | Quantidade de pacotes reportados |
|---|---:|
| Crítica | 1 |
| Alta | 5 |
| Moderada | 0 |
| Baixa | 1 |
| Total | 7 |

O audit completo, incluindo desenvolvimento, reportou 15 pacotes: 2 críticos, 8
altos, 4 moderados e 1 baixo.

## Prioridade

### SEC-01 — Next.js direto e em uso

- instalado: `next@16.2.6`;
- advisories atuais incluem bypass de middleware/proxy, DoS e SSRF;
- `npm audit` informa correção disponível;
- o projeto usa App Router, Server Actions e `src/proxy.ts`, portanto não é
  prudente classificar os advisories como irrelevantes sem uma análise de
  alcançabilidade por rota.

**Ação:** PR de dependência isolada para atualizar Next dentro da linha suportada,
seguida de `npm run verify`, smoke de login/proxy, Server Actions, upload/imagem,
webhooks e deploy preview.

### SEC-02 — `@auth/core` direto, crítico, aparentemente não utilizado

- instalado: `@auth/core@0.40.0`;
- pacote declara vulnerabilidades de normalização de e-mail, cookies
  OAuth/PKCE e malformed Bearer;
- a busca no código encontrou a dependência apenas em `package.json`, sem import
  em `src`;
- autenticação atual usa o token próprio de `src/lib/session` e `src/proxy.ts`.

**Ação:** confirmar também build/runtime e remover a dependência não utilizada em
PR pequeno. Se houver consumo fora da árvore pesquisada, atualizar para a versão
corrigida e testar o fluxo correspondente.

### SEC-03 — Tooling de desenvolvimento

- `vitest@3.2.4` é reportado como crítico quando o servidor Vitest UI fica
  exposto;
- há correção patch disponível;
- o risco não equivale a uma exploração do runtime Vercel, mas a dependência
  deve ser atualizada.

### SEC-04 — Transitivas

`postcss`, `sharp`, `undici`, `fast-uri` e `@babel/core` aparecem como
transitivas. Parte deve desaparecer ao atualizar dependências diretas. Executar
nova auditoria depois de cada upgrade e investigar somente o restante.

## Guardrails

- Não executar `npm audit fix --force` automaticamente.
- O próprio audit sugere, em uma cadeia de tooling, uma versão antiga de
  `drizzle-kit`; aceitar isso cegamente pode causar downgrade e incompatibilidade.
- Separar Next, auth não utilizado e tooling em commits/PRs reversíveis.
- Não misturar upgrade de framework com correções do Conversation Engine.
- Reexecutar `npm audit --omit=dev`, `npm run verify` e QA de autenticação após
  cada mudança.

## Veredito

Há vulnerabilidades de dependência confirmadas na árvore instalada. Isso não
prova que todas sejam exploráveis nesta aplicação, mas Next é direto e usado,
enquanto `@auth/core` parece ser uma dependência direta desnecessária que mantém
um crítico na árvore. A remediação deve ser priorizada em trilha própria, sem
upgrade automático em massa.
