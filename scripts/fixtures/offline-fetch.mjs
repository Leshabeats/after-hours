// Loaded only by production-smoke.mjs. Exercise fallback without external services.
globalThis.fetch = async () => {
  throw new Error("External fetch is disabled in the production smoke fixture.");
};
