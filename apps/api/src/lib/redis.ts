import Redis from "ioredis";

export function createRedis(url: string): Redis {
  const client = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  client.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.error("[redis]", error.message);
  });
  return client;
}

export type RedisClient = Redis;
