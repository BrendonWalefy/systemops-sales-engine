"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, CheckCircle2, Loader2, Plus, Trash2, UserCircle2 } from "lucide-react";
import { addMember, removeMember, setMemberDisplayName, type EquipeActionState } from "./actions";

type Member = {
  id: string;
  email: string;
  role: string;
  professionalId: string | null;
  avatarUrl: string | null;
  displayName: string | null;
};

type Professional = {
  id: string;
  name: string;
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Dono",
  clinic_admin: "Administrador",
  professional: "Profissional",
  receptionist: "Recepcionista",
};

const ROLE_COLORS: Record<string, string> = {
  owner: "rgba(251,191,36,0.15)",
  clinic_admin: "rgba(16,185,129,0.12)",
  professional: "rgba(99,102,241,0.12)",
  receptionist: "rgba(148,163,184,0.12)",
};

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="primary-button"
      disabled={pending}
      style={{ gap: "8px", opacity: pending ? 0.7 : 1 }}
    >
      {pending ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
      {pending ? "Salvando..." : "Adicionar"}
    </button>
  );
}

function SaveNameButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      title="Salvar nome de exibição"
      disabled={pending}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 10px",
        border: "1px solid var(--line)",
        borderRadius: "6px",
        background: "transparent",
        color: "var(--accent-strong)",
        cursor: pending ? "default" : "pointer",
        fontSize: "12px",
        fontWeight: 600,
        opacity: pending ? 0.7 : 1,
      }}
    >
      {pending ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
      Salvar
    </button>
  );
}

export function EquipeClient({ members, professionals }: { members: Member[]; professionals: Professional[] }) {
  const [state, formAction] = useActionState<EquipeActionState, FormData>(addMember, null);

  return (
    <div style={{ maxWidth: 720, padding: "28px 20px" }}>
      <div className="product-topbar" style={{ marginBottom: "24px" }}>
        <div>
          <p className="eyebrow">Configurações</p>
          <h1 style={{ margin: 0 }}>Equipe</h1>
        </div>
      </div>

      {/* Membros atuais */}
      <section
        style={{
          border: "1px solid var(--line)",
          borderRadius: "14px",
          background: "var(--surface-soft)",
          overflow: "hidden",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            padding: "16px 22px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <strong style={{ fontSize: "15px", fontWeight: 700 }}>
            {members.length} membro{members.length !== 1 ? "s" : ""}
          </strong>
        </div>

        {members.length === 0 ? (
          <div style={{ padding: "32px 22px", textAlign: "center", color: "var(--muted)", fontSize: "14px" }}>
            Nenhum membro cadastrado
          </div>
        ) : (
          <div>
            {members.map((m, idx) => {
              const prof = professionals.find((p) => p.id === m.professionalId);
              const hasName = !!m.displayName?.trim();
              const primary = hasName ? (m.displayName as string) : m.email;
              const secondaryParts = [hasName ? m.email : null, prof?.name].filter(Boolean) as string[];
              return (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    padding: "12px 22px",
                    borderBottom: idx !== members.length - 1 ? "1px solid var(--line)" : undefined,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto auto",
                      alignItems: "center",
                      gap: "12px",
                    }}
                  >
                    <div
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "50%",
                        background: "var(--surface-raised)",
                        border: "1px solid var(--line)",
                        display: "grid",
                        placeItems: "center",
                        color: "var(--muted)",
                      }}
                    >
                      {m.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.avatarUrl} alt="" style={{ width: "36px", height: "36px", borderRadius: "50%", objectFit: "cover" }} />
                      ) : (
                        <UserCircle2 size={18} />
                      )}
                    </div>

                    <div>
                      <p style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>{primary}</p>
                      {secondaryParts.length > 0 && (
                        <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--muted)" }}>
                          {secondaryParts.join(" · ")}
                        </p>
                      )}
                    </div>

                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "3px 10px",
                        borderRadius: "6px",
                        background: ROLE_COLORS[m.role] ?? "rgba(255,255,255,0.05)",
                        color: "var(--text)",
                        border: "1px solid var(--line)",
                      }}
                    >
                      {ROLE_LABELS[m.role] ?? m.role}
                    </span>

                    <form>
                      <input type="hidden" name="memberId" value={m.id} />
                      <button
                        formAction={removeMember}
                        title="Remover membro"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          padding: "6px 8px",
                          border: "1px solid var(--line)",
                          borderRadius: "6px",
                          background: "transparent",
                          color: "var(--muted)",
                          cursor: "pointer",
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </form>
                  </div>

                  {/* Nome de exibição — usado na saudação do dashboard ("Olá, {nome}!").
                      Atualiza só o nome; não mexe em papel, senha nem profissional. */}
                  <form action={setMemberDisplayName} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="hidden" name="memberId" value={m.id} />
                    <input
                      type="text"
                      name="displayName"
                      defaultValue={m.displayName ?? ""}
                      placeholder='Nome de exibição (ex.: "Dr. Gregorie")'
                      style={{ margin: 0, flex: 1, fontSize: "13px" }}
                    />
                    <SaveNameButton />
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Adicionar novo membro */}
      <section
        style={{
          border: "1px solid var(--line)",
          borderRadius: "14px",
          background: "var(--surface-soft)",
          padding: "20px 22px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", marginBottom: "18px" }}>
          <div
            style={{
              display: "grid",
              placeItems: "center",
              width: "40px",
              height: "40px",
              flexShrink: 0,
              borderRadius: "10px",
              border: "1px solid var(--line)",
              background: "var(--surface-raised)",
              color: "var(--accent-strong)",
            }}
          >
            <Plus size={18} strokeWidth={1.8} />
          </div>
          <div>
            <strong style={{ fontSize: "15px", fontWeight: 700 }}>Adicionar membro</strong>
            <p style={{ margin: "3px 0 0", fontSize: "13px", color: "var(--muted)" }}>
              O membro receberá acesso com o papel selecionado. Defina uma senha para login.
            </p>
          </div>
        </div>

        <form action={formAction} style={{ display: "grid", gap: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <label style={{ margin: 0 }}>
              <span style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "5px" }}>E-mail</span>
              <input type="email" name="email" required placeholder="membro@clinica.com" style={{ margin: 0 }} />
            </label>

            <label style={{ margin: 0 }}>
              <span style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "5px" }}>Papel</span>
              <select name="role" defaultValue="receptionist" style={{ margin: 0 }}>
                <option value="org_admin">Administrador</option>
                <option value="professional">Profissional</option>
                <option value="receptionist">Recepcionista</option>
              </select>
            </label>
          </div>

          <label style={{ margin: 0 }}>
            <span style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "5px" }}>
              Nome de exibição (opcional — aparece na saudação do dashboard)
            </span>
            <input type="text" name="displayName" placeholder='Ex.: "Dr. Gregorie"' style={{ margin: 0 }} />
          </label>

          {professionals.length > 0 && (
            <label style={{ margin: 0 }}>
              <span style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "5px" }}>
                Profissional vinculado (apenas para papel profissional)
              </span>
              <select name="professionalId" style={{ margin: 0 }}>
                <option value="">— Nenhum —</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          )}

          <label style={{ margin: 0 }}>
            <span style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "5px" }}>Senha de acesso</span>
            <input type="password" name="password" placeholder="Mínimo 8 caracteres" style={{ margin: 0 }} />
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <AddButton />
            {state?.success && (
              <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--accent-strong)" }}>
                <CheckCircle2 size={14} />
                Membro adicionado
              </span>
            )}
            {state?.error && (
              <span style={{ fontSize: "13px", color: "var(--destructive, #ef4444)" }}>{state.error}</span>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
