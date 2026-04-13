import { RateLimiterMemory, RateLimiterRedis } from "rate-limiter-flexible";

import { redisClient } from "../../configs/redis.config.js";

const getIp = (req) =>
  req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
  req.socket?.remoteAddress ||
  req.ip ||
  "unknown";

const getEmail = (req) =>
  String(req.body?.email || "")
    .toLowerCase()
    .trim();

const buildLimiter = ({
  keyPrefix,
  points,
  duration,
  blockDuration,
  message,
  getKey,
}) => {
  const limiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix,
    points,
    duration,
    blockDuration,
    insuranceLimiter: new RateLimiterMemory({
      keyPrefix: `${keyPrefix}_fallback`,
      points,
      duration,
      blockDuration,
    }),
  });

  return async (req, res, next) => {
    try {
      const key = getKey(req);
      const rate = await limiter.consume(key, 1);

      res.set({
        "X-RateLimit-Limit": String(points),
        "X-RateLimit-Remaining": String(rate.remainingPoints),
        "X-RateLimit-Reset": new Date(
          Date.now() + rate.msBeforeNext,
        ).toISOString(),
      });

      return next();
    } catch (rejRes) {
      const retryAfter = Math.ceil((rejRes?.msBeforeNext || 1000) / 1000);
      res.set({ "Retry-After": String(retryAfter) });
      return res.status(429).json({
        success: false,
        message,
        retryAfter,
      });
    }
  };
};

export const registerRateLimiter = buildLimiter({
  keyPrefix: "auth_register_rl",
  points: 10,
  duration: 60 * 15,
  blockDuration: 60 * 30,
  message: "Too many registration attempts. Try again later.",
  getKey: (req) => `ip:${getIp(req)}`,
});

export const refreshTokenRateLimiter = buildLimiter({
  keyPrefix: "auth_refresh_rl",
  points: 30,
  duration: 60 * 10,
  blockDuration: 60 * 15,
  message: "Too many token refresh attempts. Try again later.",
  getKey: (req) => `ip:${getIp(req)}`,
});

export const emailActionRateLimiter = buildLimiter({
  keyPrefix: "auth_email_action_rl",
  points: 6,
  duration: 60 * 10,
  blockDuration: 60 * 30,
  message: "Too many email-related requests. Try again later.",
  getKey: (req) => {
    const email = getEmail(req) || "unknown";
    return `${email}:${getIp(req)}`;
  },
});

export const tokenVerificationRateLimiter = buildLimiter({
  keyPrefix: "auth_token_verify_rl",
  points: 20,
  duration: 60 * 10,
  blockDuration: 60 * 15,
  message: "Too many token verification attempts. Try again later.",
  getKey: (req) => `ip:${getIp(req)}`,
});
