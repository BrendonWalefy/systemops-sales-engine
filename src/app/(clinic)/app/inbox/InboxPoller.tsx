"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useResourceVersion } from "@/components/use-resource-version";

const VERSION_POLL_INTERVAL_MS = 15_000;

type Props = {
  initialSignature: string;
};

export function InboxPoller({ initialSignature }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const refreshInbox = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  useResourceVersion("/api/inbox/check", {
    initialVersion: initialSignature,
    intervalMs: VERSION_POLL_INTERVAL_MS,
    onChange: refreshInbox,
  });

  return null;
}
