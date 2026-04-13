import crypto from "node:crypto";

import IdempotencyKey from "../models/idempotency-key.model.js";

const stable_stringify = (value) => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stable_stringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${stable_stringify(value[key])}`,
  );

  return `{${entries.join(",")}}`;
};

const get_request_hash = (payload) =>
  crypto.createHash("sha256").update(stable_stringify(payload)).digest("hex");

export const get_idempotency_replay = async ({
  key,
  scope,
  user_id,
  payload,
}) => {
  const request_hash = get_request_hash(payload);

  const existing = await IdempotencyKey.findOne({
    key,
    scope,
    user_id: user_id || null,
  });

  if (!existing) {
    return { replay: false, request_hash };
  }

  if (existing.request_hash !== request_hash) {
    const error = new Error(
      "Idempotency key was already used with a different request payload",
    );
    error.status_code = 409;
    throw error;
  }

  return {
    replay: true,
    request_hash,
    status_code: existing.status_code,
    response_body: existing.response_body,
  };
};

export const save_idempotency_result = async ({
  key,
  scope,
  user_id,
  request_hash,
  status_code,
  response_body,
}) => {
  await IdempotencyKey.findOneAndUpdate(
    {
      key,
      scope,
      user_id: user_id || null,
    },
    {
      $set: {
        request_hash,
        status_code,
        response_body,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    },
    { upsert: true, returnDocument: "after" },
  );
};

export const require_idempotency_key = (req, res, next) => {
  const key = req.get("x-idempotency-key");

  if (!key || typeof key !== "string" || !key.trim()) {
    return res.status(400).json({
      success: false,
      message: "x-idempotency-key header is required",
    });
  }

  req.idempotency_key = key.trim();
  return next();
};
