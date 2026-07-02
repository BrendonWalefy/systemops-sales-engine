"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { avatarInitial } from "../avatar-initial";

type Props = {
  profilePicUrl: string | null;
  displayName: string;
  initial: string;
  accentColor: string;
  className?: string;
  style?: React.CSSProperties;
};

export function LeadAvatar({ profilePicUrl, displayName, initial, accentColor, className, style }: Props) {
  const [open, setOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const canUsePortal = typeof document !== "undefined";
  const safeInitial = avatarInitial(initial || displayName);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const avatar = profilePicUrl && !imgError ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={profilePicUrl}
      alt={displayName}
      className={className}
      style={{ objectFit: "cover", borderColor: accentColor, cursor: "pointer", ...style }}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }}
      onError={() => setImgError(true)}
    />
  ) : (
    <div
      className={className}
      style={{
        background: `linear-gradient(145deg, color-mix(in srgb, ${accentColor} 22%, transparent), var(--surface-raised))`,
        borderColor: accentColor,
        color: accentColor,
        ...style,
      }}
    >
      {safeInitial}
    </div>
  );

  const lightbox = open && canUsePortal && createPortal(
    <div
      className="lead-photo-lightbox"
      onClick={() => setOpen(false)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={profilePicUrl!}
        alt={displayName}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(320px, 80vw)",
          height: "min(320px, 80vw)",
          borderRadius: "50%",
          objectFit: "cover",
          boxShadow: "0 0 0 4px rgba(16,185,129,0.25), 0 24px 80px rgba(0,0,0,0.6)",
          animation: "scaleIn 0.18s ease",
        }}
      />
    </div>,
    document.body,
  );

  return (
    <>
      {avatar}
      {lightbox}
    </>
  );
}
