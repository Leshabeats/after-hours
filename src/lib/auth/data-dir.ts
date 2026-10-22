import { resolve } from "node:path";

/** Directory for the development-only session signing secret. No application database files. */
export function dataDirectory() {
  return resolve(process.env.DATA_DIR?.trim() || "data");
}
