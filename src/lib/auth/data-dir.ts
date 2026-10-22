import { resolve } from "node:path";

/** Use an absolute DATA_DIR to keep the same database across release directories. */
export function dataDirectory() {
  return resolve(process.env.DATA_DIR?.trim() || "data");
}
