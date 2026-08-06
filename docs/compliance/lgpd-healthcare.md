# LGPD e dados de saúde

Requisitos mínimos para produto e operação; validação jurídica formal continua necessária.

## Princípios

- coletar somente dados necessários ao atendimento;
- resolver tenant e autorização antes de acessar dados;
- criptografar credenciais em repouso e nunca enviá-las ao browser;
- evitar diagnóstico, prescrição ou orientação clínica individualizada por IA;
- registrar base legal/consentimento quando aplicável;
- aplicar retenção e exclusão por finalidade;
- manter auditoria de ações sem copiar conteúdo sensível para logs;
- usar apenas datasets sanitizados, revisados e armazenados fora do Git;
- oferecer purge por organização e testar cobertura de novas FKs.

## Handoff obrigatório

O sistema encaminha para humano quando há sintoma, urgência, pedido de diagnóstico/prescrição, orientação clínica individual, reclamação sensível, negociação fora da política ou solicitação explícita de profissional.

## Observabilidade

Decision Trace guarda metadados allowlisted, não mensagens, prompts, respostas, nomes, telefones ou URLs. Sentry e logs devem receber somente contexto sanitizado.

## Conteúdo proibido no repositório

- conversas, telefones, nomes e emails de leads;
- snapshots de configuração de clientes;
- credenciais, tokens e URLs privadas;
- imagens, vídeos ou documentos enviados por clientes;
- exportações de banco, mesmo marcadas como “sanitizadas”, sem processo formal de revisão.

Fixtures, demos e testes devem usar somente organizações, pessoas, contatos,
endereços e agendas fictícios. Scripts pontuais com dados de clientes não são
artefatos de produto e devem permanecer fora do Git. Remover um arquivo da árvore
atual não o elimina do histórico: qualquer incidente anterior exige rotação de
credenciais e uma reescrita coordenada do histórico antes de compartilhar o
repositório como data room.
