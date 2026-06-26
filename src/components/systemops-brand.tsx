import Image from "next/image";

type Variant = "icon" | "wordmark" | "wordmarkCompact" | "wordmarkText" | "lockup";

type Props = {
  variant?: Variant;
  className?: string;
  priority?: boolean;
};

function joinClassNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function SystemOpsBrand({ variant = "lockup", className, priority = false }: Props) {
  if (variant === "icon") {
    return (
      <Image
        src="/brand/systemops-icon.png"
        alt="SystemOps"
        width={1254}
        height={1254}
        priority={priority}
        className={joinClassNames("systemops-brand__icon", className)}
      />
    );
  }

  if (variant === "wordmark") {
    return (
      <Image
        src="/brand/systemops-wordmark.png"
        alt="SystemOps"
        width={980}
        height={300}
        priority={priority}
        className={joinClassNames("systemops-brand__wordmark", className)}
      />
    );
  }

  if (variant === "wordmarkCompact") {
    return (
      <Image
        src="/brand/systemops-wordmark-compact.png"
        alt="SystemOps"
        width={860}
        height={200}
        priority={priority}
        className={joinClassNames("systemops-brand__wordmark", className)}
      />
    );
  }

  if (variant === "wordmarkText") {
    return (
      <Image
        src="/brand/systemops-wordmark-text.png"
        alt="SystemOps"
        width={860}
        height={150}
        priority={priority}
        className={joinClassNames("systemops-brand__wordmark", className)}
      />
    );
  }

  return (
    <span className={joinClassNames("systemops-brand", "systemops-brand--lockup", className)} aria-label="SystemOps">
      <Image
        src="/brand/systemops-icon.png"
        alt=""
        width={1254}
        height={1254}
        priority={priority}
        className="systemops-brand__icon"
      />
      <Image
        src="/brand/systemops-wordmark-compact.png"
        alt=""
        width={860}
        height={200}
        priority={priority}
        className="systemops-brand__wordmark"
      />
    </span>
  );
}
