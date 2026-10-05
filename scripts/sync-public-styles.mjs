import { copyFile, mkdir } from "node:fs/promises";

// A stable URL survives navigation in tabs opened before a deployment.
// Keep app/globals.css as the single source for both stylesheet versions.
await mkdir("public/styles", { recursive: true });
await copyFile("app/globals.css", "public/styles/luxury-finds.css");
