import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Mission } from "@/lib/kinds";
import { entryFromMission, type LogEntry, type LogStatus } from "@/lib/journal/types";

export type { LogEntry, LogStatus };

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
          entries: [entryFromMission(mission), ...get().entries],
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
