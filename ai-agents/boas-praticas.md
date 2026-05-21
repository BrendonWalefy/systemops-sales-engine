# Boas Práticas Para Agentes de IA

## 1. Prompts Devem Ser Versionados

Prompts são parte do produto.

Cada agente deve ter:

- prompt de sistema;
- instruções de negócio;
- schema de resposta;
- exemplos;
- casos de avaliação.

Não deixar prompt crítico escondido no código.

## 2. Usar Saída Estruturada

Sempre que possível, agentes devem responder em formato estruturado.

Exemplo:

```json
{
  "classification": "lead_quente",
  "suggested_reply": "...",
  "next_action": "agendar",
  "handoff_required": false,
  "risk_flags": []
}
```

Isso facilita:

- auditoria;
- UI;
- métricas;
- testes;
- evolução.

## 3. Separar Geração de Decisão

O agente pode sugerir uma resposta, mas o sistema deve decidir se pode enviar automaticamente.

Exemplo:

- Agente sugere mensagem.
- Motor de regras verifica se há risco.
- Se risco baixo, pode ir para aprovação ou envio.
- Se risco alto, chama humano.

## 4. Criar Guardrails de Saúde

O agente deve evitar:

- diagnóstico;
- prescrição;
- promessa de resultado;
- aconselhamento médico individual;
- urgência clínica sem encaminhamento;
- uso indevido de dados pessoais.

Resposta segura:

> Para te orientar com segurança, o ideal é uma avaliação com a doutora. Posso te ajudar a agendar?

## 5. Registrar Tudo

Cada recomendação deve salvar:

- contexto usado;
- prompt/versionamento;
- resposta gerada;
- decisão humana;
- mensagem enviada;
- resultado.

Sem histórico, não existe melhoria real.

## 6. Avaliar Com Casos Reais

Criar uma base de casos:

- lead perguntando preço;
- lead comparando clínica;
- lead com medo;
- lead sem resposta há 2 dias;
- paciente antigo para reativação;
- lead irritado;
- dúvida clínica sensível.

Cada caso deve ter comportamento esperado.

## 7. Começar Com Humano No Loop

No início:

- IA sugere;
- humano aprova;
- sistema aprende com aprovação/rejeição.

Isso cria confiança e reduz risco.

## 8. Métricas Antes de Autonomia

Só automatizar quando houver evidência:

- alta taxa de aprovação das sugestões;
- baixa taxa de correção humana;
- bons resultados de agendamento;
- poucos casos de risco;
- handoff funcionando.

