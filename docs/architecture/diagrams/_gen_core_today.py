import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle
from matplotlib.lines import Line2D

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
ax.text(7.5, 9.1, "Core HOJE — tudo síncrono dentro do webhook",
        ha="center", fontsize=18, fontweight="bold", color=C_STEP)
ax.text(7.5, 8.62, "1 request HTTP faz a jornada inteira · sem fila · sem worker · sem outbox",
        ha="center", fontsize=11, color=C_WARN, fontweight="bold")

# Big synchronous container
cont = FancyBboxPatch((0.6, 1.5), 13.8, 6.4,
                      boxstyle="round,pad=0.02,rounding_size=0.15",
                      linewidth=2.5, edgecolor=C_WARN, facecolor="#FBEEEC",
                      zorder=1)
ax.add_patch(cont)
ax.text(1.0, 7.62, "POST /api/whatsapp/zapi  —  bloqueia até terminar (risco de timeout)",
        ha="left", fontsize=9.5, style="italic", color=C_WARN, zorder=4)

# Entry / exit outside-ish
box(1.7, 8.0, 2.0, 0.8, "Z-API", "WhatsApp in", C_EDGE, fs=11)
arrow((1.7, 7.6), (1.7, 6.55), C_EDGE)

# Sequential steps inside (single column flow, snaking)
steps = [
    (2.6, 6.2, "Filtro + dedupe", "grupo/echo/duplicata"),
    (2.6, 4.9, "RegisterIncoming", "salva lead + msg"),
    (2.6, 3.6, "State machine", "conversation_states"),
    (2.6, 2.3, "Debounce + rate limit", "espera burst inline"),
]
for (x, y, t, s) in steps:
    box(x, y, 2.8, 0.95, t, s, C_STEP, fs=10)
arrow((2.6, 5.72), (2.6, 5.38), C_EDGE)
arrow((2.6, 4.42), (2.6, 4.08), C_EDGE)
arrow((2.6, 3.12), (2.6, 2.78), C_EDGE)

# middle column
mid = [
    (6.2, 2.3, "IntentClassifier", "LLM 1 — entende", C_LLM),
    (6.2, 3.6, "Dispatch determinístico", "regras por intent", C_STEP),
    (6.2, 4.9, "BookingService", "saga reserva", C_STEP),
    (6.2, 6.2, "ResponseComposer", "LLM 2 — verbaliza", C_LLM),
]
for (x, y, t, s, c) in mid:
    box(x, y, 3.0, 0.95, t, s, c, fs=10)
arrow((4.1, 2.3), (4.7, 2.3), C_EDGE)          # debounce -> intent
arrow((6.2, 2.78), (6.2, 3.12), C_EDGE)
arrow((6.2, 4.08), (6.2, 4.42), C_EDGE)
arrow((6.2, 5.38), (6.2, 5.72), C_EDGE)

# right column - send
box(10.0, 6.2, 3.0, 0.95, "TTS (opcional)", "OpenAI/Google/Kokoro", C_LLM, fs=10)
box(10.0, 4.9, 3.0, 0.95, "send via Z-API", "texto / áudio / mídia", C_EDGE, fs=10)
box(10.0, 3.6, 3.0, 0.95, "Push + custo", "alertas, tracking", C_STEP, fs=10)
arrow((7.7, 6.2), (8.5, 6.2), C_EDGE)
arrow((10.0, 5.72), (10.0, 5.38), C_EDGE)
arrow((10.0, 4.42), (10.0, 4.08), C_EDGE)

# exit
box(13.0, 4.9, 1.6, 0.9, "WhatsApp", "out", C_EDGE, fs=10)
arrow((11.5, 4.9), (12.2, 4.9), C_EDGE)

# External dependencies called inline (right side, outside container as "external")
box(10.2, 2.2, 2.4, 0.95, "OpenAI / Whisper", "LLM + áudio", C_LLM, fs=9.5)
box(12.9, 2.2, 2.0, 0.95, "Google Cal.", "opt-in", C_EXT, fs=9.5)
arrow((6.2, 1.83), (9.4, 2.0), C_LLM, rad=-0.15, style="<|-|>", lw=1.6)
arrow((7.0, 4.42), (12.2, 2.55), C_EXT, rad=-0.2, style="<|-|>", lw=1.6)

# Source of truth DB
box(4.4, 0.7, 3.0, 0.85, "Postgres (Drizzle)", "source of truth + estado", C_DATA, fs=9.5)
for sx in (2.6, 6.2):
    arrow((sx, 1.83), (4.4, 1.15), C_DATA, rad=0.0, style="-|>", lw=1.4)

# Note box bottom-right
ax.text(11.8, 0.75, "Sem SQS · sem pg-boss\nsem worker dedicado",
        ha="center", va="center", fontsize=9.5, color=C_WARN,
        fontweight="bold",
        bbox=dict(boxstyle="round,pad=0.4", fc="white", ec=C_WARN, lw=1.5))

# Legend
legend = [("Passo no request", C_STEP), ("LLM / voz", C_LLM),
          ("Integração externa", C_EXT), ("Dados", C_DATA)]
handles = [Line2D([0],[0], marker="s", color="w", markerfacecolor=c,
           markersize=12, label=l) for l, c in legend]
ax.legend(handles=handles, loc="upper right", ncol=1, frameon=False,
          fontsize=9, bbox_to_anchor=(0.99, 0.83))

plt.savefig("/home/user/systemops-core/docs/architecture/diagrams/core-today.png",
            dpi=150, bbox_inches="tight", facecolor="white")
print("saved core-today")
