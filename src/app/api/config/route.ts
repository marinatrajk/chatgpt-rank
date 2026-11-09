import { analyzerModel } from "@/lib/analyze";
import { providerStatus } from "@/lib/providers";
import { PROVIDER_IDS, type AppConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  const config: AppConfig = {
    providers: PROVIDER_IDS.map(providerStatus),
    analyzer: { model: analyzerModel(), configured: Boolean(process.env.ANTHROPIC_API_KEY) },
  };
  return Response.json(config);
}
