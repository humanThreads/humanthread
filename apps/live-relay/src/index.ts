export * from "./router";
export * from "./server";

import { pathToFileURL } from "node:url";

import { main } from "./server";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Live relay failed");
    process.exitCode = 1;
  });
}
