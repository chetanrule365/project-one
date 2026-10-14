import { isMongoConfigured, mongoCollection } from "../mongo.server";

type KvDoc = {
  _id: string;
  value: unknown;
  updatedAt: string;
};

function stripUndefined(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export type KvResult<T> =
  | { ok: true; value: T | null; updatedAt: string | null }
  | { ok: false };

export async function kvGet<T>(key: string): Promise<KvResult<T>> {
  if (!isMongoConfigured()) return { ok: true, value: null, updatedAt: null };
  const col = await mongoCollection<KvDoc>("kv");
  if (!col) return { ok: false };
  try {
    const doc = await col.findOne({ _id: key });
    if (!doc) return { ok: true, value: null, updatedAt: null };
    return {
      ok: true,
      value: (doc.value as T) ?? null,
      updatedAt: doc.updatedAt ?? null,
    };
  } catch (error) {
    console.error(`[mongo] kvGet ${key} failed`, error);
    return { ok: false };
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  if (!isMongoConfigured()) return;
  const col = await mongoCollection<KvDoc>("kv");
  if (!col) return;
  try {
    const updatedAt = new Date().toISOString();
    await col.updateOne(
      { _id: key },
      { $set: { value: stripUndefined(value), updatedAt } },
      { upsert: true },
    );
  } catch (error) {
    console.error(`[mongo] kvSet ${key} failed`, error);
  }
}

export async function kvDelete(key: string): Promise<void> {
  if (!isMongoConfigured()) return;
  const col = await mongoCollection<KvDoc>("kv");
  if (!col) return;
  try {
    await col.deleteOne({ _id: key });
  } catch (error) {
    console.error(`[mongo] kvDelete ${key} failed`, error);
  }
}
