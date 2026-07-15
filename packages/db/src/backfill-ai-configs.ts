import { db } from "./index.ts";
import { backfillLegacyAIConfigs } from "./ai-config-backfill.ts";

try {
  const result = await backfillLegacyAIConfigs();
  console.log(`AI config backfill complete: ${result.global} global, ${result.personal} personal legacy records processed.`);
} finally {
  await db.$disconnect();
}
