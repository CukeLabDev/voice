import { copyFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
copyFileSync(new URL("LICENSE", root), new URL("client/dist/LICENSE", root));
writeFileSync(
  new URL("client/dist/_routes.json", root),
  JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] })
);
