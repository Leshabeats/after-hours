import { resolve } from "node:path";

/** Point this at a persistent volume in production; keep existing local data. */
export function dataDirectory() {
  return resolve(process.env.DATA_DIR?.trim() || "data");
}
