"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCampaignAction, previewCampaignAudience, type ActionState } from "../actions";
import { LEAD_OUTCOME_REASON_LABELS } from "@/core/intelligence/LeadOutcomeClassifier";
import { SILENCE_STAGE_LABELS } from "@/core/intelligence/silence-stage";
import { DEFAULT_SEGMENT } from "@/application/reactivation/audience-segment";

type Offer = { id: string; label: string };
type TestLead = { id: string; label: string };

type Preview = {
  total: number;
  willMaterialize: number;
  truncated: boolean;
  byReason: Array<{ reason: string | null; count: number }>;
  byStage: Array<{ stage: string | null; count: number }>;
};

export function NovaCampanhaClient({
  offers,
  testLeads,
}: {
  offers: Offer[];
  testLeads: TestLead[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<ActionState, FormData>(createCampaignAction, null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Prazo é a validade da oferta. Sem oferta escolhida o campo fica travado —
  // deixá-lo aberto convida a preencher e levar um erro no submit.
  const [temOferta, setTemOferta] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handlePreview(form: HTMLFormElement) {
    const data = new FormData(form);
    startTransition(async () => {
      const result = await previewCampaignAudience(data);
      if (result.ok) {
        setPreview(result.preview);
        setPreviewError(null);
      } else {
        setPreview(null);
        setPreviewError(result.message ?? "Não foi possível calcular a audiência.");
      }
    });
  }

  if (state?.ok) {
    // Criada: volta para a lista, onde a campanha aparece pronta para revisão.
    router.push("/app/campanhas");
  }

  return (
    <div className="campanhas-page">
      <header className="page-header">
        <h1>Nova campanha de reativação</h1>
        <p className="muted">
          Escolha quem reencontrar. Veja quantos entram antes de criar — nada é enviado nesta etapa.
        </p>
      </header>

      <form
        action={formAction}
        onChange={(e) => handlePreview(e.currentTarget)}
        className="form-stack"
      >
        <label className="field">
          <span>Nome da campanha</span>
          <input name="name" required placeholder="Ex.: Recuperar quem parou no preço" />
        </label>

        <fieldset className="field-group">
          <legend>Quem entra</legend>

          <div className="field-row">
            <label className="field">
              <span>De (dias atrás)</span>
              <input
                type="number"
                name="windowFromDaysAgo"
                defaultValue={DEFAULT_SEGMENT.windowFromDaysAgo}
                min={3}
                max={365}
              />
            </label>
            <label className="field">
              <span>Até (dias atrás)</span>
              <input
                type="number"
                name="windowToDaysAgo"
                defaultValue={DEFAULT_SEGMENT.windowToDaysAgo}
                min={2}
                max={364}
              />
            </label>
          </div>
          <p className="muted small">
            Conversa de ontem ainda pode estar viva — por isso o mínimo de 2 dias no fim da janela.
          </p>

          {/* Filtro principal: é o que de fato seleciona gente. Segmentar pelo
              motivo declarado quase não devolve ninguém — pouca gente escreve
              "achou caro" antes de sumir; o que ficou na mesa, sim. */}
          <div className="checkbox-grid">
            <span className="field-label">O que estava na mesa quando a pessoa parou</span>
            {Object.entries(SILENCE_STAGE_LABELS).map(([value, label]) => (
              <label key={value} className="checkbox">
                <input type="checkbox" name="silenceStages" value={value} />
                {label}
              </label>
            ))}
            <p className="muted small">
              Para uma campanha de oferta, <strong>&ldquo;viu o valor e sumiu&rdquo;</strong> é
              normalmente o grupo certo.
            </p>
          </div>

          <details className="advanced">
            <summary>Filtros avançados</summary>

            <div className="checkbox-grid">
              <span className="field-label">Motivo de não ter fechado</span>
              {Object.entries(LEAD_OUTCOME_REASON_LABELS).map(([value, label]) => (
                <label key={value} className="checkbox">
                  <input type="checkbox" name="outcomeReasons" value={value} />
                  {label}
                </label>
              ))}
              <p className="muted small">
                Depende de a pessoa ter dito o motivo com todas as letras — poucos dizem. Use
                junto com o filtro acima, não no lugar dele.
              </p>
            </div>

            <label className="field">
              <span>Confiança mínima da classificação (%)</span>
              <input
                type="number"
                name="minConfidence"
                defaultValue={DEFAULT_SEGMENT.minConfidence}
                min={0}
                max={100}
              />
            </label>
          </details>
        </fieldset>

        <fieldset className="field-group">
          <legend>Proteções</legend>
          <div className="field-row">
            <label className="field">
              <span>Não contatar quem recebeu mensagem nos últimos (dias)</span>
              <input
                type="number"
                name="excludeContactedWithinDays"
                defaultValue={DEFAULT_SEGMENT.excludeContactedWithinDays}
                min={3}
              />
            </label>
            <label className="field">
              <span>Máximo de campanhas por contato (na vida)</span>
              <input
                type="number"
                name="lifetimeCampaignCap"
                defaultValue={DEFAULT_SEGMENT.lifetimeCampaignCap}
                min={1}
                max={5}
              />
            </label>
          </div>
          <label className="field">
            <span>Máximo de envios por dia</span>
            <input type="number" name="dailySendCap" defaultValue={30} min={5} max={100} />
          </label>
          <p className="muted small">
            Quem pediu para não receber mais mensagens, quem tem consulta marcada e quem já fechou
            ficam de fora automaticamente.
          </p>
        </fieldset>

        <fieldset className="field-group">
          <legend>Oferta e prazo</legend>
          <label className="field">
            <span>Oferta (opcional)</span>
            <select
              name="priceCampaignId"
              defaultValue=""
              onChange={(e) => setTemOferta(e.target.value !== "")}
            >
              <option value="">Sem oferta — só reengajamento</option>
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className={`field${temOferta ? "" : " field-disabled"}`}>
            <span>Válida até</span>
            <input type="date" name="deadlineAt" disabled={!temOferta} />
          </label>
          <p className="muted small">
            {temOferta
              ? "Depois dessa data a condição não é mais oferecida. A IA menciona o prazo uma vez, sem pressionar."
              : "O prazo é a validade da oferta — escolha uma acima para liberar o campo. Sem oferta, a IA é proibida de citar valores ou criar urgência."}
          </p>
        </fieldset>

        <fieldset className="field-group">
          <legend>Ensaio</legend>
          <label className="field">
            <span>Enviar tudo para um contato de teste</span>
            <select name="testLeadId" defaultValue="">
              <option value="">Não — enviar para os pacientes reais</option>
              {testLeads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            No ensaio, as mensagens vão para o contato escolhido com o destinatário real no
            cabeçalho. Os contatos reais não são consumidos e podem receber a campanha depois.
          </p>
        </fieldset>

        {preview && (
          <div className="preview-card">
            <div className="preview-head">
              <span className="preview-number">{preview.willMaterialize}</span>
              <span>
                {preview.willMaterialize === 1 ? "contato entra" : "contatos entram"} nesse
                filtro
              </span>
            </div>

            {preview.truncated && (
              <p className="warning small">
                O filtro encontrou {preview.total}, mas a campanha leva no máximo{" "}
                {preview.willMaterialize}. Aperte a janela para escolher melhor quem entra.
              </p>
            )}

            {preview.byStage.length > 0 && (
              <ul className="preview-stages">
                {preview.byStage.map((s) => (
                  <li key={s.stage ?? "none"}>
                    {s.stage
                      ? (SILENCE_STAGE_LABELS[
                          s.stage as keyof typeof SILENCE_STAGE_LABELS
                        ] ?? s.stage)
                      : "Ainda sem análise"}
                    {" · "}
                    {s.count}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {previewError && <p className="callout callout-error">{previewError}</p>}
        {state && !state.ok && <p className="callout callout-error">{state.message}</p>}

        <button className="btn btn-primary" type="submit" disabled={isPending}>
          Criar campanha
        </button>
      </form>
    </div>
  );
}
