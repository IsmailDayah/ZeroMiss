import { ReplayClient } from "@/components/ReplayClient";

/**
 * Pretty path replay `/replay/<seed>`. Under static export only the
 * pre-listed seeds are generated; the query form `/replay?seed=` handles arbitrary seeds.
 * The listed seeds cover every preset plus a small range used by the demo links + E2E.
 */
export function generateStaticParams() {
  const presetSeeds = [0, 5, 7, 21, 42, 99, 1337, 2024];
  const small = Array.from({ length: 20 }, (_, i) => i);
  const all = Array.from(new Set([...presetSeeds, ...small]));
  return all.map((s) => ({ seed: String(s) }));
}

export const dynamicParams = false;

export default async function ReplaySeedPage({ params }: { params: Promise<{ seed: string }> }) {
  const { seed: seedStr } = await params;
  const seed = parseInt(seedStr, 10) || 0;
  return <ReplayClient seed={seed} />;
}
