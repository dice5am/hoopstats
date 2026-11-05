import { InsightsHome } from "@/components/InsightsHome";
import { loadInsights } from "@/lib/insights";

export default function Home() {
  const data = loadInsights();
  return <InsightsHome data={data} />;
}
