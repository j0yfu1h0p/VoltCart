import { RateLimiterMemory, RateLimiterRedis } from "rate-limiter-flexible";

import { redisClient } from "../../configs/redis.config.js";

const accountLockByIpLimiter = new RateLimiterRedis({
  points: 300, // 300 login requests
  duration: 60 * 5, // per 5 minutes
  blockDuration: 60 * 10, // block for 10 minutes after limit is reached
  storeClient: redisClient,
  keyPrefix: "login_ip_rl",
  insuranceLimiter: new RateLimiterMemory({
    keyPrefix: "login_ip_rl_fallback",
    points: 20,
    duration: 60,
    blockDuration: 60 * 10,
  }),
});

const accountLockByEmailIpLimiter = new RateLimiterRedis({
  points: 5, // 5 attempts
  duration: 60 * 10, // per 10 minutes
  blockDuration: 60 * 60, // block for 1 hour after limit is reached
  storeClient: redisClient,
  keyPrefix: "login_email_ip_rl",
  insuranceLimiter: new RateLimiterMemory({
    keyPrefix: "login_email_ip_rl_fallback",
    points: 5,
    duration: 60 * 10,
    blockDuration: 60 * 60,
  }),
});

const getIp = (req) => {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.ip;
  return ip;
};

const getEmailIpKey = (req, ip) => {
  const email = String(req.body?.email || "unknown")
    .toLowerCase()
    .trim();
  return `${email}:${ip}`;
};

export const accountLockLoginRateLimiter = async (req, res, next) => {
  try {
    const ip = getIp(req);
    const emailIpKey = getEmailIpKey(req, ip);

    await accountLockByIpLimiter.consume(ip, 1);
    await accountLockByEmailIpLimiter.consume(emailIpKey, 1);

    return next();
  } catch (rejRes) {
    const retryAfter = Math.ceil(rejRes.msBeforeNext / 1000);

    res.set({
      "Retry-After": retryAfter,
    });

    return res.status(429).json({
      success: false,
      message: "Too many login attempts. Try again later.",
      retryAfter,
    });
  }
};
