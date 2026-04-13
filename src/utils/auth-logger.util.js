import crypto from "node:crypto";

import AuthEvent from "../models/auth-event.model.js";

export const ensure_request_id = (req, res, next) => {
  const incoming_request_id = req.get("x-request-id");
  const request_id = incoming_request_id || crypto.randomUUID();

  req.request_id = request_id;
  res.setHeader("x-request-id", request_id);

  next();
};

const get_request_meta = (req) => {
  if (!req) {
    return {
      request_id: null,
      ip_address: null,
      user_agent: null,
    };
  }

  const forwarded_for = req.headers?.["x-forwarded-for"];
  const ip_address = Array.isArray(forwarded_for)
    ? forwarded_for[0]
    : typeof forwarded_for === "string"
      ? forwarded_for.split(",")[0].trim()
      : req.ip || req.socket?.remoteAddress || null;

  return {
    request_id: req.request_id || null,
    ip_address,
    user_agent: req.get?.("user-agent") || req.headers?.["user-agent"] || null,
  };
};

export const log_auth_event = async (
  req,
  {
    event_type,
    status,
    message,
    severity = "info",
    user_id = null,
    email = null,
    metadata = {},
  },
) => {
  try {
    const request_meta = get_request_meta(req);

    const payload = {
      event_type,
      status,
      message,
      severity,
      user_id,
      email,
      metadata,
      ...request_meta,
    };

    await AuthEvent.create(payload);

    console.log(
      JSON.stringify({
        scope: "auth",
        timestamp: new Date().toISOString(),
        ...payload,
      }),
    );
  } catch (error) {
    console.error("Failed to persist auth event:", error.message);
  }
};
