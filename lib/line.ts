function quotaDecision(snapshot: LineQuotaSnapshot, priority: LinePriority) {
  // ถ้า LINE ไม่จำกัดโควตา หรืออ่านสถานะไม่ได้
  // ให้ระบบเดิมทำงานต่อ
  if (!snapshot.checked || !snapshot.limited || snapshot.remaining == null) {
    return {
      allowed: true,
      reason: "quota-unlimited-or-unavailable"
    };
  }

  // ห้ามส่งเด็ดขาดเมื่อโควตาหมดจริง
  if (snapshot.remaining <= 0) {
    return {
      allowed: false,
      reason: "monthly-quota-exhausted"
    };
  }

  // Hard pace = เพดานสูงสุดตามจำนวนวันทำการ
  // ใช้ monthlyLimit เต็ม แต่ยังมี reserve protection ด้านล่าง
  const hardPacedBudget = snapshot.monthlyLimit != null
    ? Math.floor(
        snapshot.monthlyLimit *
        (snapshot.businessDaysElapsed / snapshot.businessDaysTotal)
      )
    : null;

  const dailyCap = integerEnv(
    "LINE_DAILY_PUSH_CAP",
    12,
    1,
    10000
  );

  const strongBurst = integerEnv(
    "LINE_STRONG_DAILY_BURST",
    2,
    0,
    1000
  );

  const dailyLimit =
    priority === "strong"
      ? dailyCap + strongBurst
      : dailyCap;

  // Daily safety cap
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

  // Hard monthly pacing:
  // ไม่มี priority ไหน รวมทั้ง TEST
  // สามารถทะลุเพดานสูงสุดของวันนี้ได้
  if (
    hardPacedBudget != null &&
    snapshot.totalUsage != null &&
    snapshot.totalUsage >= hardPacedBudget
  ) {
    return {
      allowed: false,
      reason: "hard-monthly-pace-used"
    };
  }

  // STRONG signal
  if (priority === "strong") {
    return {
      allowed: true,
      reason: snapshot.survivalMode
        ? "strong-within-hard-pace-reserve"
        : "strong-within-hard-pace"
    };
  }

  // ป้องกัน reserve สำหรับ confirmed และ test
  if (
    snapshot.survivalMode ||
    snapshot.remaining <= snapshot.reserve
  ) {
    return {
      allowed: false,
      reason: "reserve-protected"
    };
  }

  // --------------------------------------------------
  // MANUAL LIVE TEST
  // --------------------------------------------------
  // TEST อนุญาตให้ใช้ช่องว่างระหว่าง
  // standard paced budget กับ hard paced budget ได้
  //
  // แต่:
  // - ห้ามเกิน monthly quota
  // - ห้ามเกิน hard pace วันนี้
  // - ห้ามกิน reserve
  // - ห้ามเมื่อเหลือ <= 25%
  // - ยังอยู่ภายใต้ daily cap
  // --------------------------------------------------
  if (priority === "test") {
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

  // CONFIRMED signal ยังคงใช้ paced budget ปกติ
  if (
    snapshot.budgetHeadroom != null &&
    snapshot.budgetHeadroom <= 0
  ) {
    return {
      allowed: false,
      reason: "confirmed-pace-budget-used"
    };
  }

  return {
    allowed: true,
    reason: "within-r22-paced-budget"
  };
}
