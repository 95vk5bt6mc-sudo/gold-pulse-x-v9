import crypto from "node:crypto";

export type LinePriority = "strong" | "confirmed" | "test";

export interface LineQuotaSnapshot {
  checked: boolean;
  limited: boolean;
  monthlyLimit: number | null;
  totalUsage: number | null;
  remaining: number | null;
  reserve: number;
  businessDaysTotal: number;
  businessDaysElapsed: number;
  businessDaysLeft: number;
  cumulativeBudget: number | null;
  budgetHeadroom: number | null;
  dailyUsed: number | null;
  remainingPercent: number | null;
  survivalMode: boolean;
  sourceStatus: {
    quota: number | null;
    consumption: number | null;
    daily: number | null;
  };
}

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
  guardReason?: string;
  quota?: LineQuotaSnapshot;
}

function integerEnv(
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.round(raw)));
}

function bangkokDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const map = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    ymd: `${map.year}${map.month}${map.day}`
  };
}

function businessDayProgress(
  year: number,
  month: number,
  day: number
) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  let total = 0;
  let elapsed = 0;

  for (let current = 1; current <= lastDay; current += 1) {
    const weekday = new Date(
      Date.UTC(year, month - 1, current)
    ).getUTCDay();

    if (weekday >= 1 && weekday <= 5) {
      total += 1;

      if (current <= day) {
        elapsed += 1;
      }
    }
  }

  return {
    total: Math.max(1, total),
    elapsed,
    left: Math.max(1, total - elapsed + 1)
  };
}

