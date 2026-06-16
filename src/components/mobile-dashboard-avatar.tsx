"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { uploadAvatar } from "@/app/(clinic)/app/settings/profile/actions";
import { haptic } from "@/lib/haptic";

type Props = {
  avatarUrl: string | null;
  initial: string;
};

export function MobileDashboardAvatar({ avatarUrl, initial }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("avatar", file);
    startTransition(async () => {
      await uploadAvatar(formData).catch(() => {});
      router.refresh();
    });
    e.target.value = "";
  }

  return (
    <button
      type="button"
      onClick={() => {
        haptic();
        fileInputRef.current?.click();
      }}
      className="dashboard-mobile-avatar-btn"
      aria-label="Alterar foto de perfil"
      disabled={isPending}
    >
      {isPending ? (
        <div className="dashboard-mobile-avatar dashboard-mobile-avatar-fallback">
          <Loader2 size={16} strokeWidth={2} style={{ animation: "spin 0.8s linear infinite" }} />
        </div>
      ) : avatarUrl ? (
        <img src={avatarUrl} alt="Avatar" className="dashboard-mobile-avatar" />
      ) : (
        <div className="dashboard-mobile-avatar dashboard-mobile-avatar-fallback">
          {initial}
        </div>
      )}
      <span className="dashboard-mobile-avatar-camera">
        <Camera size={10} strokeWidth={2.5} />
      </span>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </button>
  );
}
