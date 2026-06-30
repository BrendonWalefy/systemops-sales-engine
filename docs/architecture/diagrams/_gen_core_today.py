import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from matplotlib.lines import Line2D
from pathlib import Path

fig, ax = plt.subplots(figsize=(15, 9.5))
ax.set_xlim(0, 15)
ax.set_ylim(0, 9.5)
ax.axis("off")

C_STEP = "#2C3E50"
C_LLM  = "#8E44AD"
C_EXT  = "#16A085"
C_DATA = "#2980B9"
C_EDGE = "#34495e"
C_WARN = "#C0392B"

def box(x, y, w, h, title, sub, color, fs=11, text="white"):
    b = FancyBboxPatch((x-w/2, y-h/2), w, h,
                       boxstyle="round,pad=0.02,rounding_size=0.10",
                       linewidth=0, facecolor=color, zorder=3)
    ax.add_patch(b)
    ax.text(x, y+(0.16 if sub else 0), title, ha="center", va="center",
            fontsize=fs, fontweight="bold", color=text, zorder=4)
    if sub:
        ax.text(x, y-0.20, sub, ha="center", va="center",
                fontsize=8, color=text, alpha=0.95, zorder=4)

def arrow(p1, p2, color=C_EDGE, lw=2.0, style="-|>", rad=0.0):
    ax.add_patch(FancyArrowPatch(p1, p2, arrowstyle=style, mutation_scale=15,
                 lw=lw, color=color, zorder=2,
                 connectionstyle=f"arc3,rad={rad}"))

# Title
ax.text(7.5, 9.1, "Core Atual — runtime conversacional principal",
        ha="center", fontsize=18, fontweight="bold", color=C_STEP)
ax.text(7.5, 8.62, "Ingress fino + inbox de eventos + fila no Postgres + outbox de envio",
        ha="center", fontsize=11, color=C_DATA, fontweight="bold")

# Main container
cont = FancyBboxPatch((0.6, 1.5), 13.8, 6.4,
                      boxstyle="round,pad=0.02,rounding_size=0.15",
                      linewidth=2.5, edgecolor=C_DATA, facecolor="#EEF5FB",
                      zorder=1)
ax.add_patch(cont)
ax.text(1.0, 7.62, "Pipeline principal do lead: receive -> persist -> process -> enqueue -> send",
        ha="left", fontsize=9.5, style="italic", color=C_DATA, zorder=4)

# Entry
box(1.5, 8.0, 2.2, 0.8, "WhatsApp", "Z-API / Meta compat.", C_EDGE, fs=11)
arrow((1.5, 7.6), (1.5, 6.65), C_EDGE)

# Left column: ingress + event store
steps = [
    (2.6, 6.2, "Webhook fino", "valida + resolve tenant"),
    (2.6, 4.9, "inbound_events", "payload bruto + status"),
    (2.6, 3.6, "jobs", "queue = message.process"),
    (2.6, 2.3, "message-worker", "claim + retry + stale recovery"),
]
for (x, y, t, s) in steps:
    box(x, y, 2.8, 0.95, t, s, C_STEP, fs=10)
arrow((2.6, 5.72), (2.6, 5.38), C_EDGE)
arrow((2.6, 4.42), (2.6, 4.08), C_EDGE)
arrow((2.6, 3.12), (2.6, 2.78), C_EDGE)

# Middle column: orchestration
mid = [
    (6.2, 2.3, "ProcessMessageJob", "normaliza + policy + audio", C_STEP),
    (6.2, 3.6, "ConversationOrchestrator", "jornada principal", C_STEP),
    (6.2, 4.9, "IntentClassifier", "LLM 1 -> JSON", C_LLM),
    (6.2, 6.2, "Booking + Composer", "regras + LLM 2", C_STEP),
]
for (x, y, t, s, c) in mid:
    box(x, y, 3.0, 0.95, t, s, c, fs=10)
arrow((4.1, 2.3), (4.7, 2.3), C_EDGE)
arrow((6.2, 2.78), (6.2, 3.12), C_EDGE)
arrow((6.2, 4.08), (6.2, 4.42), C_EDGE)
arrow((6.2, 5.38), (6.2, 5.72), C_EDGE)

# Right column - outbox + send
box(10.0, 6.2, 3.0, 0.95, "outbound_messages", "sequence por conversa", C_DATA, fs=10)
box(10.0, 4.9, 3.0, 0.95, "jobs", "queue = message.send", C_STEP, fs=10)
box(10.0, 3.6, 3.0, 0.95, "sender-worker", "delivery + retry", C_STEP, fs=10)
arrow((7.7, 6.2), (8.5, 6.2), C_EDGE)
arrow((10.0, 5.72), (10.0, 5.38), C_EDGE)
arrow((10.0, 4.42), (10.0, 4.08), C_EDGE)

# exit
box(13.0, 3.6, 1.9, 0.9, "WhatsApp", "texto / audio / midia", C_EDGE, fs=10)
arrow((11.5, 3.6), (12.0, 3.6), C_EDGE)

# External dependencies
box(10.2, 2.2, 2.4, 0.95, "OpenAI / Whisper", "LLM + audio", C_LLM, fs=9.5)
box(12.9, 2.2, 2.0, 0.95, "Agenda", "internal + GCal", C_EXT, fs=9.5)
arrow((6.2, 1.83), (9.4, 2.0), C_LLM, rad=-0.15, style="<|-|>", lw=1.6)
arrow((7.0, 5.38), (12.2, 2.55), C_EXT, rad=-0.16, style="<|-|>", lw=1.6)

# Source of truth DB
box(4.4, 0.7, 3.2, 0.85, "Postgres (Drizzle)", "tenant + estado + inbox/outbox", C_DATA, fs=9.5)
for sx in (2.6, 6.2, 10.0):
    arrow((sx, 1.83), (4.4, 1.15), C_DATA, rad=0.0, style="-|>", lw=1.4)

# Note box bottom-right
ax.text(11.8, 0.75, "Excecoes atuais:\nfollow-up, reminder e recovery ainda enviam direto",
        ha="center", va="center", fontsize=8.8, color=C_WARN,
        fontweight="bold",
        bbox=dict(boxstyle="round,pad=0.4", fc="white", ec=C_WARN, lw=1.5))

# Legend
legend = [("Passo no request", C_STEP), ("LLM / voz", C_LLM),
          ("Integração externa", C_EXT), ("Dados", C_DATA)]
handles = [Line2D([0],[0], marker="s", color="w", markerfacecolor=c,
           markersize=12, label=l) for l, c in legend]
ax.legend(handles=handles, loc="upper right", ncol=1, frameon=False,
          fontsize=9, bbox_to_anchor=(0.99, 0.83))

OUT = Path(__file__).with_name("core-today.png")
plt.savefig(OUT, dpi=150, bbox_inches="tight", facecolor="white")
print("saved core-today")
