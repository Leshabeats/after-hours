import { z } from "zod";

// Recognized SPDX identifiers for open-source software. Unknown licenses and
// GitHub's NOASSERTION require a future explicit verification before admission.
const OSS_LICENSES = new Set([
  "0BSD",
  "Apache-1.1",
  "Apache-2.0",
  "Artistic-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSL-1.0",
  "ECL-2.0",
  "EPL-1.0",
  "EPL-2.0",
  "EUPL-1.1",
  "EUPL-1.2",
  "ISC",
  "MIT",
  "MPL-1.1",
  "MPL-2.0",
  "MulanPSL-2.0",
  "NCSA",
  "OFL-1.1",
  "OSL-3.0",
  "PostgreSQL",
  "Python-2.0",
  "Unlicense",
  "UPL-1.0",
  "WTFPL",
  "Zlib",
  ...["AGPL-3.0", "GPL-2.0", "GPL-3.0", "LGPL-2.0", "LGPL-2.1", "LGPL-3.0"].flatMap((id) => [
    id,
    id + "-only",
    id + "-or-later",
  ]),
]);
const licenseId = z.object({ spdx_id: z.string() });

export function readOssLicense(raw: unknown): string | null {
  const license = licenseId.safeParse(raw).data?.spdx_id;
  return license && OSS_LICENSES.has(license) ? license : null;
}
