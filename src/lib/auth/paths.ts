import { isAbsolute, join, resolve } from "node:path";

/** SQLite and the local auth secret. Unset DATA_DIR keeps `<cwd>/data`. */
export function dataDir() {
  const fromEnv = process.env.DATA_DIR?.trim();
  if (!fromEnv) return join(process.cwd(), "data");
  return isAbsolute(fromEnv) ? fromEnv : resolve(fromEnv);
}
