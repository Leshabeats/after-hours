export type DeviceUploadDecision = "upload" | "keep-server" | "skip";

export const MAX_DEVICE_IMPORT = 200;

export const DEVICE_UPLOAD_FLAG_PREFIX = "after-hours-log-uploaded:";

type FlagStorage = Pick<Storage, "getItem" | "setItem">;

export function deviceUploadFlagKey(userId: string) {
  return `${DEVICE_UPLOAD_FLAG_PREFIX}${userId}`;
}

export function readDeviceUploadFlag(userId: string, storage?: FlagStorage | null) {
  if (!storage) return false;
  try {
    return storage.getItem(deviceUploadFlagKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function writeDeviceUploadFlag(userId: string, storage?: FlagStorage | null) {
  if (!storage) return;
  try {
    storage.setItem(deviceUploadFlagKey(userId), "1");
  } catch {
    // private mode / quota
  }
}

export function decideDeviceJournalUpload(input: {
  signedIn: boolean;
  serverCount: number;
  localCount: number;
  alreadyAttempted: boolean;
}): DeviceUploadDecision {
  if (!input.signedIn || input.alreadyAttempted || input.localCount <= 0) {
    return "skip";
  }
  if (input.serverCount > 0) return "keep-server";
  return "upload";
}
