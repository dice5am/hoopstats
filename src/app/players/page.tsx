import { Suspense } from "react";
import { PointsFinder } from "@/components/PointsFinder";
import { loadPointsRows } from "@/lib/betting";

export default function PlayersPage() {
  const rows = loadPointsRows();
  return (
    <Suspense fallback={<main><p>Loading…</p></main>}>
      <PointsFinder rows={rows} />
    </Suspense>
  );
}
