"use client";

import { useMemo, useState, useTransition } from "react";
import {
  approveCampaignAction,
  approveTargetsAction,
  dispatchCampaignAction,
  editTargetAction,
  generateDraftsAction,
  rejectTargetsAction,
} from "../actions";

export type TargetView = {
  id: string;
  leadName: string | null;
  treatmentInterest: string | null;
  outcomeReason: string | null;
  outcomeLabel: string | null;
  evidenceExcerpt: string | null;
  confidence: number | null;
  message: string | null;
  status: string;
  rejectionReason: string | null;
};

export type CampaignView = {
  id: string;
  name: string;
  status: string;
  isRehearsal: boolean;
  deadlineLabel: string | null;
  offerLabel: string | null;
  dailySendCap: number;
};

const STATUS_ORDER = ["pending", "approved", "rejected", "queued", "sent", "skipped", "failed"];

/** Abaixo disso a classificação é sugestão, não fato — a UI precisa dizer isso. */
const LOW_CONFIDENCE = 60;

export function RevisaoClient({
  campaign,
  targets: initialTargets,
}: {
  campaign: CampaignView;
  targets: TargetView[];
}) {
  const [targets, setTargets] = useState(initialTargets);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>("pending");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of targets) map[t.status] = (map[t.status] ?? 0) + 1;
    return map;
  }, [targets]);

  const visible = useMemo(
    () => targets.filter((t) => (filter === "all" ? true : t.status === filter)),
    [targets, filter],
  );

  const selectableVisible = visible.filter((t) => t.message !== null);
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((t) => selected.has(t.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const t of selectableVisible) next.delete(t.id);
        return next;
      }
      return new Set([...prev, ...selectableVisible.map((t) => t.id)]);
    });
  }

  function runBatch(action: "approve" | "reject") {
    const ids = [...selected];
    if (ids.length === 0) return;

    startTransition(async () => {
      const result =
        action === "approve"
          ? await approveTargetsAction(campaign.id, ids)
          : await rejectTargetsAction(campaign.id, ids);

      if (result?.ok) {
        const novoStatus = action === "approve" ? "approved" : "rejected";
        setTargets((prev) =>
          prev.map((t) => (ids.includes(t.id) ? { ...t, status: novoStatus } : t)),
        );
        setSelected(new Set());
      }
      setFeedback(result ? { ok: result.ok, message: result.message ?? "" } : null);
    });
  }

  function saveEdit(id: string) {
    startTransition(async () => {
      const result = await editTargetAction(campaign.id, id, editText);
      if (result?.ok) {
        setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, message: editText } : t)));
        setEditing(null);
      }
      setFeedback(result ? { ok: result.ok, message: result.message ?? "" } : null);
    });
  }

  function runCampaignAction(fn: () => Promise<{ ok: boolean; message?: string } | null>) {
    startTransition(async () => {
      const result = await fn();
      setFeedback(result ? { ok: result.ok, message: result.message ?? "" } : null);
    });
  }

  const semRascunho = targets.every((t) => t.message === null);
  const podeAprovarCampanha = (counts.approved ?? 0) > 0 && campaign.status === "reviewing";
  const podeDisparar = ["approved", "running"].includes(campaign.status);

  return (
    <div className="page">
      <header className="page-header">
        <h1>{campaign.name}</h1>
        <p className="muted small">
          {campaign.offerLabel ? `Oferta: ${campaign.offerLabel}` : "Sem oferta — só reengajamento"}
          {campaign.deadlineLabel && ` · válida até ${campaign.deadlineLabel}`}
          {` · até ${campaign.dailySendCap} envios por dia`}
        </p>
        {campaign.isRehearsal && (
          <p className="callout callout-warning">
            🧪 <strong>Modo ensaio ativo.</strong> As mensagens vão para o contato de teste, não
            para os pacientes. Os contatos reais não são consumidos.
          </p>
        )}
      </header>

      {feedback && (
        <p className={feedback.ok ? "callout callout-success" : "callout callout-error"}>
          {feedback.message}
        </p>
      )}

      {semRascunho ? (
        <div className="empty-state">
          <h2>As mensagens ainda não foram escritas</h2>
          <p className="muted">
            A IA escreve uma mensagem por pessoa, usando o que ela disse na conversa. Você revisa
            tudo antes de qualquer envio.
          </p>
          <button
            className="btn btn-primary"
            disabled={isPending}
            onClick={() => runCampaignAction(() => generateDraftsAction(campaign.id))}
          >
            {isPending ? "Escrevendo…" : "Escrever mensagens"}
          </button>
        </div>
      ) : (
        <>
          <div className="tabs">
            {["pending", "approved", "rejected", "all"].map((f) => (
              <button
                key={f}
                className={`tab ${filter === f ? "tab-active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f === "pending" && `A revisar (${counts.pending ?? 0})`}
                {f === "approved" && `Aprovadas (${counts.approved ?? 0})`}
                {f === "rejected" && `Descartadas (${counts.rejected ?? 0})`}
                {f === "all" && `Todas (${targets.length})`}
              </button>
            ))}
          </div>

          <div className="toolbar toolbar-sticky">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                disabled={selectableVisible.length === 0}
              />
              Selecionar {selectableVisible.length} visíveis
            </label>

            <span className="muted small">{selected.size} selecionadas</span>

            <button
              className="btn btn-primary"
              disabled={selected.size === 0 || isPending}
              onClick={() => runBatch("approve")}
            >
              Aprovar selecionadas
            </button>
            <button
              className="btn"
              disabled={selected.size === 0 || isPending}
              onClick={() => runBatch("reject")}
            >
              Descartar selecionadas
            </button>
          </div>

          <ul className="review-list">
            {visible.map((t) => (
              <li key={t.id} className={`review-item review-${t.status}`}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                    disabled={t.message === null}
                  />
                </label>

                <div className="review-body">
                  <div className="review-head">
                    <strong>{t.leadName ?? "(sem nome)"}</strong>
                    {t.treatmentInterest && <span className="muted"> · {t.treatmentInterest}</span>}
                    {t.outcomeLabel && (
                      <span className="badge">
                        {t.outcomeLabel}
                        {t.confidence !== null && t.confidence < LOW_CONFIDENCE && " (confirmar)"}
                      </span>
                    )}
                  </div>

                  {t.evidenceExcerpt && (
                    <blockquote className="evidence">&ldquo;{t.evidenceExcerpt}&rdquo;</blockquote>
                  )}

                  {editing === t.id ? (
                    <div className="edit-box">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={4}
                      />
                      <div className="edit-actions">
                        <button className="btn btn-primary" onClick={() => saveEdit(t.id)}>
                          Salvar
                        </button>
                        <button className="btn" onClick={() => setEditing(null)}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : t.message ? (
                    <p className="draft">{t.message}</p>
                  ) : (
                    <p className="muted small">
                      {t.rejectionReason ?? "Sem mensagem — não pode ser enviada."}
                    </p>
                  )}

                  {t.message && editing !== t.id && (
                    <button
                      className="btn btn-link"
                      onClick={() => {
                        setEditing(t.id);
                        setEditText(t.message ?? "");
                      }}
                    >
                      Editar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <footer className="page-footer">
            {podeAprovarCampanha && (
              <button
                className="btn btn-primary"
                disabled={isPending}
                onClick={() => runCampaignAction(() => approveCampaignAction(campaign.id))}
              >
                Liberar campanha ({counts.approved} mensagens)
              </button>
            )}

            {podeDisparar && (
              <button
                className="btn btn-primary"
                disabled={isPending}
                onClick={() => runCampaignAction(() => dispatchCampaignAction(campaign.id))}
              >
                {campaign.isRehearsal
                  ? "Enviar ensaio para o contato de teste"
                  : `Enviar agora (até ${campaign.dailySendCap} hoje)`}
              </button>
            )}

            {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
              <span key={s} className="muted small">
                {s}: {counts[s]}
              </span>
            ))}
          </footer>
        </>
      )}
    </div>
  );
}
