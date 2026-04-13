import dns from "node:dns/promises";
import process from "node:process";

import nodemailer from "nodemailer";

/**
 * Resolves the SMTP host to an IPv4 address while preserving the original hostname for TLS.
 *
 * @param {string} smtp_host - SMTP hostname to resolve.
 * @returns {Promise<{connect_host: string, tls_server_name: string}>} Connection details.
 */
const resolve_smtp_host = async (smtp_host) => {
  try {
    const { address } = await dns.lookup(smtp_host, { family: 4 });
    return { connect_host: address, tls_server_name: smtp_host };
  } catch {
    return { connect_host: smtp_host, tls_server_name: smtp_host };
  }
};

/**
 * Creates a Nodemailer transporter for Gmail password reset emails.
 *
 * @returns {Promise<import("nodemailer").Transporter>} Configured mail transporter.
 */
const create_transporter = async () => {
  const email_user = process.env.EMAIL_USER;
  const email_pass = process.env.EMAIL_PASS;
  const smtp_host = process.env.EMAIL_HOST || "smtp.gmail.com";

  if (!email_user || !email_pass) {
    throw new Error(
      "EMAIL_USER and EMAIL_PASS are required to send password reset emails.",
    );
  }

  const { connect_host, tls_server_name } = await resolve_smtp_host(smtp_host);

  return nodemailer.createTransport({
    host: connect_host,
    port: Number(process.env.EMAIL_PORT || 465),
    secure: process.env.EMAIL_SECURE
      ? process.env.EMAIL_SECURE === "true"
      : true,
    auth: {
      user: email_user,
      pass: email_pass,
    },
    tls: {
      servername: tls_server_name,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    dnsTimeout: 10000,
  });
};

/**
 * Sends the password reset email to the user.
 *
 * @param {Object} params - Email payload.
 * @param {string} params.to - Recipient email address.
 * @param {string} [params.name] - Recipient display name.
 * @param {string} params.resetUrl - Password reset link.
 * @returns {Promise<import("nodemailer/lib/mailer/index.js").SentMessageInfo>} Mail send result.
 */
export const sendResetPasswordEmail = async ({ to, name, resetUrl }) => {
  const transporter = await create_transporter();
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  return transporter.sendMail({
    from,
    to,
    subject: "Reset your password",
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;">
        <h2>Hello ${name || "there"},</h2>
        <p>We received a request to reset your password. Use the button below to create a new one.</p>
        <p style="margin:24px 0;">
          <a href="${resetUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;">Reset password</a>
        </p>
        <p>If you did not request this, you can ignore this email.</p>
        <p>If the button does not work, copy and paste this link into your browser:<br />${resetUrl}</p>
      </div>
    `,
  });
};

/**
 * Sends the email verification email to the user.
 *
 * @param {Object} params - Email payload.
 * @param {string} params.to - Recipient email address.
 * @param {string} [params.name] - Recipient display name.
 * @param {string} params.verificationToken - Verification token to submit.
 * @param {string} [params.verificationUrl] - Verification URL for one-click confirm.
 * @returns {Promise<import("nodemailer/lib/mailer/index.js").SentMessageInfo>} Mail send result.
 */
export const sendVerificationEmail = async ({
  to,
  name,
  verificationToken,
  verificationUrl,
}) => {
  const transporter = await create_transporter();
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  return transporter.sendMail({
    from,
    to,
    subject: "Verify your email address",
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;">
        <h2>Hello ${name || "there"},</h2>
        <p>Click the button below to verify your email address:</p>
        <p style="margin:24px 0;">
          <a href="${verificationUrl || "#"}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;">Verify email</a>
        </p>
        <p>If needed, use this verification token manually:</p>
        <p style="margin:24px 0;padding:16px;border-radius:8px;background:#f3f4f6;font-family:monospace;word-break:break-all;">${verificationToken}</p>
        <p>API fallback: <strong>POST /auth/verify-email</strong> with token in body.</p>
        <p>If you did not create this account, you can ignore this email.</p>
      </div>
    `,
  });
};

/**
 * Sends a security activity notification email.
 *
 * @param {Object} params - Email payload.
 * @param {string} params.to - Recipient email address.
 * @param {string} [params.name] - Recipient display name.
 * @param {string} params.activityTitle - Human-readable activity title.
 * @param {string} params.activityMessage - Detailed activity message.
 * @param {string} [params.ipAddress] - Source IP address.
 * @param {string} [params.userAgent] - Source user agent.
 * @returns {Promise<import("nodemailer/lib/mailer/index.js").SentMessageInfo>} Mail send result.
 */
export const sendSecurityActivityEmail = async ({
  to,
  name,
  activityTitle,
  activityMessage,
  ipAddress,
  userAgent,
}) => {
  const transporter = await create_transporter();
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  return transporter.sendMail({
    from,
    to,
    subject: `[Security] ${activityTitle}`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;">
        <h2>Hello ${name || "there"},</h2>
        <p>${activityMessage}</p>
        <div style="margin:18px 0;padding:14px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;">
          <p style="margin:0 0 8px;"><strong>Time:</strong> ${new Date().toISOString()}</p>
          <p style="margin:0 0 8px;"><strong>IP:</strong> ${ipAddress || "Unknown"}</p>
          <p style="margin:0;"><strong>Device:</strong> ${userAgent || "Unknown"}</p>
        </div>
        <p>If this was not you, secure your account immediately and change your password.</p>
      </div>
    `,
  });
};

/**
 * Sends a passwordless magic-link email.
 *
 * @param {Object} params - Email payload.
 * @param {string} params.to - Recipient email address.
 * @param {string} [params.name] - Recipient display name.
 * @param {string} params.magicLinkUrl - One-click magic link URL.
 * @param {number} [params.expiresInMinutes=15] - Link lifetime in minutes.
 * @returns {Promise<import("nodemailer/lib/mailer/index.js").SentMessageInfo>} Mail send result.
 */
export const sendMagicLinkEmail = async ({
  to,
  name,
  magicLinkUrl,
  expiresInMinutes = 15,
}) => {
  const transporter = await create_transporter();
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  return transporter.sendMail({
    from,
    to,
    subject: "Your secure sign-in link",
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;">
        <h2>Hello ${name || "there"},</h2>
        <p>Use this one-time sign-in link to access your account without a password.</p>
        <p style="margin:24px 0;">
          <a href="${magicLinkUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;">Sign in now</a>
        </p>
        <p>This link expires in ${expiresInMinutes} minutes and can only be used once.</p>
        <p>If you did not request this login link, you can safely ignore this email.</p>
      </div>
    `,
  });
};

export const sendOrderBookedEmail = async ({
  to,
  name,
  trackingId,
  total,
  currency,
  items = [],
  statusUrl,
}) => {
  const transporter = await create_transporter();
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  const items_html = items
    .map(
      (item) =>
        `<li>${item.name} x${item.quantity} - ${item.line_total || item.unit_price * item.quantity} ${String(currency || "usd").toUpperCase()}</li>`,
    )
    .join("");

  return transporter.sendMail({
    from,
    to,
    subject: `Order booked: ${trackingId}`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;">
        <h2>Hello ${name || "there"},</h2>
        <p>Your order has been booked successfully.</p>
        <p><strong>Tracking ID:</strong> ${trackingId}</p>
        <p><strong>Total:</strong> ${total} ${String(currency || "usd").toUpperCase()}</p>
        <ul>${items_html}</ul>
        <p style="margin-top:18px;"><a href="${statusUrl}" style="display:inline-block;padding:10px 14px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;">Track Order</a></p>
      </div>
    `,
  });
};

export const sendOrderStatusEmail = async ({
  to,
  name,
  trackingId,
  status,
  statusMessage,
  statusUrl,
}) => {
  const transporter = await create_transporter();
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  return transporter.sendMail({
    from,
    to,
    subject: `Order status updated: ${trackingId}`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;">
        <h2>Hello ${name || "there"},</h2>
        <p>Your order status has changed.</p>
        <p><strong>Tracking ID:</strong> ${trackingId}</p>
        <p><strong>New status:</strong> ${status}</p>
        <p>${statusMessage || ""}</p>
        <p style="margin-top:18px;"><a href="${statusUrl}" style="display:inline-block;padding:10px 14px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;">View Order</a></p>
      </div>
    `,
  });
};
