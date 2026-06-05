# omniQA — Integração com o Sandbox de Simulação

Este documento descreve como o agente omniQA deve usar o endpoint `/api/playbook/simulate` do SystemOps Core para testar conversas de IA sem depender do webhook Z-API ou de qualquer outra integração de baixo nível.

---

## Por que usar este endpoint

O `/api/playbook/simulate` é o pipeline de produção completo (IntentClassifier → ResponseComposer) sem a camada de entrega (Z-API). Isso significa:

- O que o omniQA vê aqui **é exatamente o que o lead recebe no WhatsApp**
- Não há estado persistido entre chamadas — cada conversa é stateless no sandbox
- Com `QA_GOOGLE_CALENDAR_ID` configurado, os slots de agendamento são reais (Google Calendar de QA)
- Sem `QA_GOOGLE_CALENDAR_ID`, os slots são simulados com datas realistas

Para validar webhook, estado persistido, dedupe, pausa humana, envio Z-API e
agenda interna com banco real, use tambem o modo
[omniQA WhatsApp real](omniqa-real-whatsapp.md). O simulate nao substitui esse
teste em regressões de produção.

---

## Autenticação

```
Header: X-Simulate-Key: <SIMULATE_API_KEY>
```

O valor de `SIMULATE_API_KEY` é configurado no ambiente do SystemOps. Se a variável não estiver definida no servidor, o endpoint aceita qualquer requisição (modo dev local).

---

## Endpoint

```
POST https://<systemops-host>/api/playbook/simulate
Content-Type: application/json
X-Simulate-Key: <SIMULATE_API_KEY>
```

---

## Request

```typescript
{
  // Última mensagem enviada pelo lead
  "message": string,

  // Histórico completo da conversa ATÉ (não incluindo) a mensagem atual.
  // Deve incluir o campo `intent` nas mensagens do assistente —
  // ele é usado para detectar estado de oferta de slots pendente.
  "history": Array<{
    "role": "user" | "assistant",
    "text": string,
    "intent"?: string   // obrigatório nas mensagens do assistente
  }>,

  // Configuração do playbook da clínica sendo testada
  "playbook": {
    "specialty": string,
    "procedureDescription": string,
    "toneOfVoice": "acolhedor" | "tecnico" | "persuasivo" | "luxo",
    "differentials": string[],
    "commercialPolicy": string,
    "greetingMessage": string,
    "objections"?: Array<{
      "objection": string,
      "response": string
    }>
  }
}
```

---

## Response

```typescript
{
  "text": string,    // Texto da resposta gerada pela IA
  "intent": string   // Intent detectado (ver lista abaixo)
}
```

Em caso de erro:
```typescript
{ "error": string }  // status 400 ou 500
```

---

## Intents possíveis

| Intent | Quando ocorre |
|---|---|
| `greeting` | Primeiro contato, reinício de conversa, "menu", saudações isoladas |
| `acknowledgment` | "ok", "entendi", "blz", "oi" mid-conversa com histórico |
| `farewell` | "obrigado tchau", "até mais", encerramento |
| `price_inquiry` | Perguntas sobre preço, valor, plano |
| `book_appointment` | Quer agendar (sem data/hora específica) |
| `check_availability` | Pergunta por horários disponíveis |
| `confirm_slot` | Escolheu um dos slots oferecidos (pelo número ou confirmação) |
| `reject_slots` | Não quer nenhum dos slots oferecidos |
| `cancel_appointment` | Quer cancelar agendamento |
| `reschedule_appointment` | Quer remarcar |
| `list_appointments` | Quer ver seus agendamentos |
| `general_question` | Pergunta geral sobre a clínica |
| `clinical_urgency` | Menciona dor, urgência, emergência |
| `needs_human` | Pede falar com dentista, fotos, condição especial |
| `unclear` | Mensagem ambígua sem conteúdo de negócio claro |

---

## Como construir uma conversa

Cada chamada representa uma única troca. O omniQA deve acumular o histórico manualmente entre as chamadas:

```python
history = []

def send(message, playbook):
    body = {
        "message": message,
        "history": history,
        "playbook": playbook
    }
    response = requests.post(URL, json=body, headers={"X-Simulate-Key": KEY})
    data = response.json()

    # Adiciona a mensagem do usuário e a resposta ao histórico
    history.append({"role": "user", "text": message})
    history.append({"role": "assistant", "text": data["text"], "intent": data["intent"]})

    return data
```

**Importante:** incluir sempre o campo `intent` nas mensagens do assistente ao montar o histórico. Ele é usado internamente para detectar se há uma oferta de slots pendente e evitar classificações incorretas.

