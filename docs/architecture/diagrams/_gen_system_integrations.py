import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from matplotlib.lines import Line2D

fig, ax = plt.subplots(figsize=(15, 9))
ax.set_xlim(0, 15)
ax.set_ylim(0, 9)
ax.axis("off")

COL = {
    "lead":   "#25D366",
    "edge":   "#34495e",
    "core":   "#2C3E50",
    "ai":     "#8E44AD",
    "data":   "#2980B9",
    "ext":    "#16A085",
    "out":    "#E67E22",
}

def box(x, y, w, h, title, sub, color, text="white", fs=12):
    b = FancyBboxPatch((x - w/2, y - h/2), w, h,
                       boxstyle="round,pad=0.02,rounding_size=0.12",
                       linewidth=0, facecolor=color, zorder=2)
    ax.add_patch(b)
    ax.text(x, y + (0.13 if sub else 0), title, ha="center", va="center",
            fontsize=fs, fontweight="bold", color=text, zorder=3)
    if sub:
        ax.text(x, y - 0.24, sub, ha="center", va="center",
                fontsize=8.5, color=text, zorder=3, alpha=0.95)

def arrow(p1, p2, color="#34495e", style="-|>", lw=2.2, rad=0.0, ls="-"):
    a = FancyArrowPatch(p1, p2, arrowstyle=style, mutation_scale=18,
                        lw=lw, color=color, zorder=1,
                        connectionstyle=f"arc3,rad={rad}", linestyle=ls)
    ax.add_patch(a)

# Title
ax.text(7.5, 8.6, "SystemOps Core — Integrações e Jornada da Mensagem",
        ha="center", fontsize=17, fontweight="bold", color="#2C3E50")
ax.text(7.5, 8.15, "O LLM entende e verbaliza · o sistema decide",
        ha="center", fontsize=10.5, color="#7f8c8d", style="italic")

# --- Main horizontal journey (entrada) ---
y0 = 5.2
box(1.6, y0, 2.2, 1.0, "Lead", "WhatsApp", COL["lead"], fs=13)
box(4.5, y0, 2.2, 1.0, "Z-API", "provedor WhatsApp", COL["edge"])
box(7.4, y0, 2.2, 1.1, "Webhook", "/api/whatsapp/zapi", COL["edge"])
box(10.6, y0, 2.6, 1.4, "SystemOps Core", "Next.js · Vercel\nOrchestrator + regras", COL["core"], fs=13)

arrow((2.7, y0), (3.4, y0), COL["edge"])
arrow((5.6, y0), (6.3, y0), COL["edge"])
arrow((8.5, y0), (9.3, y0), COL["edge"])
# resposta de volta
arrow((10.6, y0+0.75), (4.5, y0+0.62), COL["out"], rad=-0.28, lw=2.0)
ax.text(7.5, 6.65, "resposta (texto / áudio / mídia)", ha="center",
        fontsize=9, color=COL["out"], fontweight="bold")

# --- Inteligência / IA (acima do core) ---
box(13.4, 7.2, 2.6, 1.2, "OpenAI / GPT", "intent + resposta\nWhisper (áudio)", COL["ai"])
box(13.4, 5.4, 2.6, 1.0, "TTS", "OpenAI · Google · Kokoro", COL["ai"])
arrow((11.9, 5.7), (12.3, 6.7), COL["ai"], rad=0.1, style="<|-|>")
arrow((11.9, 5.2), (12.1, 5.4), COL["ai"], style="<|-|>")

# --- Dados / persistência (abaixo) ---
box(8.0, 2.4, 2.4, 1.1, "Postgres", "Drizzle · multi-tenant\nestado da conversa", COL["data"])
box(11.0, 2.4, 2.4, 1.0, "Vercel Blob", "mídia / áudio TTS", COL["data"])
arrow((10.2, 4.0), (8.4, 3.0), COL["data"], rad=0.05, style="<|-|>")
arrow((10.6, 3.95), (11.0, 2.95), COL["data"], style="<|-|>")

# --- Agenda externa ---
box(4.6, 2.4, 2.6, 1.1, "Google Calendar", "opt-in por clínica\n(modo legado)", COL["ext"])
arrow((9.5, 4.6), (5.4, 3.0), COL["ext"], rad=0.12, style="<|-|>")
ax.text(6.9, 3.75, "BookingService · CalendarGateway", ha="center",
        fontsize=8.5, color=COL["ext"], fontweight="bold", rotation=18)

# --- Saídas operacionais ---
box(1.6, 2.4, 2.2, 1.0, "Push + Crons", "alertas / follow-up\nlembretes", COL["out"])
arrow((9.4, 4.7), (2.4, 3.0), COL["out"], rad=0.18, style="-|>")

# Legend
legend = [
    ("Jornada do lead (entrada/saída)", COL["edge"]),
    ("Core de decisão", COL["core"]),
    ("Inteligência (LLM/voz)", COL["ai"]),
    ("Dados / storage", COL["data"]),
    ("Agenda externa", COL["ext"]),
    ("Operação (push/crons)", COL["out"]),
]
handles = [Line2D([0],[0], marker="s", color="w", markerfacecolor=c,
                  markersize=13, label=l) for l, c in legend]
ax.legend(handles=handles, loc="lower center", ncol=3, frameon=False,
          fontsize=9.5, bbox_to_anchor=(0.5, -0.02))

plt.tight_layout()
plt.savefig("/tmp/systemops-arch.png", dpi=150, bbox_inches="tight",
            facecolor="white")
print("saved")
