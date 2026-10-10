type JobSnapshot = {
  status: "idle" | "running" | "done" | "error";
  message: string;
  done: number;
  total: number;
  cached: number;
  fetched: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  resultId: number | null;
  pid: number | null;
};

type Listener = (job: JobSnapshot) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let lastJob: JobSnapshot | null = null;
let reconnectTimer: number | null = null;

function clearReconnect() {
  if (reconnectTimer != null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function connect() {
  if (typeof window === "undefined" || source) return;
  source = new EventSource("/api/backtest-job");
  source.addEventListener("job", (event) => {
    try {
      lastJob = JSON.parse((event as MessageEvent).data) as JobSnapshot;
      for (const listener of listeners) listener(lastJob);
    } catch {
      /* keep last */
    }
  });
  source.onerror = () => {
    source?.close();
    source = null;
    if (listeners.size === 0) return;
    clearReconnect();
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 1500);
  };
}

export function lastBacktestJob() {
  return lastJob;
}

export function subscribeBacktestJob(listener: Listener) {
  connect();
  listeners.add(listener);
  if (lastJob) listener(lastJob);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearReconnect();
    source?.close();
    source = null;
  };
}
