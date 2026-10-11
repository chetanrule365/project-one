import { gzipSync, gunzipSync } from "node:zlib";
import { Binary } from "mongodb";
import { isMongoConfigured, mongoCollection } from "../mongo";

const uploaded = new Set<string>();
const MAX_GZIP_BYTES = 15 * 1024 * 1024;

type BlobDoc = {
  _id: string;
  gzip: Binary;
  updatedAt: Date;
};

function gzipBytes(json: string) {
  return gzipSync(Buffer.from(json, "utf8"));
}

function gunzipBytes(data: Binary | Uint8Array | Buffer) {
  const raw =
    data instanceof Binary ? Buffer.from(data.buffer) : Buffer.from(data);
  return gunzipSync(raw).toString("utf8");
}

export async function blobGetJson(objectPath: string): Promise<string | null> {
  const result = await blobReadJson(objectPath);
  return result.ok ? result.json : null;
}

export async function blobReadJson(
  objectPath: string,
): Promise<
  | { ok: true; json: string | null; updatedAtMs: number }
  | { ok: false }
> {
  if (!isMongoConfigured()) {
    return { ok: true, json: null, updatedAtMs: 0 };
  }
  const col = await mongoCollection<BlobDoc>("blobs");
  if (!col) return { ok: false };
  try {
    const doc = await col.findOne({ _id: objectPath });
    if (!doc?.gzip) return { ok: true, json: null, updatedAtMs: 0 };
    const json = gunzipBytes(doc.gzip);
    const updatedAtMs =
      doc.updatedAt instanceof Date
        ? doc.updatedAt.getTime()
        : Date.parse(String(doc.updatedAt ?? "")) || 0;
    return { ok: true, json, updatedAtMs };
  } catch (error) {
    console.error(`[mongo] read ${objectPath} failed`, error);
    return { ok: false };
  }
}

export async function blobSetJson(
  objectPath: string,
  json: string,
  opts?: { once?: boolean },
): Promise<void> {
  if (!isMongoConfigured()) return;
  if (opts?.once && uploaded.has(objectPath)) return;
  const col = await mongoCollection<BlobDoc>("blobs");
  if (!col) return;
  if (opts?.once) uploaded.add(objectPath);
  try {
    const body = gzipBytes(json);
    if (body.length > MAX_GZIP_BYTES) {
      console.error(
        `[mongo] skip ${objectPath} gzip ${body.length} bytes exceeds 16MB document cap`,
      );
      if (opts?.once) uploaded.delete(objectPath);
      return;
    }
    await col.updateOne(
      { _id: objectPath },
      { $set: { gzip: new Binary(new Uint8Array(body)), updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (error) {
    if (opts?.once) uploaded.delete(objectPath);
    console.error(`[mongo] upload ${objectPath} failed`, error);
  }
}
