import { NextResponse } from "next/server";
import { sendLineText } from "../../../lib/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fmt = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "—";

function authorized(request) {
  const expected = process.env.GOLD_PULSE_API_SECRET;
  return Boolean(expected) && request.headers.get("x-gold-pulse-secret") === expected;
}

function textFor(body) {
  const icon = body.side === "BUY" ? "🟢" : "🔴";
  return [
    `${icon} GOLD PULSE X v9 · MANUAL TEST`, "",
    `${body.side} SIGNAL · ${body.tier || "TEST"}`,
    `Symbol: ${body.symbol || "XAU/USD"}`,
    `Probability: ${body.probability ?? "—"}%`, "",
    `Entry: ${fmt(body.entry)}`,
    `TP1: ${fmt(body.tp1)}`,
    `TP2: ${fmt(body.tp2)}`,
    `TP3: ${fmt(body.tp3)}`,
    `Stop Loss: ${fmt(body.stopLoss)}`,
    `Risk : Reward: ${body.riskReward || "—"}`,
    `Hold: ${body.holdMinutes || "—"} min`, "",
    body.note ? `Source: ${body.note}` : "", "",
    "⚠️ ข้อความทดสอบ ไม่ใช่คำแนะนำการลงทุน"
  ].join("\n");
}

export async function POST(request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !["BUY", "SELL"].includes(body.side) || !Number.isFinite(Number(body.entry)) || !Number.isFinite(Number(body.stopLoss))) {
    return NextResponse.json({ ok: false, message: "Invalid signal payload" }, { status: 400 });
  }

  const result = await sendLineText(textFor(body), `manual-test|${Date.now()}|${body.side}`, { priority: "test" });
  return NextResponse.json({
    ok: result.ok,
    sent: result.delivered,
    duplicate: result.duplicate,
    mode: result.mode,
    status: result.status,
    guardReason: result.guardReason || null,
    quota: result.quota || null,
    message: result.ok ? "LINE request accepted" : result.detail || "LINE request failed"
  }, { status: result.ok ? 200 : (result.status === 429 ? 429 : 502) });
}
