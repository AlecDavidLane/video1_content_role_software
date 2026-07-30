import { useEffect, useRef } from "react";

export interface LiveEvent {
  type: string;
  at?: string;
  payload: Record<string, unknown>;
}

/* Subscribe to the appliance's live event stream with auto-reconnect.
 * Live status is what makes phone control feel immediate (FR-09). */
export function useLiveEvents(onEvent: (event: LiveEvent) => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/api/v1/events`);
      ws.onmessage = (msg) => {
        try {
          handler.current(JSON.parse(msg.data));
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);
}
