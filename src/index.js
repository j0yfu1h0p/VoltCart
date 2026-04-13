// TODOs
// Payments integration
// Stripe subscriptions, webhooks, invoice handling, retry logic.

// Real-time features
// WebSockets for notifications/chat/live presence.

// File/media pipeline
// Upload to S3/Cloudinary, image optimization, signed URLs, access controls.

// Background jobs
// Queue system (BullMQ/RabbitMQ) for emails, reports, retries, scheduled tasks.

// Caching + performance
// Redis caching, DB indexing, pagination, rate limiting, profiling.

// Testing and quality
// Unit/integration tests, API contract tests, CI pipeline, linting/coverage badges.

import "dotenv/config";

import dns from "node:dns";
import http from "node:http";
import process from "node:process";

import axios from "axios";
import cors from "cors";
import express, { json } from "express";

import connectDB from "./configs/db.config.js";
import { stripe_webhook } from "./controllers/stripe.controller.js";
import { authRateLimiter } from "./middleware/rate-limit-middleware/auth.rate.limiter.js";
import adminRoutes from "./routes/admin.routes.js";
import authRoutes from "./routes/auth.routes.js";
import cart_router from "./routes/cart.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import orderRoutes from "./routes/order.routes.js";
import productRoutes from "./routes/product.routes.js";
import stripeRoutes from "./routes/stripe.routes.js";
import { ensure_request_id } from "./utils/auth-logger.util.js";

const app = express();
// app.use(auth_middleware);
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripe_webhook,
);

app.use(json());
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({
      success: false,
      message: "Malformed JSON payload",
    });
  }

  return next(error);
});
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(ensure_request_id);
const server = http.createServer(app);

app.set("trust proxy", true);
// -----------Routes-----------------------------
const authLimiterExemptPaths = new Set(["/login", "/login/"]);

app.use(
  "/auth",
  (req, res, next) => {
    if (authLimiterExemptPaths.has(req.path)) {
      return next();
    }
    return authRateLimiter(req, res, next);
  },
  authRoutes,
);
app.use("/c", cart_router);
app.use("/stripe", stripeRoutes);
app.use("/products", productRoutes);
app.use("/orders", orderRoutes);
app.use("/admin", adminRoutes);
app.use("/notifications", notificationRoutes);

// -----------------------------------------------

const generate_random_quote = async () => {
  const response = await axios.get("https://dummyjson.com/quotes/random");
  return response.data.quote;
};

app.get("/", async (req, res) => {
  try {
    const quote_of_the_day = await generate_random_quote();
    res.status(200).json({
      success: true,
      message: "Server is running.",
      quote_of_the_day: quote_of_the_day,
      ip: req.ip,
    });
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server is running, but quote API failed.",
    });
  }
});

