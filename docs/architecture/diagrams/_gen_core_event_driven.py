import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from matplotlib.lines import Line2D
from pathlib import Path

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
C_EXT   = "#16A085"
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

ax.text(8.0, 8.6, "Arquitetura 2.0 — multi-tenant e multi-segmento",
        ha="center", fontsize=18, fontweight="bold", color=C_INGR)
ax.text(8.0, 8.15,
        "generalizar dominio sem perder tenancy, inbox/outbox e decisao deterministica",
        ha="center", fontsize=10.5, color=C_WORK, fontweight="bold")

ymain = 5.6
# Channel and ingress
box(1.6, ymain, 2.2, 1.0, "Channel adapters", "WhatsApp hoje\noutros depois", C_EDGE, fs=10)
box(4.4, ymain, 2.5, 1.1, "Ingress + tenancy", "resolve tenant\nnormaliza entrada", C_INGR, fs=10)
arrow((2.7, ymain), (3.1, ymain))

# Event bus
box(7.4, ymain, 2.4, 1.1, "Durable jobs", "event bus / retry\nordem por tenant", C_QUEUE, fs=10)
arrow((5.7, ymain), (6.1, ymain))

# Worker core
box(10.7, ymain, 2.8, 1.25, "Core workers", "conversation + automation\nLLM cercado por regra", C_WORK, fs=10.2)
arrow((8.7, ymain), (9.2, ymain))

# Config and domain modules
cyl(10.7, 7.1, 3.0, 1.0, "Tenant config", "editorial + policies + segment pack", C_DATA)
arrow((10.7, 6.55), (10.7, 6.15), C_DATA)

box(14.2, 6.9, 2.6, 1.0, "Observabilidade", "traceId · audit · metrics", C_OBS, fs=9.5)
arrow((12.1, 5.95), (13.0, 6.55), C_OBS, style="-|>", rad=0.03, lw=1.5)

box(7.2, 3.5, 2.1, 1.0, "Scheduling", "capability opcional", C_EXT, fs=10)
box(10.7, 3.5, 2.4, 1.0, "Knowledge / commercial", "capability opcional", C_EXT, fs=10)
box(14.0, 3.5, 2.2, 1.0, "Handoff / ops", "capability opcional", C_EXT, fs=10)
arrow((10.1, 5.0), (7.9, 4.05), C_EXT, style="-|>", rad=0.05, lw=1.6)
arrow((10.7, 4.95), (10.7, 4.05), C_EXT, style="-|>", rad=0.0, lw=1.6)
arrow((11.3, 5.0), (13.3, 4.05), C_EXT, style="-|>", rad=-0.05, lw=1.6)

# Outbox and delivery
cyl(10.7, 2.0, 2.5, 0.95, "Outbox", "intencao de envio", C_DATA)
box(14.0, 2.0, 2.2, 1.0, "Delivery workers", "canal + retry", C_WORK, fs=10)
arrow((12.0, 2.0), (12.9, 2.0), C_DATA)
arrow((15.1, 2.0), (15.6, 2.0), C_EDGE)
box(15.8, 2.0, 0.35, 0.9, "", "", C_EDGE, fs=1)
ax.text(15.8, 2.0, ">", ha="center", va="center", color="white", fontsize=12, fontweight="bold")

box(14.0, 5.5, 2.4, 0.95, "LLM / voice", "provider adapters", C_LLM, fs=9.5)
arrow((12.1, 5.6), (12.8, 5.55), C_LLM, style="<|-|>", rad=0.0, lw=1.6)

ax.text(1.0, 7.7, "Invariantes preservados:\n- tenant primeiro\n- inbox/outbox\n- LLM nao decide negocio\n- modulos opcionais por capability",
        ha="left", va="top", fontsize=9, color=C_INGR, fontweight="bold",
        bbox=dict(boxstyle="round,pad=0.4", fc="white", ec=C_INGR, lw=1.4))

legend = [("Canais / borda", C_EDGE), ("Ingress / tenancy", C_INGR), ("Jobs / bus", C_QUEUE),
          ("Workers", C_WORK), ("Config / outbox", C_DATA),
          ("Capabilities", C_EXT), ("LLM / voz", C_LLM), ("Observabilidade", C_OBS)]
handles = [Line2D([0],[0], marker="s", color="w", markerfacecolor=c,
           markersize=11, label=l) for l, c in legend]
ax.legend(handles=handles, loc="lower center", ncol=4, frameon=False,
          fontsize=8.8, bbox_to_anchor=(0.5, -0.04))

OUT = Path(__file__).with_name("core-event-driven.png")
plt.savefig(OUT, dpi=150, bbox_inches="tight", facecolor="white")
print("saved core-event-driven")
