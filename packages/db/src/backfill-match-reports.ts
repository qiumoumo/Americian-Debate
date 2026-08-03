import { db } from "./index.ts";
import { backfillLegacyMatchReports } from "./match-report-backfill.ts";

try {
  const result = await backfillLegacyMatchReports();
  console.log(
    `Match report backfill complete: ${result.processed} match(es) checked, ${result.submitted} submitted, ${result.positioned} outcome position(s) normalized.`
  );
} finally {
  await db.$disconnect();
}
