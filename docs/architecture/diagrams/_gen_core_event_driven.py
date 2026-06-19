import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from matplotlib.lines import Line2D

fig, ax = plt.subplots(figsize=(16, 9))
ax.set_xlim(0, 16)
ax.set_ylim(0, 9)
ax.axis("off")

C_EDGE  = "#34495e"
C_INGR  = "#2C3E50"
C_QUEUE = "#E67E22"
C_WORK  = "#27AE60"
C_DATA  = "#2980B9"
C_LLM   = "#8E44AD"
C_OBS   = "#7F8C8D"

def box(x, y, w, h, title, sub, color, fs=11, text="white"):
    ax.add_patch(FancyBboxPatch((x-w/2, y-h/2), w, h,
        boxstyle="round,pad=0.02,rounding_size=0.10",
        linewidth=0, facecolor=color, zorder=3))
    ax.text(x, y+(0.17 if sub else 0), title, ha="center", va="center",
            fontsize=fs, fontweight="bold", color=text, zorder=4)
    if sub:
        ax.text(x, y-0.21, sub, ha="center", va="center",
                fontsize=8, color=text, alpha=0.95, zorder=4)

def cyl(x, y, w, h, title, sub, color):
    ax.add_patch(FancyBboxPatch((x-w/2, y-h/2), w, h,
        boxstyle="round,pad=0.02,rounding_size=0.30",
        linewidth=0, facecolor=color, zorder=3))
    ax.text(x, y+0.16, title, ha="center", va="center",
            fontsize=10, fontweight="bold", color="white", zorder=4)
    ax.text(x, y-0.20, sub, ha="center", va="center",
            fontsize=7.8, color="white", alpha=0.95, zorder=4)

def arrow(p1, p2, color=C_EDGE, lw=2.2, style="-|>", rad=0.0):
    ax.add_patch(FancyArrowPatch(p1, p2, arrowstyle=style, mutation_scale=16,
                 lw=lw, color=color, zorder=2,
                 connectionstyle=f"arc3,rad={rad}"))

ax.text(8.0, 8.6, "Core FUTURO — orientado a eventos",
        ha="center", fontsize=18, fontweight="bold", color=C_INGR)
ax.text(8.0, 8.15,
        "webhook fino · fila durável · workers dedicados · inbox/outbox · ordem por conversa",
        ha="center", fontsize=10.5, color=C_WORK, fontweight="bold")

ymain = 5.6
# Ingress
box(1.5, ymain, 2.2, 1.0, "Z-API / Meta", "WhatsApp", C_EDGE, fs=10)
box(4.0, ymain, 2.2, 1.1, "Ingress API", "webhook fino\n200 OK rápido", C_INGR, fs=10)
arrow((2.6, ymain), (2.9, ymain))

# inbound_events (inbox pattern)
cyl(6.4, ymain, 2.2, 1.0, "inbound_events", "inbox · replay", C_DATA)
arrow((5.1, ymain), (5.3, ymain))

# queue message.process
box(8.8, ymain, 2.2, 1.1, "Fila durável", "message.process\n(FIFO por conversa)", C_QUEUE, fs=10)
arrow((7.5, ymain), (7.7, ymain))

# conversation worker
box(11.6, ymain, 2.6, 1.3, "Conversation Worker", "dedupe · estado\nLLM in/out · agenda", C_WORK, fs=10.5)
arrow((9.9, ymain), (10.3, ymain))

# outbox
cyl(11.6, 3.3, 2.6, 1.0, "outbound_messages", "outbox · intenção de envio", C_DATA)
arrow((11.6, ymain-0.65), (11.6, 3.8), C_DATA)

# queue message.send
box(8.8, 3.3, 2.2, 1.1, "Fila durável", "message.send", C_QUEUE, fs=10)
arrow((10.3, 3.3), (9.9, 3.3), C_QUEUE)

# sender worker
box(6.0, 3.3, 2.4, 1.1, "Sender Worker", "entrega + retry\nprovider_message_id", C_WORK, fs=10)
arrow((7.7, 3.3), (7.2, 3.3), C_QUEUE)

# back to channel
box(2.8, 3.3, 2.2, 1.0, "Canal WhatsApp", "texto/mídia/áudio", C_EDGE, fs=10)
arrow((4.8, 3.3), (3.9, 3.3))

# Worker side deps
box(14.2, 7.4, 2.8, 1.0, "OpenAI / Whisper / TTS", "intent · resposta · voz", C_LLM, fs=9.5)
box(14.6, 3.3, 2.6, 1.0, "Postgres + S3/Blob", "estado · mídia", C_DATA, fs=9.5)
arrow((12.4, 6.2), (13.4, 7.0), C_LLM, style="<|-|>", rad=0.05, lw=1.7)
arrow((12.9, 5.4), (13.6, 3.7), C_DATA, style="<|-|>", rad=0.1, lw=1.7)

# Scheduler -> followup queue -> conversation worker
box(8.8, 7.4, 2.4, 1.0, "Scheduler", "EventBridge / cron", C_INGR, fs=10)
box(11.6, 7.4, 2.0, 1.0, "followup\n.dispatch", "fila", C_QUEUE, fs=9.5)
arrow((10.0, 7.4), (10.6, 7.4), C_QUEUE)
arrow((11.6, 6.9), (11.6, 6.25), C_QUEUE, rad=0.0)

# Observability bus (bottom)
box(8.0, 1.2, 11.0, 0.9, "Observabilidade — traceId · conversationId · status por etapa (recebido→enfileirado→processado→enviado)",
    None, C_OBS, fs=10)
for sx in (4.0, 8.8, 11.6, 6.0):
    arrow((sx, 2.65 if sx in (6.0,8.8,11.6) else 5.05), (sx, 1.66),
          C_OBS, lw=1.2, style="-|>", rad=0.0)

# legend
legend = [("Borda / canal", C_EDGE), ("Ingress", C_INGR), ("Fila durável", C_QUEUE),
          ("Worker", C_WORK), ("Dados (inbox/outbox/store)", C_DATA),
          ("LLM / voz", C_LLM), ("Observabilidade", C_OBS)]
handles = [Line2D([0],[0], marker="s", color="w", markerfacecolor=c,
           markersize=11, label=l) for l, c in legend]
ax.legend(handles=handles, loc="lower center", ncol=4, frameon=False,
          fontsize=8.8, bbox_to_anchor=(0.5, -0.04))

# stack hint
ax.text(0.3, 7.7, "Mapa de fila:\n• simples: pg-boss\n• AWS: SQS FIFO + DLQ",
        ha="left", va="top", fontsize=9, color=C_QUEUE, fontweight="bold",
        bbox=dict(boxstyle="round,pad=0.4", fc="white", ec=C_QUEUE, lw=1.4))

plt.savefig("/home/user/systemops-core/docs/architecture/diagrams/core-event-driven.png",
            dpi=150, bbox_inches="tight", facecolor="white")
print("saved core-event-driven")