app.get("/auth/test-ui", (req, res) => {
  res.status(200).type("html").send(`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Auth Test UI</title>
  </head>
  <body>
    <h1>Auth Test UI</h1>

    <p>Base URL</p>
    <input id="baseUrl" value="http://localhost:3000/auth" size="60" />

    <p>Tokens / IDs</p>
    <div>
      <label>access_token</label><br />
      <textarea id="accessToken" rows="2" cols="100"></textarea>
    </div>
    <div>
      <label>refresh_token</label><br />
      <textarea id="refreshToken" rows="2" cols="100"></textarea>
    </div>
    <div>
      <label>admin_access_token</label><br />
      <textarea id="adminToken" rows="2" cols="100"></textarea>
    </div>
    <div>
      <label>user_id</label><br />
      <input id="userId" size="50" />
    </div>
    <div>
      <label>session_id</label><br />
      <input id="sessionId" size="50" />
    </div>
    <div>
      <label>verification_token</label><br />
      <input id="verificationToken" size="80" />
    </div>
    <div>
      <label>reset_token</label><br />
      <input id="resetToken" size="80" />
    </div>
    <div>
      <label>2fa_code</label><br />
      <input id="twofaCode" value="000000" size="20" />
    </div>
    <div>
      <label>login_otp_code</label><br />
      <input id="loginOtpCode" value="" size="20" />
    </div>
    <div>
      <label>current_password</label><br />
      <input id="currentPassword" value="Pass@12345" size="40" />
    </div>
    <div>
      <label>target_user_id (admin)</label><br />
      <input id="targetUserId" size="50" />
    </div>

    <hr />
    <h2>Auth</h2>
    <button onclick="registerUser()">POST /register</button>
    <button onclick="loginUser()">POST /login</button>
    <button onclick="refreshToken()">POST /refresh-token</button>
    <button onclick="logoutUser()">POST /logout</button>
    <button onclick="getMe()">GET /me</button>
    <button onclick="updateMe()">PATCH /me</button>
    <button onclick="changePassword()">PATCH /me/password</button>
    <button onclick="deleteMe()">DELETE /me</button>

    <hr />
    <h2>Email</h2>
    <button onclick="verifyEmailPost()">POST /email/verify</button>
    <button onclick="verifyEmailGet()">GET /verify-email/:token</button>
    <button onclick="resendVerification()">POST /email/verify/resend</button>
    <button onclick="forgotPassword()">POST /forgot-password</button>
    <button onclick="resetPassword()">POST /reset-password/:token</button>

    <hr />
    <h2>Sessions</h2>
    <button onclick="listSessions()">GET /sessions</button>
    <button onclick="deleteSession()">DELETE /sessions/:id</button>
    <button onclick="deleteAllSessions()">DELETE /sessions</button>

    <hr />
    <h2>2FA</h2>
    <button onclick="enable2fa()">POST /2fa/enable</button>
    <button onclick="verify2fa()">POST /2fa/verify</button>
    <button onclick="disable2fa()">POST /2fa/disable</button>

    <hr />
    <h2>Admin</h2>
    <button onclick="listUsers()">GET /users</button>
    <button onclick="getUserById()">GET /users/:id</button>
    <button onclick="updateUserById()">PATCH /users/:id</button>
    <button onclick="deleteUserById()">DELETE /users/:id</button>

    <hr />
    <h2>Request Body Editor (JSON)</h2>
    <textarea id="jsonBody" rows="14" cols="120">{
  "full_name": "Test User",
  "email": "test@example.com",
  "password": "Pass@12345",
  "otp_code": "",
  "current_password": "Pass@12345",
  "new_password": "NewPass@12345",
  "confirm_password": "NewPass@12345",
  "token": "",
  "code": "000000",
  "role": "user",
  "email_verified": true,
  "two_factor_enabled": false
}</textarea>

    <h2>Response</h2>
    <pre id="output"></pre>

    <script>
      const output = document.getElementById("output");
      const get = (id) => document.getElementById(id).value;
      const set = (id, value) => {
        document.getElementById(id).value = value || "";
      };

      const authHeader = (isAdmin = false) => {
        const token = isAdmin ? get("adminToken") : get("accessToken");
        return token ? { Authorization: "Bearer " + token } : {};
      };

      const readBody = () => {
        try {
          return JSON.parse(get("jsonBody") || "{}");
        } catch {
          alert("Invalid JSON in body editor");
          return null;
        }
      };

      async function callApi(path, method, body, opts = {}) {
        const url = get("baseUrl") + path;
        const headers = { ...authHeader(Boolean(opts.admin)), ...(opts.extraHeaders || {}) };

        if (body !== undefined && body !== null) {
          headers["Content-Type"] = "application/json";
        }

        const res = await fetch(url, {
          method,
          headers,
          body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
        });

        const text = await res.text();
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }

        output.textContent = JSON.stringify({ status: res.status, path, method, data: parsed }, null, 2);

        if (parsed && typeof parsed === "object") {
          if (parsed.token) set("accessToken", parsed.token);
          if (parsed.refresh_token) set("refreshToken", parsed.refresh_token);
          if (parsed.data && parsed.data.user_id) set("userId", parsed.data.user_id);
          if (parsed.data && Array.isArray(parsed.data) && parsed.data[0] && parsed.data[0].session_id) {
            set("sessionId", parsed.data[0].session_id);
          }
        }
      }

      function registerUser() {
        const body = readBody();
        if (!body) return;
        callApi("/register", "POST", { full_name: body.full_name, email: body.email, password: body.password });
      }

      function loginUser() {
        const body = readBody();
        if (!body) return;
        callApi("/login", "POST", {
          email: body.email,
          password: body.password,
          otp_code: get("loginOtpCode") || body.otp_code || "",
        });
      }

      function refreshToken() {
        callApi("/refresh-token", "POST", { refresh_token: get("refreshToken") });
      }

      function logoutUser() {
        callApi("/logout", "POST", { refresh_token: get("refreshToken") });
      }

      function getMe() {
        callApi("/me", "GET", null);
      }

      function updateMe() {
        const body = readBody();
        if (!body) return;
        callApi("/me", "PATCH", { full_name: body.full_name, email: body.email });
      }

      function changePassword() {
        const body = readBody();
        if (!body) return;
        callApi("/me/password", "PATCH", {
          current_password: get("currentPassword") || body.current_password,
          new_password: body.new_password,
          confirm_password: body.confirm_password,
        });
      }

      function deleteMe() {
        callApi("/me", "DELETE", null);
      }

      function verifyEmailPost() {
        const body = readBody();
        if (!body) return;
        callApi("/email/verify", "POST", { token: get("verificationToken") || body.token || "" });
      }

      function verifyEmailGet() {
        callApi("/verify-email/" + encodeURIComponent(get("verificationToken")), "GET", null);
      }

      function resendVerification() {
        callApi("/email/verify/resend", "POST", null);
      }

      function forgotPassword() {
        const body = readBody();
        if (!body) return;
        callApi("/forgot-password", "POST", { email: body.email });
      }

      function resetPassword() {
        const body = readBody();
        if (!body) return;
        callApi("/reset-password/" + encodeURIComponent(get("resetToken")), "POST", {
          password: body.new_password || body.password,
          confirm_password: body.confirm_password,
        });
      }

      function listSessions() {
        callApi("/sessions", "GET", null);
      }

      function deleteSession() {
        callApi("/sessions/" + encodeURIComponent(get("sessionId")), "DELETE", null);
      }

      function deleteAllSessions() {
        callApi("/sessions", "DELETE", null);
      }

      function enable2fa() {
        callApi("/2fa/enable", "POST", null);
      }

      function verify2fa() {
        const body = readBody();
        if (!body) return;
        callApi("/2fa/verify", "POST", { code: get("twofaCode") || body.code });
      }

      function disable2fa() {
        const body = readBody();
        if (!body) return;
        callApi("/2fa/disable", "POST", {
          current_password: get("currentPassword") || body.current_password,
          code: get("twofaCode") || body.code,
        });
      }

      function listUsers() {
        callApi("/users", "GET", null, { admin: true });
      }

      function getUserById() {
        callApi("/users/" + encodeURIComponent(get("targetUserId") || get("userId")), "GET", null, { admin: true });
      }

      function updateUserById() {
        const body = readBody();
        if (!body) return;
        callApi(
          "/users/" + encodeURIComponent(get("targetUserId") || get("userId")),
          "PATCH",
          {
            full_name: body.full_name,
            email: body.email,
            role: body.role,
            email_verified: body.email_verified,
            two_factor_enabled: body.two_factor_enabled,
          },
          { admin: true },
        );
      }

      function deleteUserById() {
        callApi("/users/" + encodeURIComponent(get("targetUserId") || get("userId")), "DELETE", null, { admin: true });
      }
    </script>
  </body>
</html>
  `);
});

const main = async () => {
  const original_dns_servers = dns.getServers();
  const mongo_dns_server = process.env.MONGO_DNS_SERVER;

  try {
    if (mongo_dns_server) {
      dns.setServers([mongo_dns_server]);
    }
    // // Test Redis connection
    // if (redisClient.status !== "ready" && redisClient.status !== "connect") {
    //   await redisClient.connect();
    // }
    // const ping = await redisClient.ping();
    // log("Redis ping response:", ping);

    await connectDB();

    dns.setServers(original_dns_servers);

    server.listen(3000, () => {
      console.log(
        "Server is running on http://localhost:3000 and http://127.0.0.1:3000",
      );
    });
  } catch (error) {
    dns.setServers(original_dns_servers);
    throw error;
  }
};

main();
