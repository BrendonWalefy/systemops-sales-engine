# Arquitetura de IA e Agentes

Este diretório organiza como a SystemOps deve pensar, projetar e evoluir agentes de IA dentro do produto.

O objetivo não é "colocar IA" no sistema. O objetivo é construir agentes que aumentem conversão, recuperem oportunidades e ajudem clínicas a transformar leads em consultas agendadas com qualidade, segurança e previsibilidade.

## Princípios

1. **IA precisa estar ligada a resultado comercial**
   Cada agente deve melhorar uma métrica clara: resposta, agendamento, follow-up, recuperação, conversão ou ROI.

2. **Começar como copiloto antes de virar autônomo**
   No início, o agente sugere respostas e próximas ações. A equipe humana aprova. Depois, com dados e confiança, algumas tarefas podem ser automatizadas.

3. **Agente não faz diagnóstico clínico**
   O agente pode orientar, acolher, qualificar e encaminhar. Ele não deve diagnosticar, prometer resultado médico, prescrever ou substituir avaliação profissional.

4. **Contexto vale mais que prompt bonito**
   O agente precisa conhecer a clínica, tratamentos, tom de voz, objeções, regras comerciais, agenda, status do lead e histórico da conversa.

5. **Handoff humano é parte do produto**
   Toda conversa precisa ter critérios claros para acionar a equipe: dúvida clínica sensível, negociação fora da regra, cliente irritado, pedido específico ou alta intenção de compra.

6. **Medir antes de otimizar**
   Toda recomendação do agente deve ser rastreável: o que sugeriu, quem aprovou, qual resposta foi enviada e qual resultado aconteceu.

## Documentos

- [contextos.md](./contextos.md): contextos necessários para agentes funcionarem bem.
- [estrutura-de-pastas.md](./estrutura-de-pastas.md): sugestão de organização do futuro app.
- [agente-vendas.md](./agente-vendas.md): desenho inicial do agente especialista em vendas.
- [boas-praticas.md](./boas-praticas.md): boas práticas para prompts, segurança, memória e avaliação.
- [avaliacao-e-metricas.md](./avaliacao-e-metricas.md): como medir qualidade e impacto dos agentes.

