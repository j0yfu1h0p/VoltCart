import Redis from 'ioredis';

const redisConfig = {
  // eslint-disable-next-line no-undef
  host: process.env.REDIS_HOST,
  // eslint-disable-next-line no-undef
  port: Number(process.env.REDIS_PORT || 6379),
  password:
    // eslint-disable-next-line no-undef
    process.env.REDIS_PASSWORD,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 200, 2000),
  lazyConnect: true,
  connectTimeout: 10000,
};

const redisClient = new Redis(redisConfig);

redisClient.on("connect", () => {
  console.log("Redis connection established");
});

redisClient.on("ready", () => {
  console.log("Redis is ready");
});

redisClient.on("error", (error) => {
  console.error("Redis connection error:", error.message);
});

redisClient.on("close", () => {
  console.log("Redis connection closed");
});

export { redisClient };
