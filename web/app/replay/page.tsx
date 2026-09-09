"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { ReplayClient } from "@/components/ReplayClient";

function ResolveSeed() {
  const params = useSearchParams();
  const seed = parseInt(params.get("seed") ?? "0", 10) || 0;
  return <ReplayClient seed={seed} />;
}

/**
 * Query-based replay (works for ANY seed under static export):
 *   /replay?seed=1337&preset=the_weave&law=apn&N=4
 */
export default function ReplayQueryPage() {
  return (
    <Suspense fallback={<div className="py-10 text-muted">Loading…</div>}>
      <ResolveSeed />
    </Suspense>
  );
}
