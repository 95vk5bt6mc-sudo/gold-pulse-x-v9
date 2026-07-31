import crypto from "node:crypto";

export interface LineSendResult {
  ok: boolean;
  delivered: boolean;
  duplicate: boolean;
  mode: "push" | "broadcast" | "disabled";
  status: number;
  retryKey?: string;
  requestId?: string | null;
  acceptedRequestId?: string | null;
  detail?: string;
}

function deterministicUuid(seed: string): string {
  const bytes = crypto.createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // UUID version 5 style bits
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function postOnce(url: string, token: string, retryKey: string, body: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Line-Retry-Key": retryKey
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store"
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendLineText(text: string, retrySeed?: string): Promise<LineSendResult> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const target = process.env.LINE_TARGET_ID;
  const enabled = !["0", "false", "off", "no"].includes(String(process.env.LINE_ALERTS_ENABLED || "true").toLowerCase());
  if (!enabled || !token) {
    return { ok: false, delivered: false, duplicate: false, mode: "disabled", status: 503, detail: "LINE is not configured or disabled" };
  }

  const retryKey = retrySeed ? deterministicUuid(retrySeed) : crypto.randomUUID();
  const mode = target ? "push" : "broadcast";
  const url = target
    ? "https://api.line.me/v2/bot/message/push"
    : "https://api.line.me/v2/bot/message/broadcast";
  const body = target
    ? { to: target, messages: [{ type: "text", text }], notificationDisabled: false }
    : { messages: [{ type: "text", text }], notificationDisabled: false };

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await postOnce(url, token, retryKey, body);
      const detail = await response.text();
      const duplicate = response.status === 409;
      if (response.ok || duplicate) {
        return {
          ok: true,
          delivered: response.ok,
          duplicate,
          mode,
          status: response.status,
          retryKey,
          requestId: response.headers.get("x-line-request-id"),
          acceptedRequestId: response.headers.get("x-line-accepted-request-id"),
          detail: detail || undefined
        };
      }
      lastError = detail || `LINE HTTP ${response.status}`;
      if (response.status < 500 && response.status !== 429) {
        return { ok: false, delivered: false, duplicate: false, mode, status: response.status, retryKey, detail: lastError };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "LINE request failed";
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }

  return { ok: false, delivered: false, duplicate: false, mode, status: 502, retryKey, detail: lastError };
}
