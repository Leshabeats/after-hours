import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Kind, Mission } from "@/lib/kinds";

export type LogStatus = "taken" | "shipping" | "shipped";

export type LogEntry = {
  id: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  kind: Kind;
  url: string;
  isPr: boolean;
  status: LogStatus;
  takenAt: number;
};

type NightLogState = {
  entries: LogEntry[];
  take: (mission: Mission) => void;
  setStatus: (id: string, status: LogStatus) => void;
  drop: (id: string) => void;
};

export const useNightLog = create<NightLogState>()(
  persist(
    (set, get) => ({
      entries: [],
      take: (mission) => {
        const existing = get().entries.find((e) => e.id === mission.id);
        if (existing) return;
        set({
          entries: [
            {
              id: mission.id,
              owner: mission.owner,
              repo: mission.repo,
              number: mission.number,
              title: mission.title,
              kind: mission.kind,
              url: mission.url,
              isPr: mission.isPr,
              status: "taken",
              takenAt: Date.now(),
            },
            ...get().entries,
          ],
        });
      },
      setStatus: (id, status) =>
        set({
          entries: get().entries.map((e) =>
            e.id === id ? { ...e, status } : e,
          ),
        }),
      drop: (id) =>
        set({
          entries: get().entries.filter((e) => e.id !== id),
        }),
    }),
    { name: "after-hours-log" },
  ),
);
