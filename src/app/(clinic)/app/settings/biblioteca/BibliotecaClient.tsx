"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Film, Image as ImageIcon, Plus, Trash2, X, Loader2 } from "lucide-react";
import { renameMediaAsset, updateMediaAssetFolder, assignMediaAssetTreatment, deleteMediaAsset } from "./actions";

type MediaType = "video" | "image" | "document";
type Asset = {
  id: string;
  title: string;
  url: string;
  type: MediaType;
  folder: string | null;
  treatmentId: string | null;
};
type Treatment = { id: string; name: string };

const MAX_ASSETS = 15;
const ACCEPT = "video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp";

export function BibliotecaClient({ assets: initialAssets, treatments }: { assets: Asset[]; treatments: Treatment[] }) {
  const [assets, setAssets] = useState<Asset[]>(initialAssets);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const grouped = useMemo(() => {
    const byFolder = new Map<string, Asset[]>();
    for (const a of assets) {
      const key = a.folder?.trim() || "Sem pasta";
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key)!.push(a);
    }
    return Array.from(byFolder.entries()).sort(([a], [b]) => (a === "Sem pasta" ? 1 : b === "Sem pasta" ? -1 : a.localeCompare(b)));
  }, [assets]);

  const atLimit = assets.length >= MAX_ASSETS;

  async function handleFileSelected(file: File) {
    setUploadError(null);
    if (atLimit) {
      setUploadError(`Limite de ${MAX_ASSETS} mídias atingido. Remova uma mídia antes de adicionar outra.`);
      return;
    }
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/media/upload", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) {
        setUploadError(json.error ?? "Falha no upload.");
        return;
      }
      setAssets((prev) => [...prev, json.asset as Asset]);
    } catch {
      setUploadError("Falha ao conectar com o servidor. Tente novamente.");
    } finally {
      setUploading(false);
    }
  }

  function handleRename(id: string, title: string) {
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, title } : a)));
    startTransition(async () => {
      await renameMediaAsset(id, title);
    });
  }

  function handleFolderChange(id: string, folder: string) {
    const normalized = folder.trim() || null;
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, folder: normalized } : a)));
    startTransition(async () => {
      await updateMediaAssetFolder(id, normalized);
    });
  }

  function handleTreatmentChange(id: string, treatmentId: string) {
    const normalized = treatmentId || null;
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, treatmentId: normalized } : a)));
    startTransition(async () => {
      await assignMediaAssetTreatment(id, normalized);
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteMediaAsset(id);
      if (result.error) {
        alert(result.error);
        return;
      }
      setAssets((prev) => prev.filter((a) => a.id !== id));
    });
  }

  return (
    <div className="page-wrapper">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <h1 style={{ fontSize: "17px", fontWeight: 700, margin: 0 }}>Biblioteca de Mídia</h1>
          <p style={{ fontSize: "12px", color: "var(--muted)", margin: "1px 0 0" }}>
            Vídeos e fotos que a IA pode enviar ao lead. Organize por pasta e, opcionalmente, vincule a um procedimento
            específico — assim ela nunca aparece em conversas de outro procedimento.
          </p>
        </div>
        <span style={{ fontSize: "12px", fontWeight: 700, color: atLimit ? "#f87171" : "var(--muted)", flexShrink: 0 }}>
          {assets.length}/{MAX_ASSETS}
        </span>
      </div>

      {uploadError && (
        <div style={{ padding: "10px 14px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: "8px", color: "#f87171", fontSize: "13px", margin: "12px 0" }}>
          {uploadError}
        </div>
      )}

      <div style={{ margin: "16px 0" }}>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelected(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || atLimit}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "12px 16px",
            background: "rgba(0,212,170,0.06)",
            border: "1px dashed rgba(0,212,170,0.3)",
            borderRadius: "10px",
            color: atLimit ? "var(--muted)" : "var(--accent)",
            cursor: uploading || atLimit ? "default" : "pointer",
            fontSize: "13px",
            fontWeight: 600,
            width: "100%",
            justifyContent: "center",
          }}
        >
          {uploading ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Plus size={14} strokeWidth={2.5} />}
          {uploading ? "Enviando..." : atLimit ? "Limite de mídias atingido" : "Adicionar vídeo ou imagem"}
        </button>
      </div>

      {assets.length === 0 && (
        <div style={{ padding: "32px 24px", textAlign: "center", color: "var(--muted)", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: "12px" }}>
          <p style={{ fontSize: "14px", marginBottom: "4px" }}>Nenhuma mídia na biblioteca ainda</p>
          <p style={{ fontSize: "12px" }}>Envie um vídeo de procedimento para a IA poder enviar automaticamente ao lead.</p>
        </div>
      )}

      {grouped.map(([folder, items]) => (
        <div key={folder} style={{ marginBottom: "20px" }}>
          <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 8px" }}>
            {folder} ({items.length})
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {items.map((asset) => (
              <AssetRow
                key={asset.id}
                asset={asset}
                treatments={treatments}
                onRename={(title) => handleRename(asset.id, title)}
                onFolderChange={(folder) => handleFolderChange(asset.id, folder)}
                onTreatmentChange={(treatmentId) => handleTreatmentChange(asset.id, treatmentId)}
                onDelete={() => handleDelete(asset.id)}
                busy={isPending}
              />
            ))}
          </div>
        </div>
      ))}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function AssetRow({
  asset,
  treatments,
  onRename,
  onFolderChange,
  onTreatmentChange,
  onDelete,
  busy,
}: {
  asset: Asset;
  treatments: Treatment[];
  onRename: (title: string) => void;
  onFolderChange: (folder: string) => void;
  onTreatmentChange: (treatmentId: string) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "10px",
        alignItems: "center",
        padding: "10px 12px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: "10px",
      }}
    >
      {asset.type === "video" ? (
        <Film size={16} style={{ color: "#60a5fa", flexShrink: 0 }} />
      ) : (
        <ImageIcon size={16} style={{ color: "#60a5fa", flexShrink: 0 }} />
      )}

      <input
        defaultValue={asset.title}
        onBlur={(e) => {
          if (e.target.value.trim() && e.target.value !== asset.title) onRename(e.target.value.trim());
        }}
        style={{ flex: "1 1 160px", minWidth: 0, fontSize: "13px", margin: 0, background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "6px 8px", color: "inherit" }}
      />

      <input
        defaultValue={asset.folder ?? ""}
        placeholder="Pasta (opcional)"
        onBlur={(e) => {
          if (e.target.value.trim() !== (asset.folder ?? "")) onFolderChange(e.target.value);
        }}
        style={{ flex: "0 1 140px", minWidth: 0, fontSize: "12px", margin: 0, background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "6px 8px", color: "inherit" }}
      />

      <select
        value={asset.treatmentId ?? ""}
        onChange={(e) => onTreatmentChange(e.target.value)}
        title="Restringir a um procedimento (opcional) — a IA nunca envia esta mídia em conversas de outro procedimento"
        style={{ flex: "0 1 180px", minWidth: 0, fontSize: "12px", margin: 0 }}
      >
        <option value="">Mídia geral (todos os procedimentos)</option>
        {treatments.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>

      {confirmingDelete ? (
        <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            style={{ background: "rgba(248,113,113,0.14)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: "6px", padding: "5px 8px", color: "#f87171", cursor: "pointer", fontSize: "11px", fontWeight: 700 }}
          >
            Confirmar
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "5px", color: "var(--muted)", cursor: "pointer" }}
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          title="Excluir mídia"
          style={{ background: "transparent", border: "none", padding: "4px", cursor: "pointer", color: "var(--muted)", flexShrink: 0 }}
        >
          <Trash2 size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
