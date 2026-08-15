# Segurança do banco em ambiente de teste

> Motivado pelo achado do Ciclo A registrado em [`docs/ai-system/v1-freeze.md`](../ai-system/v1-freeze.md).
> Escrito no Ciclo B0, antes de qualquer mudança da V1.

## O comando canônico

```bash
npm run verify
```

É esse, e só esse, antes de push, PR, merge ou deploy. Ele roda **sem banco**: `db:check`, `lint`,
`typecheck` e `vitest run`. Nenhuma variável de ambiente é carregada de arquivo.

**Nunca** rode a verificação embrulhada em `dotenv`:

```bash
dotenv -e .env.local -- npx vitest run   # ERRADO — foi isso que produziu o resíduo
```

`.env.local` carrega a `DATABASE_URL` do banco compartilhado, o mesmo que guarda o histórico de
Vitalli, Ximendes, NC Beauty e Maycon. Embrulhar a suíte nesse arquivo transforma testes em
escrita de produção.

Para rodar de propósito os testes que escrevem em banco:

```bash
npm run test:db   # lê .env.test.local, nunca .env.local
```

## Causa raiz do incidente

A cadeia completa, em quatro elos:

1. **A pergunta errada.** `calendar-import.test.ts` era guardado por
   `describe.skipIf(!process.env.DATABASE_URL)`. Isso pergunta *"existe um banco?"*, nunca
   *"esse banco pode ser sujado?"*. Qualquer `DATABASE_URL` no processo — de `dotenv -e .env.local`
   ou de um `export` no shell — ligava a escrita.
2. **O banco alcançável era o compartilhado.** `.env.local` aponta para
   `ep-dawn-scene-acf6l8u5-pooler.sa-east-1.aws.neon.tech/neondb`, que não é uma branch de teste.
3. **A limpeza era parcial.** O `beforeAll` apagava `appointments` e `leads` da clínica fixa
   `demo-vitalli-test`, mas **não** `professionals` — e o último teste do arquivo insere dois
   (`Dr. Gregorie`, `Dr. Victor`) a cada execução.
4. **O `afterAll` não limpava nada, por escrito.** O corpo era um `console.log` sob o comentário
   *"Cleanup após testes (opcional — manter dados para inspecionar)"*.

O efeito é o teste falhando contra o próprio resíduo: `importCalendarEvents` resolve o
profissional com `findMany(where clinicId)` sem ordenação determinística, e com 8 cópias de
`Dr. Gregorie` a linha escolhida deixa de ser a que o teste acabou de inserir — daí o
`expected 'b3df789a…' to be '3f963948…'` observado no Ciclo A.

Ponto que importa para o programa V2: **a falha nunca apareceu no `verify` canônico**, porque sem
`DATABASE_URL` o bloco é pulado. Ela só aparece exatamente na forma de execução que causa o dano.

## O guardrail

Duas camadas, nenhuma dependente de alguém lembrar de algo.

### 1. Política declarativa — `src/infrastructure/db/test-database-policy.ts`

`resolveTestDatabaseAccess(env)` decide, sem I/O:

| Ambiente | Resultado |
| --- | --- |
| Sem `DATABASE_URL` | `unavailable` → testes de integração pulados (CI e `npm run verify`) |
| `DATABASE_URL` sem `TEST_DATABASE_HOST` | **lança** — o caso do incidente |
| Host da `DATABASE_URL` ≠ `TEST_DATABASE_HOST` | **lança** |
| Sem `PRODUCTION_DATABASE_HOST` | **lança** |
| `TEST_DATABASE_HOST` = `PRODUCTION_DATABASE_HOST` | **lança** |
| Tudo declarado e coerente | `authorized` |

A forma espelha `assertReplaySandboxEnvironment` de propósito: o repositório já resolvia
"esse banco é o certo?" comparando host declarado contra host da conexão. Escrever em banco durante
teste passa a exigir **duas declarações independentes** — qual host você quer sujar e qual host é
produção. Apontar teste para produção deixa de ser esquecimento e passa a exigir mentir duas vezes.

A mensagem de erro nunca inclui a `DATABASE_URL`, porque ela carrega a senha e o erro termina em
log de CI.

