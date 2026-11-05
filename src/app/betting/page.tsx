import { PointsFinder } from "@/components/PointsFinder";
import { loadPointsRows } from "@/lib/betting";

export default function BettingPage() {
  const rows = loadPointsRows();
  return <PointsFinder rows={rows} />;
}
