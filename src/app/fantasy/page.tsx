import { Suspense } from "react";
import { PointsFinder } from "@/components/PointsFinder";
import { loadPointsRows } from "@/lib/betting";

/** Same player-points surface as Betting for now — kept as its own route for nav. */
export default function FantasyPage() {
  const rows = loadPointsRows();
  return (
    <Suspense fallback={<main><p>Loading…</p></main>}>
      <PointsFinder rows={rows} />
    </Suspense>
  );
}
