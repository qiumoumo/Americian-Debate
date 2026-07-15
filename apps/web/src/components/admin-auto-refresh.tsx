"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AdminAutoRefresh({ intervalMs = 5_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, router]);
  return null;
}