### 2. Aplicação estrutural — `src/infrastructure/db/client.ts`

`getDb()` chama a política quando `VITEST=true` ou `NODE_ENV=test`. Como esse é o único ponto por
onde todo acesso a banco real passa, a proteção vale para **testes que ainda não foram escritos**:
um teste futuro que importe `db` sem mock cai no guardrail sem precisar saber que ele existe.
Fora de teste o caminho é idêntico ao anterior — produção não muda.

Cobertura: `src/__tests__/TestDatabasePolicy.test.ts` (9 casos) e
`src/__tests__/TestDatabaseClientGuard.test.ts` (4 casos).

### 3. Isolamento do teste — `calendar-import.test.ts`

O tenant deixou de ser fixo. Cada execução cria `test-calendar-import-<8 hex>` e o `afterAll`
apaga, filtrando sempre pelo id daquela clínica, na ordem `appointments → leads → professionals →
organizations` (não há `ON DELETE CASCADE` nessas FKs). Um teste extra trava o contrato: se alguém
reintroduzir a clínica compartilhada fixa, ele acusa antes de o resíduo voltar a crescer.

## Testes que podem escrever em banco

Levantamento feito sobre os 279 arquivos de `src/__tests__/` em 15/08:

| Arquivo | Toca banco real? |
| --- | --- |
| `calendar-import.test.ts` | **Sim** — único. Agora sob a política, com tenant efêmero. |
| `ChannelHealthSnapshotCron.test.ts` | Não — `vi.mock("@/infrastructure/db/client")`. |
| Outros 26 arquivos que importam o cliente | Não — todos mockam o módulo. |
| Restante da suíte | Não — não alcança o cliente. |

Com a camada 2, essa tabela deixa de ser algo que precisa ser mantido à mão: qualquer arquivo novo
que alcance o cliente sem mock é barrado pela política.

## Resíduo existente — inventariado, **não** apagado

Medido em 15/08 por `SELECT` apenas. Nada foi removido.

Clínica `demo-vitalli-test` (`85511f61-af09-4340-b35e-0d8b4a447f0a`, `is_test = true`,
`operational_status = test`, criada em 08/07):

| Tabela | Linhas |
| --- | --- |
| `professionals` | **16** — 8 × `Dr. Gregorie`, 8 × `Dr. Victor` |
| `leads` | 9 |
| `appointments` | 9 |
| `conversations` | 0 |

As 16 linhas de `professionals` vêm de 8 execuções: uma em 09/07 e sete em 15/08 (entre 04:50 e
05:18, durante o diagnóstico do Ciclo A). `leads` e `appointments` não acumulavam — o `beforeAll`
antigo os apagava a cada run.

Tenants reais conferidos na mesma medição, todos intactos e batendo com a contagem do início do
programa:

| Clínica | `professionals` | `conversations` |
| --- | --- | --- |
| Clínica Vitalli | 2 | 1.030 |
| NC Beauty & Clinic | 3 | 160 |
| Ximendes Odontologia | 1 | 81 |
| Maycon bordados | 0 | 78 |

**Nenhuma linha foi apagada.** A limpeza das 16 duplicatas é decisão separada, do autor, e não é
pré-requisito de nada: a clínica é `is_test = true`, tem 0 conversas, nenhum tenant real a
referencia, e o teste não depende mais dela. Quando for feita, a distinção é trivial — *todas* as
linhas de `professionals` dessa clínica foram produzidas por teste; não há dado histórico útil ali.

## Configurando `.env.test.local`

```bash
DATABASE_URL="postgres://…@ep-<branch-de-teste>-pooler.sa-east-1.aws.neon.tech/neondb"
TEST_DATABASE_HOST="ep-<branch-de-teste>-pooler.sa-east-1.aws.neon.tech"
PRODUCTION_DATABASE_HOST="ep-dawn-scene-acf6l8u5-pooler.sa-east-1.aws.neon.tech"
```

A branch de teste sai do mesmo projeto Neon:

```bash
npx neonctl branches create --project-id "$NEON_PROJECT_ID" --name test-integration \
  --expires-at "$(date -u -v+1d +%Y-%m-%dT%H:%M:%SZ)" --output json
```

`--expires-at` é o que impede a branch de virar custo esquecido.
