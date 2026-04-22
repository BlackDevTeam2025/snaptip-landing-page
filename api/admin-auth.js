const crypto = require("crypto");

const PASSWORD_ALGORITHM = "scrypt";
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_BYTES = 16;
const SESSION_TOKEN_BYTES = 32;

function hashPassword(password) {
  const value = String(password || "");
  if (!value) {
    throw new Error("Password is required");
  }

  const salt = crypto.randomBytes(PASSWORD_SALT_BYTES).toString("hex");
  const hash = crypto
    .scryptSync(value, salt, PASSWORD_KEY_LENGTH)
    .toString("hex");

  return `${PASSWORD_ALGORITHM}:${salt}:${hash}`;
}

function verifyPassword(password, encodedHash) {
  const value = String(password || "");
  const [algorithm, salt, hash] = String(encodedHash || "").split(":");
  if (!value || !algorithm || !salt || !hash) {
    return false;
  }
  if (algorithm !== PASSWORD_ALGORITHM) {
    return false;
  }

  const digest = crypto
    .scryptSync(value, salt, PASSWORD_KEY_LENGTH)
    .toString("hex");
  return safeCompare(hash, digest);
}

function generateSessionToken() {
  return crypto.randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function safeCompare(inputA, inputB) {
  const left = Buffer.from(String(inputA || ""), "utf8");
  const right = Buffer.from(String(inputB || ""), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) return accumulator;
      const key = decodeURIComponent(part.slice(0, separator).trim());
      const value = decodeURIComponent(part.slice(separator + 1).trim());
      accumulator[key] = value;
      return accumulator;
    }, {});
}

function serializeCookie(name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value || "")}`];
  if (options.maxAge !== undefined) segments.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) segments.push("HttpOnly");
  if (options.secure) segments.push("Secure");
  if (options.path) segments.push(`Path=${options.path}`);
  if (options.sameSite) segments.push(`SameSite=${options.sameSite}`);
  return segments.join("; ");
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  parseCookies,
  serializeCookie,
};
