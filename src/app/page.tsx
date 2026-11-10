import { InsightsApp } from "@/components/insights/InsightsApp";
import { loadInsights } from "@/lib/insights";
import { loadPointsDrivers } from "@/lib/pointsDrivers";
import { loadDeepInsights } from "@/lib/deepInsights";
import { loadBigNights } from "@/lib/bigNights";
import { loadPlayerConditions } from "@/lib/playerConditions";
import { loadPlayerSplitsInsights } from "@/lib/playerSplits";

export default function Home() {
  return <InsightsApp data={{ insights: loadInsights(), splits: loadPlayerSplitsInsights(), drivers: loadPointsDrivers(), deep: loadDeepInsights(), bn: loadBigNights(), pc: loadPlayerConditions() }} />;
}
