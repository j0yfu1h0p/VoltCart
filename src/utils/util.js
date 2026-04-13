import jwt from "jsonwebtoken";

/**
 * Generates a JSON Web Token for a given payload.
 *
 * @param {Object} payload - Data to store inside the token.
 * @param {string} secret_key - Secret used to sign the token.
 * @param {string|number} expiresIn - Token lifetime.
 * @returns {string} Signed JWT string.
 */
export const generate_token = (payload, secret_key, expiresIn) => {
  const token = jwt.sign(payload, secret_key, {
    algorithm: "HS512",
    expiresIn: expiresIn,
  });
  return token;
};

/**
 * Sends a standardized success response to the client.
 *
 * @param {import("express").Response} res - Express response object.
 * @param {string} message - Success message.
 * @param {Object} data - Additional response data.
 * @param {Object} [token={}] - Optional token payload.
 * @returns {import("express").Response} JSON response.
 */
export const sendSuccess = (res, message, data, token = {}) => {
  return res
    .status(200)
    .json({ success: true, message: message, data: data, token: token });
};

/**
 * Sends a standardized error response to the client.
 *
 * @param {import("express").Response} res - Express response object.
 * @param {string} message - Error message.
 * @param {number} [code=400] - HTTP status code.
 * @param {string|null} [details=null] - Optional error details.
 * @returns {import("express").Response} JSON response.
 */
export const sendError = (res, message, code = 400, details = null) => {
  return res.status(code).json({
    success: false,
    message,
    error: details ? { code, details } : { code },
  });
};

/**
 * Verifies a JSON Web Token and returns the decoded payload.
 *
 * @param {string} token - JWT token to verify.
 * @param {string} secret_key - Secret used to verify the token.
 * @returns {Object} Decoded token payload.
 * @throws {Error} If the token is invalid or expired.
 */
export const verify_token = (token, secret_key) => {
  return jwt.verify(token, secret_key);
};

export default { generate_token, sendSuccess, sendError, verify_token };
