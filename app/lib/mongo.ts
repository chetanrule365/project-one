import { setDefaultResultOrder, setServers } from "node:dns";
import { MongoClient, type Collection, type Db, type Document } from "mongodb";

setDefaultResultOrder("ipv4first");
if (process.platform === "win32") {
  setServers(["8.8.8.8", "1.1.1.1"]);
}

const globalForMongo = globalThis as typeof globalThis & {
  __mongo?: {
    client: MongoClient | null;
    db: Db | null;
    connecting: Promise<Db | null> | null;
    failedAt: number;
  };
};

function memory() {
  if (!globalForMongo.__mongo) {
    globalForMongo.__mongo = {
      client: null,
      db: null,
      connecting: null,
      failedAt: 0,
    };
  }
  return globalForMongo.__mongo;
}

export function mongoUri() {
  return process.env.MONGODB_URI?.trim() || "";
}

export function isMongoConfigured() {
  return Boolean(mongoUri());
}

function mongoDbName() {
  return process.env.MONGODB_DB?.trim() || "project-one";
}

export async function getMongoDb(): Promise<Db | null> {
  const mem = memory();
  if (mem.db) return mem.db;
  if (mem.failedAt && Date.now() - mem.failedAt < 15_000) return null;
  const uri = mongoUri();
  if (!uri) return null;
  if (mem.connecting) return mem.connecting;
  mem.connecting = (async () => {
    try {
      const client = new MongoClient(uri, {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 12_000,
        family: 4,
      });
      await client.connect();
      mem.client = client;
      mem.db = client.db(mongoDbName());
      console.log(`[mongo] connected db=${mongoDbName()}`);
      return mem.db;
    } catch (error) {
      mem.failedAt = Date.now();
      console.error("[mongo] connect failed", error);
      return null;
    } finally {
      mem.connecting = null;
    }
  })();
  return mem.connecting;
}

export async function mongoCollection<T extends Document>(name: string) {
  const db = await getMongoDb();
  if (!db) return null;
  return db.collection<T>(name) as Collection<T>;
}
