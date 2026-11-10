import { InsightsHome } from "@/components/InsightsHome";
import { loadInsights } from "@/lib/insights";
import { loadPointsDrivers } from "@/lib/pointsDrivers";
import { loadPlayerSplitsInsights } from "@/lib/playerSplits";

export default function Home() {
  const data = loadInsights();
  const playerSplits = loadPlayerSplitsInsights();
  const pointsDrivers = loadPointsDrivers();
  return (
    <InsightsHome
      data={data}
      playerSplits={playerSplits}
      pointsDrivers={pointsDrivers}
    />
  );
}
