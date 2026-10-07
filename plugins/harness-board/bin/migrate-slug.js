#!/usr/bin/env node
import { migrateSlugBuckets } from "../lib/migrate-slug.js";
import { defaultDataRoot } from "../lib/store.js";

const dataRoot = process.env.HARNESS_BOARD_DATA_ROOT;

async function main() {
  const root = defaultDataRoot(dataRoot);
  const result = await migrateSlugBuckets(dataRoot);
  console.log(
    `harness-board migrate-slug: root=${root} scanned=${result.bucketsScanned} slugBuckets=${result.slugBucketsWritten} removed=${result.legacyDirsRemoved}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