---

## Comportamentos especiais (sem chamada LLM)

Estes casos são resolvidos antes do LLM e retornam imediatamente:

| Mensagem | Comportamento | Intent retornado |
|---|---|---|
| Primeira mensagem (history vazio) | Retorna `greetingMessage` configurado | `greeting` |
| `menu`, `ver menu`, `voltar ao menu`... | Retorna `greetingMessage` (sem saudação temporal) | `greeting` |
| `oi`, `olá`, `bom dia`... (sem slots pendentes) | Retorna saudação temporal + `greetingMessage` | `greeting` |
| `/reset` ou `reset` | Reinicia conversa com saudação + menu | `greeting` |

---

## Exemplo completo — Cenário: agendamento

```python
import requests

BASE_URL = "https://systemops.vercel.app"
KEY = "<SIMULATE_API_KEY>"

playbook = {
    "specialty": "Odontologia",
    "procedureDescription": "Avaliação odontológica completa com Raio-X",
    "toneOfVoice": "acolhedor",
    "differentials": ["Atendimento no mesmo dia", "Parcelamento em até 12x"],
    "commercialPolicy": "Avaliação gratuita na primeira consulta",
    "greetingMessage": "Olá! Sou a recepcionista virtual da Clínica X. Como posso ajudar?\n\n1. Procedimentos\n2. Agendar horário\n3. Formas de pagamento\n4. Localização\n5. Falar com especialista",
    "objections": [
        {"objection": "Está muito caro", "response": "Temos parcelamento em até 12x sem juros e avaliação gratuita."}
    ]
}

history = []

def send(message):
    res = requests.post(
        f"{BASE_URL}/api/playbook/simulate",
        json={"message": message, "history": history, "playbook": playbook},
        headers={"X-Simulate-Key": KEY, "Content-Type": "application/json"}
    )
    data = res.json()
    history.append({"role": "user", "text": message})
    history.append({"role": "assistant", "text": data["text"], "intent": data["intent"]})
    return data

# Passo 1: saudação (retorna greetingMessage diretamente, sem LLM)
r = send("oi")
assert r["intent"] == "greeting"

# Passo 2: intenção de agendar
r = send("quero agendar uma consulta")
assert r["intent"] == "book_appointment"
# r["text"] contém os slots disponíveis (reais se QA_GOOGLE_CALENDAR_ID configurado)

# Passo 3: confirmar o primeiro slot
r = send("1")
assert r["intent"] == "confirm_slot"

# Passo 4: encerramento
r = send("obrigado tchau")
assert r["intent"] == "farewell"

print("✅ Cenário de agendamento passou")
```

---

## Validação de intent

Para cada step do script de teste, valide que o `intent` retornado bate com o esperado:

```python
def assert_intent(message, expected_intent, context=""):
    r = send(message)
    actual = r["intent"]
    if actual != expected_intent:
        print(f"❌ [{context}] '{message}' → esperado: {expected_intent}, recebido: {actual}")
        print(f"   Resposta: {r['text'][:100]}")
        return False
    print(f"✅ [{context}] '{message}' → {actual}")
    return True
```

---

## Slots de agendamento

- **Com `QA_GOOGLE_CALENDAR_ID`**: os slots retornados são horários reais do Google Calendar de QA, respeitando horário de funcionamento e eventos existentes. Ideal para testar conflitos de agenda e disponibilidade real.
- **Sem `QA_GOOGLE_CALENDAR_ID`**: slots simulados com datas a partir de amanhã, sequenciais. Suficiente para testar o fluxo de classificação.

Os slots são retornados no texto da resposta (gerado pelo LLM), não em um campo estruturado separado. Para extrair os slots do texto (para escolher um numerado no próximo step), use o número na mensagem seguinte ("1", "2", "3").

---

## Reset entre cenários

Para iniciar um novo cenário do zero:

```python
history.clear()
# Próxima chamada com history vazio → retorna greetingMessage automaticamente
```

Ou mid-conversa:

```python
r = send("reset")
assert r["intent"] == "greeting"
# Conversa reiniciada com saudação temporal + greetingMessage
```

---

## Configuração de ambiente necessária

No SystemOps Core (Vercel ou `.env.local`):

```bash
SIMULATE_API_KEY="<gere-uma-chave-segura>"
QA_GOOGLE_CALENDAR_ID="<id-do-calendario-de-testes>"   # opcional mas recomendado
```

A `SIMULATE_API_KEY` deve ser a mesma nos dois lados (SystemOps e omniQA).
