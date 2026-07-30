import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, setUnauthorizedHandler } from "./api";
import { useLiveEvents } from "./ws";
import type { SoakState, Status } from "./types";

interface AppCtx {
  status: Status | null;
  refresh: () => Promise<void>;
  needsPin: boolean;
  setNeedsPin: (value: boolean) => void;
  lastFault: string | null;
  clearFault: () => void;
}

const Ctx = createContext<AppCtx>({
  status: null,
  refresh: async () => {},
  needsPin: false,
  setNeedsPin: () => {},
  lastFault: null,
  clearFault: () => {},
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [needsPin, setNeedsPin] = useState(false);
  const [lastFault, setLastFault] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.get<Status>("/api/v1/status"));
    } catch {
      /* status endpoint is public; failure means backend down */
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setNeedsPin(true));
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  useLiveEvents((event) => {
    if (event.type === "pattern" || event.type === "output" || event.type === "audio") {
      void refresh();
    } else if (event.type === "fault") {
      setLastFault(String(event.payload.message ?? "Fault detected"));
      void refresh();
    } else if (event.type === "recovery") {
      setLastFault(null);
      void refresh();
    } else if (event.type === "soak_step" || event.type === "soak_complete") {
      setStatus((previous) =>
        previous
          ? {
              ...previous,
              soak:
                event.type === "soak_complete"
                  ? { running: false }
                  : (event.payload as unknown as SoakState),
            }
          : previous
      );
    }
  });

  return (
    <Ctx.Provider
      value={{
        status,
        refresh,
        needsPin,
        setNeedsPin,
        lastFault,
        clearFault: () => setLastFault(null),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useApp(): AppCtx {
  return useContext(Ctx);
}
