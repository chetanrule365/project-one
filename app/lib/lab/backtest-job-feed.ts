export type JobSnapshot = {
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

type Listener = () => void;

type JobPollGlobal = {
  __projectOneJobPoll?: number;
  __projectOneJobLast?: JobSnapshot | null;
  __projectOneJobListeners?: Set<Listener>;
};

const g = globalThis as typeof globalThis & JobPollGlobal;

const POLL_URLS = ["/__backtest-job", "/api/backtest-job"];

function statusRank(status: JobSnapshot["status"]) {
  if (status === "done" || status === "error") return 2;
  if (status === "running") return 1;
  return 0;
}

/** Keep a newer run, or later progress on the same run. Drop stale SSE/HMR snapshots. */
export function preferJob(
  current: JobSnapshot | null | undefined,
  incoming: JobSnapshot,
): JobSnapshot {
  if (!current) return incoming;
  if (incoming.status === "idle" && current.status !== "running") {
    return incoming;
  }
  const curStart = Date.parse(current.startedAt ?? "") || 0;
  const nextStart = Date.parse(incoming.startedAt ?? "") || 0;
  const curFinish = Date.parse(current.finishedAt ?? "") || 0;
  if (nextStart > curStart && (curFinish === 0 || nextStart >= curFinish)) {
    return incoming;
  }
  if (nextStart < curStart) return current;
  if (statusRank(incoming.status) !== statusRank(current.status)) {
    return statusRank(incoming.status) > statusRank(current.status)
      ? incoming
      : current;
  }
  if (incoming.done !== current.done) {
    return incoming.done > current.done ? incoming : current;
  }
  return incoming;
}

function listeners() {
  if (!g.__projectOneJobListeners) g.__projectOneJobListeners = new Set();
  return g.__projectOneJobListeners;
}

function sameSnapshot(a: JobSnapshot, b: JobSnapshot) {
  return (
    a.status === b.status &&
    a.message === b.message &&
    a.done === b.done &&
    a.total === b.total &&
    a.cached === b.cached &&
    a.fetched === b.fetched &&
    a.resultId === b.resultId &&
    a.error === b.error &&
    a.startedAt === b.startedAt &&
    a.finishedAt === b.finishedAt
  );
}

function emit(job: JobSnapshot) {
  const next = preferJob(g.__projectOneJobLast, job);
  if (g.__projectOneJobLast && sameSnapshot(g.__projectOneJobLast, next)) return;
  g.__projectOneJobLast = next;
  for (const listener of listeners()) listener();
}

function parseJobPayload(text: string): JobSnapshot | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("<")) return null;
  try {
    const payload = JSON.parse(trimmed) as { job?: JobSnapshot };
    return payload.job ?? null;
  } catch {
    return null;
  }
}

function fetchSnapshot() {
  if (typeof window === "undefined") return;
  for (const path of POLL_URLS) {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", `${path}?t=${Date.now()}`);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("Cache-Control", "no-store");
    xhr.timeout = 4000;
    xhr.onload = () => {
      const job = parseJobPayload(xhr.responseText);
      if (job) emit(job);
    };
    xhr.send();
  }
}

export function startBacktestJobPolling() {
  if (typeof window === "undefined") return;
  if (g.__projectOneJobPoll != null) {
    window.clearInterval(g.__projectOneJobPoll);
  }
  fetchSnapshot();
  g.__projectOneJobPoll = window.setInterval(fetchSnapshot, 750);
}

export function lastBacktestJob() {
  return g.__projectOneJobLast ?? null;
}

export function subscribeBacktestJob(onStoreChange: Listener) {
  listeners().add(onStoreChange);
  startBacktestJobPolling();
  return () => {
    listeners().delete(onStoreChange);
  };
}
