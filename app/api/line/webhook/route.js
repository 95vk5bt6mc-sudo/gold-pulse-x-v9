import crypto from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validSignature(raw, signature, secret) {
  if (!signature || !secret) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(raw)
    .digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function replyWithTargetId(event, token) {
  const source = event?.source;
  const replyToken = event?.replyToken;

  if (!source || !replyToken || !token) return;

  let targetId = "";
  let targetType = "";

  if (source.type === "group") {
    targetId = source.groupId;
    targetType = "GROUP";
  } else if (source.type === "room") {
    targetId = source.roomId;
    targetType = "ROOM";
  } else if (source.type === "user") {
    targetId = source.userId;
    targetType = "USER";
  }

  if (!targetId) return;

  const text = [
    "✅ GOLD PULSE LINE CONNECTED",
    "",
    `Target Type: ${targetType}`,
    "",
    "นำค่านี้ไปใส่ใน Vercel Environment Variable:",
    "LINE_TARGET_ID",
    "",
    targetId,
    "",
    "จากนั้น Redeploy โปรเจกต์หนึ่งครั้ง"
  ].join("\n");

  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }]
    }),
    cache: "no-store"
  });
}

export async function POST(request) {
  const raw = await request.text();
  const signature = request.headers.get("x-line-signature");
  const secret = process.env.LINE_CHANNEL_SECRET;

  if (!validSignature(raw, signature, secret)) {
    return NextResponse.json(
      { ok: false, message: "Invalid signature" },
      { status: 401 }
    );
  }

  const payload = JSON.parse(raw || "{}");
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  const connectEvents = (payload.events || []).filter((event) => {
    if (event.type === "follow") return true;

    if (
      event.type !== "message" ||
      event.message?.type !== "text"
    ) {
      return false;
    }

    const text = String(event.message.text || "")
      .trim()
      .toLowerCase();

    return [
      "id",
      "line id",
      "group id",
      "connect",
      "เชื่อมต่อ",
      "ขอ id"
    ].includes(text);
  });

  await Promise.all(
    connectEvents.map((event) =>
      replyWithTargetId(event, token)
    )
  );

  return NextResponse.json({ ok: true });
}
