import { useEffect, useState } from "react";
import { useNightLog } from "@/lib/night-log";

export function useHydrated() {
  const [hydrated, setHydrated] = useState(() => {
    if (typeof window === "undefined") return false;
    return useNightLog.persist.hasHydrated();
  });

  useEffect(() => {
    if (useNightLog.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useNightLog.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  return hydrated;
}
