import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  dropNight,
  getAuthSnapshot,
  setNightStatus,
  signOut,
  takeNight,
} from "@/lib/journal/api";
import type { AuthSnapshot, LogEntry, LogStatus } from "@/lib/journal/types";
import { entryFromMission } from "@/lib/journal/types";
import type { Mission } from "@/lib/kinds";
import { useNightLog } from "@/lib/night-log";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

type AccountContextValue = {
  configured: boolean;
  user: AuthSnapshot["user"];
  entries: LogEntry[];
  source: "account" | "device";
  take: (mission: Mission) => Promise<void>;
  setStatus: (id: string, status: LogStatus) => Promise<void>;
  drop: (id: string) => Promise<void>;
  signOutUser: () => Promise<void>;
};

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({
  initial,
  children,
}: {
  initial: AuthSnapshot;
  children: ReactNode;
}) {
  const localEntries = useNightLog((s) => s.entries);
  const localTake = useNightLog((s) => s.take);
  const localSetStatus = useNightLog((s) => s.setStatus);
  const localDrop = useNightLog((s) => s.drop);
  const hydrated = useHydrated();
  const [snapshot, setSnapshot] = useState(initial);

  const source: AccountContextValue["source"] = snapshot.user
    ? "account"
    : "device";
  const entries = useMemo(() => {
    if (source === "account") return snapshot.entries ?? [];
    return hydrated ? localEntries : [];
  }, [source, snapshot.entries, hydrated, localEntries]);

  const take = useCallback(
    async (mission: Mission) => {
      const result = await takeNight({ data: entryFromMission(mission) });
      if (result.ok === "anonymous") {
        localTake(mission);
        return;
      }
      setSnapshot((prev) => ({ ...prev, entries: result.entries }));
    },
    [localTake],
  );

  const setStatus = useCallback(
    async (id: string, status: LogStatus) => {
      const result = await setNightStatus({ data: { id, status } });
      if (result.ok === "anonymous") {
        localSetStatus(id, status);
        return;
      }
      if (result.ok === "account") {
        setSnapshot((prev) => ({ ...prev, entries: result.entries }));
      }
    },
    [localSetStatus],
  );

  const drop = useCallback(
    async (id: string) => {
      const result = await dropNight({ data: { id } });
      if (result.ok === "anonymous") {
        localDrop(id);
        return;
      }
      if (result.ok === "account") {
        setSnapshot((prev) => ({ ...prev, entries: result.entries }));
      }
    },
    [localDrop],
  );

  const signOutUser = useCallback(async () => {
    await signOut();
    const next = await getAuthSnapshot();
    setSnapshot(next);
  }, []);

  const value = useMemo(
    () => ({
      configured: snapshot.configured,
      user: snapshot.user,
      entries,
      source,
      take,
      setStatus,
      drop,
      signOutUser,
    }),
    [
      snapshot.configured,
      snapshot.user,
      entries,
      source,
      take,
      setStatus,
      drop,
      signOutUser,
    ],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

/** Hook is exported next to the provider on purpose. */
export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) {
    throw new Error("useAccount must be used inside AccountProvider");
  }
  return value;
}

export function AccountControl({ className }: { className?: string }) {
  const { configured, user, signOutUser } = useAccount();
  if (!configured && !user) return null;

  if (user) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="size-7 rounded-full"
            width={28}
            height={28}
          />
        ) : null}
        <span className="hidden font-mono text-xs text-muted sm:inline">
          {user.login}
        </span>
        <Button type="button" size="sm" variant="quiet" onClick={() => void signOutUser()}>
          Выйти
        </Button>
      </div>
    );
  }

  return (
    <Button asChild size="sm" variant="ghost" className={className}>
      <a href="/api/auth/github">Войти</a>
    </Button>
  );
}

export function notifyTaken() {
  toast("Ночь записана в журнал");
}
