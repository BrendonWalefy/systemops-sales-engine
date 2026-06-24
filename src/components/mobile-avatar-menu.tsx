"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Settings2, Workflow, Users, LogOut, Camera, X, ChevronRight, Loader2, Bell, LayoutGrid } from "lucide-react";
import { logout } from "@/app/login/actions";
import { uploadAvatar, removeAvatar } from "@/app/(clinic)/app/settings/profile/actions";
import { BellToggle } from "./bell-toggle";
import { haptic } from "@/lib/haptic";

type Props = {
  email?: string;
  avatarUrl?: string | null;
  settingsMode?: boolean;
  isOwner?: boolean;
};

const SHEET_ITEMS = [
  { href: "/app/settings/playbook", label: "Configurações", Icon: Settings2, desc: "IA, playbook, procedimentos" },
  { href: "/app/settings/pipeline", label: "Pipeline de Conversa", Icon: Workflow, desc: "Fluxos por tratamento" },
  { href: "/app/settings/profissionais", label: "Profissionais", Icon: Users, desc: "Equipe da clínica" },
];

function LogoutSection() {
  const [confirm, setConfirm] = useState(false);

  if (confirm) {
    return (
      <div className="mobile-sheet-footer">
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px", textAlign: "center" }}>
          Confirmar saída da conta?
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              haptic();
              setConfirm(false);
            }}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 12,
              border: "1px solid var(--line)",
              background: "transparent",
              color: "var(--muted)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <form action={logout} style={{ flex: 1 }}>
            <button
              type="submit"
              onClick={() => haptic("medium")}
              style={{
                width: "100%",
                padding: "10px 0",
                borderRadius: 12,
                border: "none",
                background: "rgba(239, 68, 68, 0.12)",
                color: "#f87171",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Sair
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-sheet-footer">
      <button
        type="button"
        className="mobile-sheet-logout"
        onClick={() => {
          haptic();
          setConfirm(true);
        }}
      >
        <LogOut size={15} strokeWidth={2} />
        Sair da conta
      </button>
    </div>
  );
}

export function MobileAvatarMenu({ email, avatarUrl: initialAvatarUrl, settingsMode, isOwner = false }: Props) {
  const [open, setOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [isPending, startTransition] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;

    for (const item of SHEET_ITEMS) {
      router.prefetch(item.href);
    }
  }, [open, router]);

  const initial = email?.split("@")[0]?.[0]?.toUpperCase() ?? "?";
  const isActive = open || SHEET_ITEMS.some((item) => pathname.startsWith(item.href));

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    const formData = new FormData();
    formData.append("avatar", file);
    startTransition(async () => {
      const result = await uploadAvatar(formData);
      if (result.success) {
        setAvatarUrl(result.url);
        router.refresh();
      } else {
        setUploadError(result.error);
      }
    });
    e.target.value = "";
  }

  function handleRemoveAvatar() {
    setUploadError(null);
    startTransition(async () => {
      const result = await removeAvatar();
      if (result.success) {
        setAvatarUrl(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      {/* Pill nav trigger: settings mode = Ajustes icon; default = avatar circle */}
      {settingsMode ? (
        <button
          type="button"
          onClick={() => {
            haptic();
            setOpen(true);
          }}
          className={`mobile-settings-btn${isActive ? " active" : ""}`}
          aria-label="Ajustes"
        >
          <Settings2 size={15} strokeWidth={2} />
          <span className="nav-label">Ajustes</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            haptic();
            setOpen(true);
          }}
          className={`mobile-avatar-btn${isActive ? " active" : ""}`}
          aria-label="Abrir menu"
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL dinâmica do Vercel Blob, sem domain configurado em next.config; thumbnail pequeno, não afeta LCP
            <img
              src={avatarUrl}
              alt="Avatar"
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "999px" }}
            />
          ) : (
            <span className="mobile-avatar-initial">{initial}</span>
          )}
        </button>
      )}

      {/* Sheet overlay */}
      {open && (
        <div
          className="mobile-sheet-overlay"
          onClick={() => {
            haptic();
            setOpen(false);
          }}
          aria-hidden="true"
        />
      )}

      {/* Bottom sheet */}
      <div className={`mobile-sheet${open ? " open" : ""}`} role="dialog" aria-modal="true" aria-label="Menu de configurações">
        {/* Drag handle */}
        <div className="mobile-sheet-handle" />

        {/* Close button */}
        <button
          type="button"
          onClick={() => {
            haptic();
            setOpen(false);
          }}
          className="mobile-sheet-close"
          aria-label="Fechar"
        >
          <X size={16} strokeWidth={2} />
        </button>

        {/* User profile section */}
        <div className="mobile-sheet-profile">
          {/* Avatar with upload */}
          <div className="mobile-sheet-avatar-wrap">
            <div className="mobile-sheet-avatar-img">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- URL dinâmica do Vercel Blob, sem domain configurado em next.config; thumbnail pequeno, não afeta LCP
                <img
                  src={avatarUrl}
                  alt="Avatar"
                  style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "999px" }}
                />
              ) : (
                <span className="mobile-sheet-avatar-initial">{initial}</span>
              )}
              {isPending && (
                <div className="mobile-sheet-avatar-loading">
                  <Loader2 size={18} strokeWidth={2} style={{ animation: "spin 0.8s linear infinite" }} />
                </div>
              )}
            </div>

            <div className="mobile-sheet-avatar-actions">
              <button
                type="button"
                onClick={() => {
                  haptic();
                  fileInputRef.current?.click();
                }}
                disabled={isPending}
                className="mobile-sheet-avatar-upload-btn"
              >
                <Camera size={13} strokeWidth={2} />
                {avatarUrl ? "Trocar foto" : "Adicionar foto"}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => {
                    haptic("medium");
                    handleRemoveAvatar();
                  }}
                  disabled={isPending}
                  className="mobile-sheet-avatar-remove-btn"
                >
                  Remover
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />

            {uploadError && (
              <p className="mobile-sheet-upload-error">{uploadError}</p>
            )}
          </div>

          <div className="mobile-sheet-user-info">
            <span className="mobile-sheet-email" title={email}>{email}</span>
            <span className="mobile-sheet-role">{isOwner ? "Owner" : "Clinic Admin"}</span>
          </div>
        </div>

        {/* Owner back link */}
        {isOwner && (
          <Link
            href="/owner"
            onClick={() => {
              haptic("medium");
              setOpen(false);
            }}
            style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", textDecoration: "none", background: "rgba(129,140,248,0.06)" }}
          >
            <div className="mobile-sheet-item-icon" style={{ color: "#818cf8" }}>
              <LayoutGrid size={16} strokeWidth={1.8} />
            </div>
            <div className="mobile-sheet-item-text" style={{ flex: 1 }}>
              <span style={{ color: "#818cf8", fontWeight: 700 }}>Painel Owner</span>
              <small>Voltar ao painel de controle</small>
            </div>
            <ChevronRight size={14} strokeWidth={2} style={{ opacity: 0.5, color: "#818cf8", flexShrink: 0 }} />
          </Link>
        )}

        {/* Notifications toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="mobile-sheet-item-icon">
            <Bell size={16} strokeWidth={1.8} />
          </div>
          <div className="mobile-sheet-item-text" style={{ flex: 1 }}>
            <span>Notificações</span>
            <small>Alertas de inbox neste dispositivo</small>
          </div>
          <BellToggle />
        </div>

        {/* Nav items */}
        <nav className="mobile-sheet-nav">
          {SHEET_ITEMS.map(({ href, label, Icon, desc }) => (
            <Link
              key={href}
              href={href}
              prefetch
              onClick={() => {
                haptic();
                setOpen(false);
              }}
              className={`mobile-sheet-item${pathname.startsWith(href) ? " active" : ""}`}
            >
              <div className="mobile-sheet-item-icon">
                <Icon size={16} strokeWidth={1.8} />
              </div>
              <div className="mobile-sheet-item-text">
                <span>{label}</span>
                <small>{desc}</small>
              </div>
              <ChevronRight size={14} strokeWidth={2} style={{ opacity: 0.35, flexShrink: 0 }} />
            </Link>
          ))}
        </nav>

        {/* Logout — confirmação inline */}
        <LogoutSection />
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
