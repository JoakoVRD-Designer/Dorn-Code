"use strict";

function headerValue(headers, names) {
  for (const name of names) {
    let result;
    if (headers && typeof headers.get === "function") result = headers.get(name);
    else if (headers && typeof headers === "object") {
      const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name.toLowerCase());
      result = key ? headers[key] : undefined;
    }
    if (result !== undefined && result !== null && String(result).trim()) return String(result).trim();
  }
  return null;
}

function durationMs(raw, now = Date.now()) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().toLowerCase();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.min(7 * 86_400_000, Math.max(0, Number(text) * 1_000));
  const match = text.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/);
  if (match) {
    const scale = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
    return Math.min(7 * 86_400_000, Math.max(0, Number(match[1]) * scale));
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? Math.min(7 * 86_400_000, Math.max(0, parsed - now)) : null;
}

function resetAt(raw, now = Date.now()) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;
  let result = null;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    if (numeric > 100_000_000_000) result = Math.trunc(numeric);
    else if (numeric > 1_000_000_000) result = Math.trunc(numeric * 1_000);
    else result = now + numeric * 1_000;
  } else if (/^(?:\d+(?:\.\d+)?)(?:ms|s|m|h|d)$/i.test(text)) {
    const relative = durationMs(text, now);
    if (relative !== null) result = now + relative;
  } else {
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) result = parsed;
  }
  if (!Number.isFinite(result) || result < now - 60_000 || result > now + 370 * 86_400_000) return null;
  return Math.trunc(result);
}

function nonNegative(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readRateLimitHeaders(headers, now = Date.now()) {
  const retryAfterMs = durationMs(headerValue(headers, ["retry-after", "x-retry-after"]), now);
  const quotaLimit = nonNegative(headerValue(headers, [
    "x-ratelimit-limit-tokens", "anthropic-ratelimit-tokens-limit", "ratelimit-limit", "x-rate-limit-limit"
  ]));
  const quotaRemaining = nonNegative(headerValue(headers, [
    "x-ratelimit-remaining-tokens", "anthropic-ratelimit-tokens-remaining", "ratelimit-remaining", "x-rate-limit-remaining"
  ]));
  const rawReset = headerValue(headers, [
    "x-ratelimit-reset-tokens", "anthropic-ratelimit-tokens-reset", "ratelimit-reset", "x-rate-limit-reset"
  ]);
  const quotaResetAt = resetAt(rawReset, now) || (retryAfterMs !== null ? now + retryAfterMs : null);
  return {
    retryAfterMs,
    quotaLimit,
    quotaRemaining,
    quotaResetAt,
    observed: [retryAfterMs, quotaLimit, quotaRemaining, quotaResetAt].some((entry) => entry !== null)
  };
}

module.exports = { durationMs, readRateLimitHeaders, resetAt };
