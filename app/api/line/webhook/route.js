import crypto from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validSignature(raw, signature, secret) {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function replyWithUserId(event, token) {
  const userId = event?.source?.userId;
  const replyToken = event?.replyToken;
  if (!userId || !replyToken || !token) return;
  const text = [
    "✅ GOLD PULSE เชื่อมต่อ LINE แล้ว",
    "",
    "นำค่านี้ไปใส่ใน Vercel Environment Variable:",
    "LINE_TARGET_ID",
    "",
    userId,
    "",
    "จากนั้น Redeploy โปรเจกต์หนึ่งครั้ง"
  ].join("\n");
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
    cache: "no-store"
  });
}

export async function POST(request) {
  const raw = await request.text();
  const signature = request.headers.get("x-line-signature");
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!validSignature(raw, signature, secret)) {
    return NextResponse.json({ ok: false, message: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(raw || "{}");
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const connectEvents = (payload.events || []).filter((event) => {
    if (event.type === "follow") return true;
    if (event.type !== "message" || event.message?.type !== "text") return false;
    const text = String(event.message.text || "").trim().toLowerCase();
    return ["id", "line id", "connect", "เชื่อมต่อ", "ขอ id"].includes(text);
  });
  await Promise.all(connectEvents.map((event) => replyWithUserId(event, token)));

  return NextResponse.json({ ok: true });
}
