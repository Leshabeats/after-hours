import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountProvider, useAccount } from "./account-session";
import { useNightLog } from "@/lib/night-log";
import { SEED_MISSIONS } from "@/lib/seed";
import { entryFromMission, type AuthSnapshot } from "@/lib/journal/types";
import { deviceUploadFlagKey } from "@/lib/journal/import";

const api = vi.hoisted(() => ({
  dropNight: vi.fn(), getAuthSnapshot: vi.fn(), importDeviceJournal: vi.fn(),
  setNightStatus: vi.fn(), signOut: vi.fn(), takeNight: vi.fn(),
}));
const notifications = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/lib/journal/api", () => api);
vi.mock("sonner", () => notifications);

const mission = SEED_MISSIONS[0];
const entry = entryFromMission(mission);
const anonymous: AuthSnapshot = { configured: true, user: null, entries: null };
const signedIn: AuthSnapshot = {
  configured: true,
  user: { id: "user-1", login: "user-1", name: "User", avatarUrl: "" },
  entries: [],
};

let root: Root;
let container: HTMLDivElement;
let account: ReturnType<typeof useAccount>;
function Probe() {
  account = useAccount();
  return <div>{account.entries.map((item) => `${item.id}:${item.status}`).join(",")}</div>;
}

async function render(initial: AuthSnapshot) {
  await act(async () => {
    root.render(<AccountProvider initial={initial}><Probe /></AccountProvider>);
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  localStorage.clear();
  useNightLog.setState({ entries: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("local journal", () => {
  it("takes, updates and removes anonymous entries without contacting the server", async () => {
    for (const call of [api.takeNight, api.setNightStatus, api.dropNight]) {
      call.mockRejectedValue(new TypeError("offline"));
    }
    await render(anonymous);
    await act(async () => account.take(mission));
    expect(account.entries[0]?.id).toBe(mission.id);
    expect(JSON.parse(localStorage.getItem("after-hours-log")!).state.entries).toHaveLength(1);
    await act(async () => account.setStatus(mission.id, "shipped"));
    expect(account.entries[0]?.status).toBe("shipped");
    await act(async () => account.drop(mission.id));
    expect(account.entries).toEqual([]);
    expect(JSON.parse(localStorage.getItem("after-hours-log")!).state.entries).toEqual([]);
    expect(api.takeNight).not.toHaveBeenCalled();
    expect(api.setNightStatus).not.toHaveBeenCalled();
    expect(api.dropNight).not.toHaveBeenCalled();
  });

  it("keeps signed-in mutations on the server and does not hide network errors locally", async () => {
    await render(signedIn);
    api.takeNight.mockRejectedValueOnce(new TypeError("offline"));
    await expect(account.take(mission)).rejects.toThrow("offline");
    expect(useNightLog.getState().entries).toEqual([]);
    api.takeNight.mockResolvedValueOnce({ ok: "account", entries: [entry] });
    await act(async () => account.take(mission));
    expect(account.entries).toEqual([entry]);
    expect(useNightLog.getState().entries).toEqual([]);
  });
});

describe("device journal import", () => {
  it("stops after an error and retries only when the user requests it", async () => {
    useNightLog.setState({ entries: [entry] });
    api.importDeviceJournal.mockRejectedValueOnce(new Error("unavailable"));
    // Keep a broken automatic retry bounded so this regression fails without a loop.
    api.importDeviceJournal.mockImplementation(() => new Promise(() => {}));
    await render(signedIn);
    expect(api.importDeviceJournal).toHaveBeenCalledTimes(1);
    expect(notifications.toast).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(deviceUploadFlagKey("user-1"))).toBeNull();
    await act(async () => useNightLog.setState({ entries: [{ ...entry }] }));
    expect(api.importDeviceJournal).toHaveBeenCalledTimes(1);
    const retry = notifications.toast.mock.calls[0][1].action;
    expect(retry.label).toBe("Повторить");
    api.importDeviceJournal.mockResolvedValueOnce({ ok: "imported", entries: [entry], skipped: 0 });
    await act(async () => retry.onClick());
    expect(api.importDeviceJournal).toHaveBeenCalledTimes(2);
    expect(account.entries).toEqual([entry]);
    expect(localStorage.getItem(deviceUploadFlagKey("user-1"))).toBe("1");
  });

  it("releases mutations after a failed import without launching another import", async () => {
    useNightLog.setState({ entries: [entry] });
    api.importDeviceJournal.mockRejectedValueOnce(new Error("unavailable"));
    api.importDeviceJournal.mockImplementation(() => new Promise(() => {}));
    await render(signedIn);
    api.takeNight.mockResolvedValueOnce({ ok: "account", entries: [entry] });
    await act(async () => account.take(mission));
    expect(api.takeNight).toHaveBeenCalledTimes(1);
    expect(api.importDeviceJournal).toHaveBeenCalledTimes(1);
  });

  it("does not retry for an account that has signed out", async () => {
    useNightLog.setState({ entries: [entry] });
    api.importDeviceJournal.mockRejectedValueOnce(new Error("unavailable"));
    api.importDeviceJournal.mockImplementation(() => new Promise(() => {}));
    await render(signedIn);
    const retry = notifications.toast.mock.calls[0][1].action.onClick;
    api.signOut.mockResolvedValue({ ok: true });
    api.getAuthSnapshot.mockResolvedValue(anonymous);
    await act(async () => account.signOutUser());
    await act(async () => retry());
    expect(api.importDeviceJournal).toHaveBeenCalledTimes(1);
    expect(account.source).toBe("device");
  });
});
