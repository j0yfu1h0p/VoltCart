import {
  RateLimiterMemory,
  RateLimiterRedis,
} from 'rate-limiter-flexible';

import { redisClient } from '../../configs/redis.config.js';

// ===== 1. RATE LIMITER CONFIG =====
const authLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: "auth_rl",
  points: 20, // 20 attempts
  duration: 60, // per 60 seconds
  blockDuration: 60 * 10, // 10-min block after limit exceeded
  insuranceLimiter: new RateLimiterMemory({
    keyPrefix: "auth_rl_fallback",
    points: 20,
    duration: 60,
    blockDuration: 60 * 10,
  }),
});

// ===== 2. SAFE KEY GENERATION =====
const getKey = (req) => {
  // priority: user > IP
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.ip;

  return req.user?.id ? `user:${req.user.id}` : `ip:${ip}`;
};

// ===== 3. MIDDLEWARE =====
export const authRateLimiter = async (req, res, next) => {
  try {
    const key = getKey(req);

    const rate = await authLimiter.consume(key, 1);

    // optional: send helpful headers
    res.set({
      "X-RateLimit-Limit": authLimiter.points,
      "X-RateLimit-Remaining": rate.remainingPoints,
      "X-RateLimit-Reset": new Date(
        Date.now() + rate.msBeforeNext,
      ).toISOString(),
    });

    return next();
  } catch (rejRes) {
    const retryAfter = Math.ceil(rejRes.msBeforeNext / 1000);

    res.set({
      "Retry-After": retryAfter,
    });

    return res.status(429).json({
      success: false,
      message: "Too many requests. Try again later.",
      retryAfter,
    });
  }
};