async function getJson(url: string, token: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store",
      signal: controller.signal
    });

    const body = await response.json().catch(() => ({}));

    return {
      status: response.status,
      ok: response.ok,
      body
    };
  } catch {
    return {
      status: null,
      ok: false,
      body: {}
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getLineQuotaSnapshot(
  mode: "push" | "broadcast" | "disabled" = "push"
): Promise<LineQuotaSnapshot> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  const reserve = integerEnv("LINE_MONTHLY_RESERVE_MESSAGES", 45, 0, 10000);

  const date = bangkokDateParts();

  const businessDays = businessDayProgress(
    date.year,
    date.month,
    date.day
  );

  if (!token || mode === "disabled") {
    return {
      checked: false,
      limited: false,
      monthlyLimit: null,
      totalUsage: null,
      remaining: null,
      reserve,
      businessDaysTotal: businessDays.total,
      businessDaysElapsed: businessDays.elapsed,
      businessDaysLeft: businessDays.left,
      cumulativeBudget: null,
      budgetHeadroom: null,
      dailyUsed: null,
      remainingPercent: null,
      survivalMode: false,
      sourceStatus: {
        quota: null,
        consumption: null,
        daily: null
      }
    };
  }

  const dailyEndpoint =
    mode === "broadcast"
      ? `https://api.line.me/v2/bot/message/delivery/broadcast?date=${date.ymd}`
      : `https://api.line.me/v2/bot/message/delivery/push?date=${date.ymd}`;

  const [
    quotaResponse,
    consumptionResponse,
    dailyResponse
  ] = await Promise.all([
    getJson(
      "https://api.line.me/v2/bot/message/quota",
      token
    ),
    getJson(
      "https://api.line.me/v2/bot/message/quota/consumption",
      token
    ),
    getJson(
      dailyEndpoint,
      token
    )
  ]);

  const limited =
    quotaResponse.ok &&
    quotaResponse.body?.type === "limited";

  const monthlyLimit =
    limited &&
    Number.isFinite(
      Number(quotaResponse.body?.value)
    )
      ? Number(quotaResponse.body.value)
      : null;

  const totalUsage =
    consumptionResponse.ok &&
    Number.isFinite(
      Number(consumptionResponse.body?.totalUsage)
    )
      ? Number(consumptionResponse.body.totalUsage)
      : null;

  const dailyUsed =
    dailyResponse.ok &&
    dailyResponse.body?.status === "ready" &&
    Number.isFinite(
      Number(dailyResponse.body?.success)
    )
      ? Number(dailyResponse.body.success)
      : null;

  const remaining =
    monthlyLimit != null &&
    totalUsage != null
      ? Math.max(
          0,
          monthlyLimit - totalUsage
        )
      : null;

  const standardPool =
    monthlyLimit == null
      ? null
      : Math.max(
          0,
          monthlyLimit - reserve
        );

  const cumulativeBudget =
    standardPool == null
      ? null
      : Math.floor(
          standardPool *
            (
              businessDays.elapsed /
              businessDays.total
            )
        );

  const budgetHeadroom =
    cumulativeBudget != null &&
    totalUsage != null
      ? Math.max(
          0,
          cumulativeBudget - totalUsage
        )
      : null;

  const remainingPercent =
    remaining != null &&
    monthlyLimit != null &&
    monthlyLimit > 0
      ? Math.round(
          (remaining / monthlyLimit) *
            1000
        ) / 10
      : null;

  const survivalMode =
    remaining != null &&
    (
      remaining <= reserve ||
      (
        remainingPercent != null &&
        remainingPercent <= 10
      )
    );

  return {
    checked:
      quotaResponse.ok &&
      consumptionResponse.ok,
    limited,
    monthlyLimit,
    totalUsage,
    remaining,
    reserve,
    businessDaysTotal:
      businessDays.total,
    businessDaysElapsed:
      businessDays.elapsed,
    businessDaysLeft:
      businessDays.left,
    cumulativeBudget,
    budgetHeadroom,
    dailyUsed,
    remainingPercent,
    survivalMode,
    sourceStatus: {
      quota:
        quotaResponse.status,
      consumption:
        consumptionResponse.status,
      daily:
        dailyResponse.status
    }
  };
}

function quotaDecision(
  snapshot: LineQuotaSnapshot,
  priority: LinePriority
) {
  if (
    !snapshot.checked ||
    !snapshot.limited ||
    snapshot.remaining == null
  ) {
    return {
      allowed: true,
      reason: "quota-unlimited-or-unavailable"
    };
  }

  if (snapshot.remaining <= 0) {
    return {
      allowed: false,
      reason: "monthly-quota-exhausted"
    };
  }

  // -------------------------------------------------------
  // Reserve protection
  // Applies to ALL priorities.
  // -------------------------------------------------------

  if (
    snapshot.survivalMode ||
    snapshot.remaining <= snapshot.reserve
  ) {
    return {
      allowed: false,
      reason: "reserve-protected"
    };
  }

  // -------------------------------------------------------
  // Daily cap
  // -------------------------------------------------------

  const dailyCap = integerEnv(
    "LINE_DAILY_PUSH_CAP",
    12,
    1,
    10000
  );

  const strongDailyBurst = integerEnv(
    "LINE_STRONG_DAILY_BURST",
    2,
    0,
    1000
  );

  const dailyLimit =
    priority === "strong"
      ? dailyCap + strongDailyBurst
      : dailyCap;

  if (
    snapshot.dailyUsed != null &&
    snapshot.dailyUsed >= dailyLimit
  ) {
    return {
      allowed: false,
      reason:
        priority === "strong"
          ? "strong-daily-cap-used"
          : "daily-cap-used"
    };
  }

  // -------------------------------------------------------
  // Base hard monthly pace
  // -------------------------------------------------------

  const hardPacedBudget =
    snapshot.monthlyLimit != null
      ? Math.floor(
          snapshot.monthlyLimit *
          (
            snapshot.businessDaysElapsed /
            snapshot.businessDaysTotal
          )
        )
      : null;

  // -------------------------------------------------------
  // Priority burst allowances
  // -------------------------------------------------------

  const confirmedPaceBurst = integerEnv(
    "LINE_CONFIRMED_PACE_BURST",
    3,
    0,
    1000
  );

  const strongPaceBurst = integerEnv(
    "LINE_STRONG_PACE_BURST",
    5,
    0,
    1000
  );

  const paceBurst =
    priority === "strong"
      ? strongPaceBurst
      : priority === "confirmed"
        ? confirmedPaceBurst
        : 0;

  // -------------------------------------------------------
  // Never allow priority burst to consume reserve.
  // -------------------------------------------------------

  const spendableLimit =
    snapshot.monthlyLimit != null
      ? Math.max(
          0,
          snapshot.monthlyLimit - snapshot.reserve
        )
      : null;

  const rawPriorityPacedBudget =
    hardPacedBudget != null
      ? hardPacedBudget + paceBurst
      : null;

  const priorityPacedBudget =
    rawPriorityPacedBudget != null &&
    spendableLimit != null
      ? Math.min(
          rawPriorityPacedBudget,
          spendableLimit
        )
      : rawPriorityPacedBudget;

  // -------------------------------------------------------
  // Priority pacing ceiling
  // -------------------------------------------------------

  if (
    priorityPacedBudget != null &&
    snapshot.totalUsage != null &&
    snapshot.totalUsage >= priorityPacedBudget
  ) {
    if (priority === "strong") {
      return {
        allowed: false,
        reason: "strong-pace-burst-used"
      };
    }

    if (priority === "confirmed") {
      return {
        allowed: false,
        reason: "confirmed-pace-burst-used"
      };
    }

    return {
      allowed: false,
      reason: "test-hard-pace-used"
    };
  }

  // -------------------------------------------------------
  // STRONG
  // -------------------------------------------------------

  if (priority === "strong") {
    return {
      allowed: true,
      reason: "strong-within-priority-pace"
    };
  }

  // -------------------------------------------------------
  // CONFIRMED
  // -------------------------------------------------------

  if (priority === "confirmed") {
    return {
      allowed: true,
      reason: "confirmed-within-priority-pace"
    };
  }

  // -------------------------------------------------------
  // TEST
  // -------------------------------------------------------

  if (
    snapshot.remainingPercent != null &&
    snapshot.remainingPercent <= 25
  ) {
    return {
      allowed: false,
      reason: "test-reserve-protected"
    };
  }

  return {
    allowed: true,
    reason: "test-within-hard-pace"
  };
}

function deterministicUuid(
  seed: string
): string {
  const bytes = crypto
    .createHash("sha256")
    .update(seed)
    .digest()
    .subarray(0, 16);

  bytes[6] =
    (bytes[6] & 0x0f) | 0x50;

  bytes[8] =
    (bytes[8] & 0x3f) | 0x80;

  const hex =
    bytes.toString("hex");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function postOnce(
  url: string,
  token: string,
  retryKey: string,
  body: unknown
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      12_000
    );

  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${token}`,
        "Content-Type":
          "application/json",
        "X-Line-Retry-Key":
          retryKey
      },
      body:
        JSON.stringify(body),
      signal:
        controller.signal,
      cache:
        "no-store"
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isMonthlyLimit(
  status: number,
  detail: string
) {
  return (
    status === 429 &&
    /monthly limit|free messages|additional messages/i.test(
      detail || ""
    )
  );
}

export async function sendLineText(
  text: string,
  retrySeed?: string,
  options: {
    priority?: LinePriority
  } = {}
): Promise<LineSendResult> {
  const token =
    process.env.LINE_CHANNEL_ACCESS_TOKEN;

  const target =
    process.env.LINE_TARGET_ID;

  const enabled =
    ![
      "0",
      "false",
      "off",
      "no"
    ].includes(
      String(
        process.env.LINE_ALERTS_ENABLED ||
          "true"
      ).toLowerCase()
    );

  if (!enabled || !token) {
    return {
      ok: false,
      delivered: false,
      duplicate: false,
      mode: "disabled",
      status: 503,
      detail:
        "LINE is not configured or disabled"
    };
  }

  const retryKey =
    retrySeed
      ? deterministicUuid(retrySeed)
      : crypto.randomUUID();

  const mode =
    target
      ? "push"
      : "broadcast";

  const priority =
    options.priority ||
    "confirmed";

  const quota =
    await getLineQuotaSnapshot(
      mode
    );

  const guard =
    quotaDecision(
      quota,
      priority
    );

  if (!guard.allowed) {
    return {
      ok: false,
      delivered: false,
      duplicate: false,
      mode,
      status: 429,
      retryKey,
      detail:
        `LINE quota guard blocked: ${guard.reason}`,
      guardReason:
        guard.reason,
      quota
    };
  }

  const url =
    target
      ? "https://api.line.me/v2/bot/message/push"
      : "https://api.line.me/v2/bot/message/broadcast";

  const body =
    target
      ? {
          to: target,
          messages: [
            {
              type: "text",
              text
            }
          ],
          notificationDisabled:
            false
        }
      : {
          messages: [
            {
              type: "text",
              text
            }
          ],
          notificationDisabled:
            false
        };

  let lastError = "";

  for (
    let attempt = 0;
    attempt < 3;
    attempt += 1
  ) {
    try {
      const response =
        await postOnce(
          url,
          token,
          retryKey,
          body
        );

      const detail =
        await response.text();

      const duplicate =
        response.status === 409;

      if (
        response.ok ||
        duplicate
      ) {
        return {
          ok: true,
          delivered:
            response.ok,
          duplicate,
          mode,
          status:
            response.status,
          retryKey,
          requestId:
            response.headers.get(
              "x-line-request-id"
            ),
          acceptedRequestId:
            response.headers.get(
              "x-line-accepted-request-id"
            ),
          detail:
            detail || undefined,
          guardReason:
            guard.reason,
          quota
        };
      }

      lastError =
        detail ||
        `LINE HTTP ${response.status}`;

      if (
        isMonthlyLimit(
          response.status,
          lastError
        )
      ) {
        const refreshedQuota =
          await getLineQuotaSnapshot(
            mode
          );

        return {
          ok: false,
          delivered: false,
          duplicate: false,
          mode,
          status: 429,
          retryKey,
          detail:
            lastError,
          guardReason:
            "monthly-limit-or-reservation",
          quota:
            refreshedQuota
        };
      }

      if (
        response.status < 500 &&
        response.status !== 429
      ) {
        return {
          ok: false,
          delivered: false,
          duplicate: false,
          mode,
          status:
            response.status,
          retryKey,
          detail:
            lastError,
          guardReason:
            guard.reason,
          quota
        };
      }
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "LINE request failed";
    }

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          500 * (attempt + 1)
        )
    );
  }

  return {
    ok: false,
    delivered: false,
    duplicate: false,
    mode,
    status: 502,
    retryKey,
    detail:
      lastError,
    guardReason:
      guard.reason,
    quota
  };
}
