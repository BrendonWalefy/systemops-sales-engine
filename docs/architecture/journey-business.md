# Jornada do Lead

Versão enxuta para conversa com operação, clínica e negócio.

```mermaid
flowchart TD
    A["Lead manda mensagem no WhatsApp"] --> B["SystemOps recebe a mensagem"]
    B --> C{"É uma mensagem válida?"}
    C -->|Não| X["Fim silencioso"]
    C -->|Sim| D["Sistema identifica a clínica e salva a entrada"]
    D --> E{"É foto, vídeo ou documento?"}
    E -->|Sim| F["Encaminha para a equipe<br/>avisa o lead<br/>pausa a IA"]
    E -->|Não| G{"IA pode responder agora?"}
    G -->|Não| H["Não responde<br/>avisa o operador"]
    G -->|Sim| I["Entende o que o lead quer"]
    I --> J["Decide a ação certa"]
    J --> K["Escreve a resposta"]
    K --> L{"Formato de saída"}
    L -->|Texto| M["Envia mensagem"]
    L -->|Áudio| N["Gera TTS e envia áudio"]
    L -->|Texto com mídia| O["Envia texto e mídia na ordem"]
    M --> P["Atualiza histórico e alertas"]
    N --> P
    O --> P
```

## Leitura rápida

- O lead entra pelo WhatsApp.
- O sistema valida a mensagem e identifica de qual clínica ela é.
- Se for mídia visual, a equipe humana assume.
- Se for uma conversa normal, a IA entende a intenção e executa a ação correta.
- Depois a resposta sai em texto, áudio ou texto com mídia.
- No fim, o histórico e os alertas internos são atualizados.

## Decisões de negócio mais importantes

- A clínica pode desligar a IA.
- A clínica pode escolher se responde em texto ou voz.
- A clínica pode definir quando a IA pausa e quando retoma.
- A clínica pode decidir para quem enviar mídia recebida do lead.
