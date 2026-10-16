import { localProvider } from "./local.js";
import { mutsakiProvider } from "./mutsaki.js";

const available = new Map([
  [localProvider.id, localProvider],
  [mutsakiProvider.id, mutsakiProvider]
]);

export function configuredProviders(value = process.env.AUTH_PROVIDERS || "local") {
  const ids = value.split(",").map((id) => id.trim().toLowerCase()).filter(Boolean);
  if (!ids.length || new Set(ids).size !== ids.length || ids.some((id) => !available.has(id))) {
    throw new Error("AUTH_PROVIDERS must be a comma-separated list of: local,mutsaki");
  }
  return ids.map((id) => available.get(id));
}

export function installProviders(app, dependencies) {
  const providers = configuredProviders();
  for (const provider of providers) provider.install(app, dependencies);
  app.get("/auth/providers", (_req, res) => {
    res.json({ providers: providers.map(({ id, label }) => ({ id, label })) });
  });
}
