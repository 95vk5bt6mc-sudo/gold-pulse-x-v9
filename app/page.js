"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CandleChart from "./components/CandleChart";

const fmt = (value, digits = 2) =>
  value == null || !Number.isFinite(Number(value))
    ? "—"
    : Number(value).toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      });

const directionClass = (value) =>
  String(value || "").includes("BUY") ? "up" : String(value || "").includes("SELL") ? "down" : "wait";


const DEFAULT_ALERT_SETTINGS = {
  sound: true,
  voice: true,
  vibration: true,
  notifications: true,
  expirySound: true,
  volume: 0.75,
  cooldown: 10
};

function tonePattern(kind, volume = 0.75) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = window.__goldPulseAudioContext || new AudioCtx();
  window.__goldPulseAudioContext = ctx;
  if (ctx.state === "suspended") ctx.resume();
  const patterns = {
    TREND_BUY: [[880, 0, 0.12], [1175, 0.14, 0.18]],
    TREND_SELL: [[660, 0, 0.13], [440, 0.15, 0.2]],
    COUNTER_BUY: [[520, 0, 0.11], [780, 0.13, 0.11], [1040, 0.26, 0.18]],
    COUNTER_SELL: [[920, 0, 0.11], [690, 0.13, 0.11], [460, 0.26, 0.18]],
    STRONG_BUY: [[900, 0, 0.1], [1200, 0.12, 0.1], [1500, 0.24, 0.22]],
    STRONG_SELL: [[760, 0, 0.1], [560, 0.12, 0.1], [380, 0.24, 0.22]],
    EXPIRED: [[420, 0, 0.12], [330, 0.15, 0.18]],
    TEST: [[720, 0, 0.1], [960, 0.12, 0.15]]
  };
  const seq = patterns[kind] || patterns.TEST;
  const now = ctx.currentTime + 0.03;
  seq.forEach(([frequency, offset, duration]) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.01, volume * 0.22), now + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + duration + 0.03);
  });
}


function LineTestPanel({ data }) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    try {
      setSecret(window.localStorage.getItem("goldPulseApiSecret") || "");
    } catch {}
  }, []);

  const sendTest = useCallback(async (side) => {
    if (!secret.trim()) {
      setResult({ ok: false, message: "กรุณาใส่ GOLD_PULSE_API_SECRET" });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      window.localStorage.setItem("goldPulseApiSecret", secret.trim());

      const liveResponse = await fetch("/api/gold?manualTest=1", { cache: "no-store" });
      const live = await liveResponse.json().catch(() => null);
      if (!liveResponse.ok || !live?.ok) throw new Error(live?.message || `โหลดราคาตลาดไม่สำเร็จ (HTTP ${liveResponse.status})`);
      if (live?.market?.isOpen === false) throw new Error("ตลาดปิดอยู่ จึงไม่ส่ง TEST ด้วยราคาค้างจาก session ก่อน");

      const candle = live?.oneMinute?.candles?.at(-1);
      const currentPrice = Number(candle?.close);
      const atr = Math.max(0.01, Number(live?.oneMinute?.analysis?.indicators?.atr || 0));
      if (!Number.isFinite(currentPrice)) throw new Error("ไม่พบราคาสด XAU/USD");

      const stopDistance = Math.max(0.55, atr * 0.9);
      const tp1Distance = Math.max(0.65, atr * 0.85);
      const tp2Distance = Math.max(1.15, atr * 1.6);
      const tp3Distance = Math.max(1.75, atr * 2.4);
      const sign = side === "BUY" ? 1 : -1;
      const decision = live?.tradeDecision;
      const probability = Number(decision?.targetProbability || live?.oneMinute?.analysis?.confidence || 70);
      const entry = Number(currentPrice.toFixed(2));

      const response = await fetch("/api/notify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gold-pulse-secret": secret.trim()
        },
        body: JSON.stringify({
          symbol: "XAU/USD",
          side,
          tier: "LIVE TEST",
          probability: Math.max(1, Math.min(99, Math.round(probability))),
          entry,
          tp1: Number((entry + sign * tp1Distance).toFixed(2)),
          tp2: Number((entry + sign * tp2Distance).toFixed(2)),
          tp3: Number((entry + sign * tp3Distance).toFixed(2)),
          stopLoss: Number((entry - sign * stopDistance).toFixed(2)),
          riskReward: `1:${(tp2Distance / stopDistance).toFixed(2)}`,
          holdMinutes: side === "BUY" || side === "SELL" ? 15 : 0,
          note: `LIVE MANUAL TEST · Twelve Data · candle ${candle?.datetime || "latest"} · ATR ${atr.toFixed(3)}`
        })
      });
      const payload = await response.json().catch(() => ({ ok: false, message: `HTTP ${response.status}` }));
      setResult({ ...payload, livePrice: entry, candleAt: candle?.datetime || null, source: live?.source || "Twelve Data" });
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : "ส่งข้อความไม่สำเร็จ" });
    } finally {
      setBusy(false);
    }
  }, [secret]);

  const latest = data?.oneMinute?.candles?.at(-1);
  return (
    <section className="panel lineTestPanel">
      <div className="head">
        <div><p className="eyebrow">LINE LIVE MARKET TEST</p><h2>ทดสอบ BUY / SELL ด้วยราคาตลาดล่าสุด</h2></div>
        <span className="reliability">FREE MODE</span>
      </div>
      <p className="lineTestHelp">ราคาทดสอบจะโหลดใหม่จาก Twelve Data ก่อนส่งทุกครั้ง ไม่ใช้ราคาตัวอย่างคงที่ · ล่าสุดบน Dashboard: <b>{latest ? fmt(latest.close) : "—"}</b></p>
      <input
        className="lineSecretInput"
        type="password"
        value={secret}
        onChange={(event) => setSecret(event.target.value)}
        placeholder="GOLD_PULSE_API_SECRET"
        autoComplete="off"
      />
      <div className="lineTestButtons">
        <button className="lineBuy" disabled={busy || !secret.trim()} onClick={() => sendTest("BUY")}>🟢 LIVE TEST BUY</button>
        <button className="lineSell" disabled={busy || !secret.trim()} onClick={() => sendTest("SELL")}>🔴 LIVE TEST SELL</button>
      </div>
      {result && (
        <div className={`lineTestResult ${result.ok ? "success" : "failure"}`}>
          <b>{result.ok ? `ส่ง LINE สำเร็จ · ราคา ${fmt(result.livePrice)}` : "ส่งไม่สำเร็จ"}</b>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
      <small>ปุ่มนี้เป็นการทดสอบทิศทางที่ผู้ใช้เลือก แต่ Entry/TP/SL ใช้ราคาตลาดและ ATR ล่าสุดจริง ไม่ใช่คำแนะนำให้เปิดออร์เดอร์</small>
    </section>
  );
}

function AlertControl({ settings, setSettings, enabled, onEnable, onTest }) {
  return (
    <section className="panel alertControl">
      <div className="alertControlHead">
        <div><p className="eyebrow">PRO ALERT CENTER</p><h2>เสียงและการแจ้งเตือน</h2></div>
        <button onClick={onEnable}>{enabled ? "ALERT READY" : "เปิดระบบเตือน"}</button>
      </div>
      <div className="alertOptions">
        {[
          ["sound", "เสียงสัญญาณ"],
          ["voice", "เสียงพูด"],
          ["notifications", "Browser Notification"],
          ["vibration", "สั่นบนมือถือ"],
          ["expirySound", "เตือนเมื่อสัญญาณหมด"]
        ].map(([key, label]) => (
          <label key={key}><input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.checked }))}/><span>{label}</span></label>
        ))}
      </div>
      <div className="alertSliders">
        <label>ระดับเสียง <b>{Math.round(settings.volume * 100)}%</b><input type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={(event) => setSettings((current) => ({ ...current, volume: Number(event.target.value) }))}/></label>
        <label>Cooldown <b>{settings.cooldown} นาที</b><select value={settings.cooldown} onChange={(event) => setSettings((current) => ({ ...current, cooldown: Number(event.target.value) }))}><option value="5">5 นาที</option><option value="10">10 นาที</option><option value="15">15 นาที</option><option value="30">30 นาที</option></select></label>
        <button className="testAlert" onClick={onTest}>ทดสอบเสียง</button>
      </div>
      <small>เบราว์เซอร์จะอนุญาตเสียงหลังจากกด “เปิดระบบเตือน” อย่างน้อยหนึ่งครั้ง และ iPhone ต้องเปิดหน้าเว็บค้างไว้เพื่อให้เสียงทำงาน</small>
    </section>
  );
}

const strengthLabel = (score = 0) => {
  const value = Math.abs(Number(score));
  if (value >= 4.2) return "STRONG";
  if (value >= 2.35) return "MODERATE";
  return "WEAK";
};

function SignalCard({ title, data, minutes }) {
  const direction = data?.direction || "WAIT";
  const confidence = data?.confidence || 0;
  const reliability = data?.reliability || 0;
  return (
    <section className={`panel signal ${directionClass(direction)}`}>
      <div className="signalTop"><p className="eyebrow">{title}</p><span>{strengthLabel(data?.score)}</span></div>
      <div className="signalValue">{direction}</div>
      <div className="signalStats"><b>Signal confidence {confidence}%</b><b>Reliability {reliability}%</b></div>{data?.waitReason && <small className="waitReason">WAIT: {data.waitReason}</small>}
      <div className="meter"><i style={{ width: `${confidence}%` }} /></div>
      <small>แท่งถัดไป · ประเมินจากข้อมูลล่าสุด {minutes} นาที</small>
    </section>
  );
}

function Metric({ label, value }) {
  return <div className="row"><span>{label}</span><b>{value}</b></div>;
}

function ForecastMatrix({ analysis }) {
  const forecasts = analysis?.forecasts || [];
  return (
    <section className="panel forecastPanel">
      <div className="head">
        <div><p className="eyebrow">NEXT 3–5 CANDLES</p><h2>ความน่าจะเป็นรายแท่ง</h2></div>
        <span className="reliability">Reliability {analysis?.reliability || 0}%</span>
      </div>
      <div className="forecastGrid">
        {[1, 2, 3, 4, 5].map((n) => {
          const item = forecasts[n - 1];
          const dir = item?.direction || "WAIT";
          return (
            <div className={`forecast ${directionClass(dir)}`} key={n}>
              <small>CANDLE {n}</small><strong>{dir}</strong><b>{item?.confidence || 0}%</b>{item?.rawDirection && item.rawDirection !== dir && <em>RAW BIAS {item.rawDirection}</em>}
              <div className="prob"><span>B {item?.probabilities?.buy || 0}</span><span>S {item?.probabilities?.sell || 0}</span><span>W {item?.probabilities?.wait || 0}</span></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}


function HistoricalPatternPanel({ analysis }) {
  const hp = analysis?.historicalPattern;
  if (!hp) return null;
  return (
    <section className="panel historyPanel">
      <div className="head">
        <div><p className="eyebrow">HISTORICAL PATTERN ENGINE</p><h2>สถิติอดีตที่คล้ายกับตลาดปัจจุบัน</h2></div>
        <span className="reliability">Similarity {hp.averageSimilarity}%</span>
      </div>
      <div className="historyStats">
        <span>แท่งต้นทาง <b>{hp.sourceCandles?.toLocaleString()}</b></span>
        <span>กรณีใช้ได้ <b>{hp.usableHistoricalCases?.toLocaleString()}</b></span>
        <span>กรณีใกล้เคียง <b>{hp.matchedCases?.toLocaleString()}</b></span>
        <span>Walk-forward <b>{hp.validation?.accuracy || 0}%</b></span>
      </div>
      <div className="historyForecasts">
        {(hp.forecasts || []).map((item) => (
          <div className={`historyForecast ${directionClass(item.direction)}`} key={item.candle}>
            <small>CANDLE {item.candle}</small><strong>{item.direction}</strong><b>{item.confidence}%</b>
            <div className="prob"><span>B {item.probabilities.buy}</span><span>S {item.probabilities.sell}</span><span>W {item.probabilities.wait}</span></div>
          </div>
        ))}
      </div>
      <div className="sequenceList">
        <p className="eyebrow">TOP 3-CANDLE SEQUENCES</p>
        {(hp.topSequences || []).slice(0, 5).map((item, index) => (
          <div className="sequenceRow" key={item.sequence}><span>#{index + 1} {item.sequence}</span><b>{item.probability}%</b></div>
        ))}
      </div>
      <small>{hp.engine} · Validation {hp.validation?.samples || 0} samples · {hp.note}</small>
    </section>
  );
}

function DecisionPanel({ data, alertState, onEnableAlerts }) {
  const d = data?.tradeDecision;
  if (!d) return null;
  const cls = directionClass(d.direction);
  return (
    <>
      {alertState?.show && (
        <section className={`entryAlert ${cls}`}>
          <div><small>ORDER ALERT · ORDER × 3</small><strong>{alertState?.message || d.decision}</strong><span>พบโอกาสเข้าเทรดใหม่ · {d.mode === "COUNTER_TREND" ? "สวนเทรนด์" : "ตามเทรนด์"}</span></div>
          <button onClick={onEnableAlerts}>{alertState.enabled ? "การแจ้งเตือนเปิดอยู่" : "เปิดเสียง/แจ้งเตือน"}</button>
        </section>
      )}
      <section className={`panel decisionPanel ${cls}`}>
        <div className="decisionHead"><div><p className="eyebrow">DUAL-DIRECTION ENTRY ENGINE</p><h2>{d.decision}</h2><small className="modeBadge">{d.mode}</small></div><strong>{d.targetProbability}%</strong></div>
        <div className="decisionGrid">
          <span>Status <b>{d.status}</b></span>
          <span>5M Trend <b>{d.mainTrend}</b></span>
          <span>Forecast 3 <b>{d.forecast3?.direction || "WAIT"} {d.forecast3?.confidence || 0}%</b></span>
          <span>Forecast 5 <b>{d.forecast5?.direction || "WAIT"} {d.forecast5?.confidence || 0}%</b></span>
          <span>$1 Probability <b>{d.targetProbability}%</b></span>
          <span>Expected Move <b>{d.expectedMove > 0 ? "+" : ""}{fmt(d.expectedMove)}</b></span>
          <span>Target Price <b>{fmt(d.targetPrice)}</b></span>
          <span>Entry Quality <b>{d.entryQuality}/100</b></span>
          <span>Entry Price <b>{fmt(d.entryPrice)}</b></span>
          <span>TP1 <b>{fmt(d.takeProfit?.tp1)} · {d.takeProfit?.tp1Chance || 0}%</b></span>
          <span>TP2 <b>{fmt(d.takeProfit?.tp2)} · {d.takeProfit?.tp2Chance || 0}%</b></span>
          <span>TP3 <b>{fmt(d.takeProfit?.tp3)} · {d.takeProfit?.tp3Chance || 0}%</b></span>
          <span>Stop Loss <b>{fmt(d.stopLoss)}</b></span>
          <span>Risk : Reward <b>1:{fmt(d.riskReward?.tp1)} / 1:{fmt(d.riskReward?.tp2)}</b></span>
          <span>Holding Estimate <b>{d.expectedHoldingMinutes || "—"} นาที</b></span>
          <span>Exit Manager <b>{d.exitAdvice || "—"}</b></span>
          <span>Partial Close <b>{d.partialClose ? `${d.partialClose.tp1} / ${d.partialClose.tp2} / ${d.partialClose.tp3}` : "—"}</b></span>
        </div>
        <div className="decisionReasons">{(d.reasons || []).map((r) => <span key={r}>• {r}</span>)}</div>
        <small>{d.note}</small>
      </section>
    </>
  );
}

function QAAuditPanel({ decision }) {
  const qa = decision?.qa;
  if (!qa) return null;
  const checks = qa.checks || {};
  const breakdown = decision?.scoreBreakdown || {};
  return (
    <section className={`panel qaPanel ${qa.passed ? "qaPass" : "qaReject"}`}>
      <div className="head">
        <div><p className="eyebrow">SIGNAL QA AUDIT</p><h2>{qa.passed ? `PASSED · GRADE ${qa.grade}` : "REJECTED"}</h2></div>
        <strong>{decision.signalScore || 0}/100</strong>
      </div>
      <div className="qaChecks">
        <span>{checks.forecastAgreement ? "✓" : "✕"} Forecast agreement</span>
        <span>{checks.adequateSamples ? "✓" : "✕"} Historical samples</span>
        <span>{checks.scoreGate ? "✓" : "✕"} Score gate</span>
        <span>{checks.riskAccepted ? "✓" : "✕"} Risk gate</span>
        <span>{checks.setupValid ? "✓" : "✕"} Setup validity</span>
      </div>
      <div className="decisionGrid">
        <span>Validation <b>{qa.validationAccuracy}% / {qa.validationSamples} samples</b></span>
        <span>Pattern test <b>{qa.patternAccuracy}% / {qa.patternSamples} samples</b></span>
        <span>Sample quality <b>{qa.sampleQuality}%</b></span>
        <span>Probability cap <b>{qa.evidenceCap}%</b></span>
      </div>
      <div className="qaBreakdown">
        {Object.entries(breakdown).map(([key, value]) => <span key={key}>{key}<b>{value}</b></span>)}
      </div>
      <small>{decision.probabilityLabel}. ตัวเลข Probability เป็นคะแนนประมาณการจากโมเดล ไม่ใช่ Win Rate ที่พิสูจน์แล้ว</small>
    </section>
  );
}

function ConsensusPanel({ oneMinute, fiveMinute }) {
  const one = oneMinute?.direction || "WAIT";
  const five = fiveMinute?.direction || "WAIT";
  const aligned = one === five && one !== "WAIT";
  const direction = aligned ? one : "WAIT";
  const score = aligned
    ? Math.round(((oneMinute?.confidence || 0) + (fiveMinute?.confidence || 0) + (oneMinute?.reliability || 0) + (fiveMinute?.reliability || 0)) / 4)
    : Math.round(((oneMinute?.reliability || 0) + (fiveMinute?.reliability || 0)) / 2);
  const label = aligned ? `STRONG ${direction}` : one === five ? "WAIT" : "MIXED";
  return (
    <section className={`panel consensus ${directionClass(direction)}`}>
      <div><p className="eyebrow">MULTI-TIMEFRAME CONSENSUS</p><h2>{label}</h2></div>
      <div className="consensusRows">
        <span>1M <b className={directionClass(one)}>{one}</b></span>
        <span>5M <b className={directionClass(five)}>{five}</b></span>
        <span>Agreement <b>{score}%</b></span>
      </div>
      <div className="meter"><i style={{ width: `${score}%` }} /></div>
    </section>
  );
}

function TradeZone({ analysis, price }) {
  const support = analysis?.levels?.support;
  const resistance = analysis?.levels?.resistance;
  const span = Number.isFinite(support) && Number.isFinite(resistance) ? resistance - support : 0;
  const position = span > 0 ? Math.max(0, Math.min(100, ((price - support) / span) * 100)) : 50;
  const risk = analysis?.riskLevel || "—";
  return (
    <section className="panel tradeZone">
      <div className="head"><div><p className="eyebrow">TRADE ZONE</p><h2>ตำแหน่งราคาปัจจุบัน</h2></div><span className={`risk risk-${String(risk).toLowerCase()}`}>RISK {risk}</span></div>
      <div className="zoneLabels"><span>S {fmt(support)}</span><b>{fmt(price)}</b><span>R {fmt(resistance)}</span></div>
      <div className="zoneTrack"><i style={{ left: `${position}%` }} /></div>
      <div className="zoneMeta"><span>Entry score <b>{analysis?.entryScore || 0}/100</b></span><span>{analysis?.entryNote || "รอข้อมูล"}</span></div>
    </section>
  );
}

function ScoreCard({ label, value, note }) {
  return <section className="panel mini"><p className="eyebrow">{label}</p><strong>{value}</strong><small>{note}</small></section>;
}

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState("oneMinute");
  const [countdown, setCountdown] = useState(20);
  const [sessionMode, setSessionMode] = useState("ACTIVE");
  const [alertState, setAlertState] = useState({ show: false, enabled: false, message: "" });
  const [alertSettings, setAlertSettings] = useState(DEFAULT_ALERT_SETTINGS);
  const previousSignalRef = useRef({ status: "WEAK", key: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/gold", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.message || "โหลดข้อมูลไม่สำเร็จ");
      setData(json); setError(""); setCountdown(json?.market?.isOpen === false ? 300 : 20);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let refreshTimer;
    let stopped = false;
    let lastActivityAt = Date.now();
    const ACTIVE_SECONDS = 20;
    const IDLE_SECONDS = 300;
    const IDLE_AFTER_MS = 15 * 60 * 1000;

    const schedule = () => {
      clearTimeout(refreshTimer);
      if (stopped) return;
      if (document.hidden) {
        setSessionMode("PAUSED");
        setCountdown(0);
        return;
      }
      const idle = Date.now() - lastActivityAt >= IDLE_AFTER_MS;
      const seconds = idle ? IDLE_SECONDS : ACTIVE_SECONDS;
      setSessionMode(idle ? "IDLE" : "ACTIVE");
      setCountdown(seconds);
      refreshTimer = setTimeout(async () => {
        await load();
        schedule();
      }, seconds * 1000);
    };

    const markActive = () => {
      const wasIdle = Date.now() - lastActivityAt >= IDLE_AFTER_MS;
      lastActivityAt = Date.now();
      if (!document.hidden && wasIdle) load();
      schedule();
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        lastActivityAt = Date.now();
        load();
      }
      schedule();
    };

    load();
    schedule();
    const ticker = setInterval(() => {
      setCountdown((value) => value > 0 ? value - 1 : 0);
    }, 1000);
    const events = ["pointerdown", "keydown", "touchstart", "scroll"];
    events.forEach((event) => window.addEventListener(event, markActive, { passive: true }));
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopped = true;
      clearTimeout(refreshTimer);
      clearInterval(ticker);
      events.forEach((event) => window.removeEventListener(event, markActive));
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load]);


  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("goldPulseAlertSettings");
      if (saved) setAlertSettings({ ...DEFAULT_ALERT_SETTINGS, ...JSON.parse(saved) });
      const unlocked = window.localStorage.getItem("goldPulseAlertsEnabled") === "true";
      setAlertState((current) => ({ ...current, enabled: unlocked }));
    } catch {}
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem("goldPulseAlertSettings", JSON.stringify(alertSettings)); } catch {}
  }, [alertSettings]);


  useEffect(() => {
    const d = data?.tradeDecision;
    if (!d) return;
    const previous = previousSignalRef.current;
    const entering = d.status === "ENTRY" && d.alertKey && (previous.status !== "ENTRY" || previous.key !== d.alertKey);
    const expired = previous.status === "ENTRY" && d.status !== "ENTRY";
    previousSignalRef.current = { status: d.status, key: d.alertKey || "" };

    if (expired && alertState.enabled && alertSettings.expirySound) {
      tonePattern("EXPIRED", alertSettings.volume * 0.65);
      if (alertSettings.voice && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance("Signal expired. Please wait.");
        utterance.rate = 0.95; utterance.volume = alertSettings.volume;
        window.speechSynthesis.speak(utterance);
      }
      setAlertState((current) => ({ ...current, show: true, message: "SIGNAL EXPIRED — WAIT" }));
      const timer = setTimeout(() => setAlertState((current) => ({ ...current, show: false })), 12000);
      return () => clearTimeout(timer);
    }

    if (!entering) return;
    const lastAt = Number(window.localStorage.getItem("goldPulseLastEntryAt") || 0);
    const cooldownMs = Number(alertSettings.cooldown || 10) * 60 * 1000;
    if (Date.now() - lastAt < cooldownMs) return;
    window.localStorage.setItem("goldPulseLastEntryKey", d.alertKey);
    window.localStorage.setItem("goldPulseLastEntryAt", String(Date.now()));
    setAlertState((current) => ({ ...current, show: true, message: d.decision }));

    if (alertState.enabled) {
      const strong = Number(d.targetProbability) >= 80;
      const tone = strong ? `STRONG_${d.direction}` : `${d.mode === "COUNTER_TREND" ? "COUNTER" : "TREND"}_${d.direction}`;
      if (alertSettings.sound) tonePattern(tone, alertSettings.volume);
      if (alertSettings.vibration && navigator.vibrate) navigator.vibrate(strong ? [500, 180, 500] : [180, 80, 180]);
      if (alertSettings.notifications && "Notification" in window && Notification.permission === "granted") {
        new Notification(`GOLD PULSE: ${d.decision}`, { body: `Probability ${d.targetProbability}% · ${d.mode} · Target ${fmt(d.targetPrice)}` });
      }
      if (alertSettings.voice && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance("Order. Order. Order.");
        utterance.rate = 0.82; utterance.pitch = 1.0; utterance.volume = alertSettings.volume;
        window.speechSynthesis.speak(utterance);
      }
    }
    const timer = setTimeout(() => setAlertState((current) => ({ ...current, show: false })), 30000);
    return () => clearTimeout(timer);
  }, [data, alertSettings, alertState.enabled]);

  const enableAlerts = useCallback(async () => {
    try {
      tonePattern("TEST", alertSettings.volume);
      if ("Notification" in window && alertSettings.notifications && Notification.permission !== "granted") {
        await Notification.requestPermission();
      }
      window.localStorage.setItem("goldPulseAlertsEnabled", "true");
      setAlertState((current) => ({ ...current, enabled: true }));
    } catch {
      setAlertState((current) => ({ ...current, enabled: true }));
    }
  }, [alertSettings]);

  const testAlert = useCallback(() => {
    tonePattern("TEST", alertSettings.volume);
    if (alertSettings.vibration && navigator.vibrate) navigator.vibrate([120, 60, 120]);
    if (alertSettings.voice && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance("Order. Order. Order.");
      utterance.rate = 0.82; utterance.volume = alertSettings.volume;
      window.speechSynthesis.speak(utterance);
    }
  }, [alertSettings]);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const marketClosed = data?.market?.isOpen === false;
  const nextOpen = data?.market?.nextOpenAt
    ? new Date(data.market.nextOpenAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", hour12: false, dateStyle: "medium", timeStyle: "short" })
    : "—";
  const selected = data?.[active];
  const analysis = selected?.analysis;
  const indicators = analysis?.indicators;
  const levels = analysis?.levels;
  const backtest = analysis?.backtest;
  const latest = data?.oneMinute?.candles?.at(-1);
  const updated = useMemo(() => data?.updatedAt ? new Date(data.updatedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", hour12: false }) : "—", [data]);

  return (
    <main className="shell">
      <header>
        <div><p className="over">PERSONAL XAU/USD ENGINE</p><h1>GOLD PULSE <span>X v9.0 FREE MODE</span></h1></div>
        <button onClick={load} disabled={loading}>{loading ? "กำลังโหลด..." : "อัปเดตข้อมูล"}</button>
      </header>
      <section className="panel lineStatus"><p className="eyebrow">LINE AUTOMATIC ALERT</p><b>CONNECTED · ENTRY signals broadcast automatically</b><small>ใช้ Token ฝั่ง Server · มี cooldown และป้องกันสัญญาณซ้ำตาม alert key</small></section>

      {error && <div className="error"><b>ยังเชื่อมข้อมูลไม่ได้</b><span>{error}</span></div>}

      {marketClosed && (
        <section className="panel marketClosed">
          <div><p className="eyebrow">MARKET STATUS</p><h2>MARKET CLOSED</h2><p>ตลาดทองคำ Spot ปิดช่วงสุดสัปดาห์ ระบบหยุดเรียก Twelve Data อัตโนมัติเพื่อประหยัดเครดิต</p></div>
          <div className="marketClosedMeta"><span>เหตุผล <b>WEEKEND</b></span><span>คาดว่าเปิดอีกครั้ง <b>{nextOpen}</b></span><span>API usage <b>0 credits while closed</b></span></div>
        </section>
      )}

      <section className="hero">
        <section className="panel price"><p className="eyebrow">XAU/USD · LAST CLOSED CANDLE</p><strong>{latest ? fmt(latest.close) : "—"}</strong><small>{marketClosed ? `MARKET CLOSED · เปิดโดยประมาณ ${nextOpen} · ไม่เรียก API ระหว่างตลาดปิด` : `${latest?.datetime || "รอข้อมูล"} · ${sessionMode === "PAUSED" ? "พักอัตโนมัติเมื่อซ่อนหน้าเว็บ" : `ตรวจข้อมูลใน ${countdown}s`} · Smart Session ${sessionMode} · ข้อมูลตลาดใหม่ตาม Free API cache ประมาณทุก 4 นาที · ไม่ล็อกเวลาใช้งาน`}</small></section>
        <SignalCard title="1M MODEL" data={marketClosed ? null : data?.oneMinute?.analysis} minutes={3} />
        <SignalCard title="5M MODEL" data={marketClosed ? null : data?.fiveMinute?.analysis} minutes={15} />
      </section>

      {!marketClosed ? <>
      <AlertControl settings={alertSettings} setSettings={setAlertSettings} enabled={alertState.enabled} onEnable={enableAlerts} onTest={testAlert} />
      <LineTestPanel data={data} />

      <DecisionPanel data={data} alertState={alertState} onEnableAlerts={enableAlerts} />
          <QAAuditPanel decision={data?.tradeDecision} />

      <ConsensusPanel oneMinute={data?.oneMinute?.analysis} fiveMinute={data?.fiveMinute?.analysis} />

      <HistoricalPatternPanel analysis={analysis} />

      <ForecastMatrix analysis={analysis} />

      <TradeZone analysis={analysis} price={selected?.candles?.at(-1)?.close} />

      <section className="scoreGrid">
        <ScoreCard label="TREND SCORE" value={`${analysis?.trendScore || 0}/100`} note={analysis?.trendBias || "—"} />
        <ScoreCard label="MOMENTUM" value={`${analysis?.momentumScore || 0}/100`} note={analysis?.momentumState || "—"} />
        <ScoreCard label="MARKET" value={analysis?.marketCondition || "—"} note="ADX + EMA distance" />
        <ScoreCard label="VOLATILITY" value={analysis?.volatility || "—"} note="ATR เทียบค่าเฉลี่ย" />
      </section>

      <section className="grid">
        <section className="panel chart">
          <div className="head">
            <div><p className="eyebrow">CLOSED CANDLE CHART</p><h2>{active === "oneMinute" ? "1 MINUTE" : "5 MINUTES"}</h2></div>
            <div className="tabs"><button className={active === "oneMinute" ? "on" : ""} onClick={() => setActive("oneMinute")}>1M</button><button className={active === "fiveMinute" ? "on" : ""} onClick={() => setActive("fiveMinute")}>5M</button></div>
          </div>
          <div className="legend"><span>EMA9</span><span>EMA21</span><span>EMA50</span></div>
          {selected?.candles?.length ? <CandleChart candles={selected.candles} /> : <div className="empty">รอข้อมูลแท่งราคา</div>}
        </section>

        <aside className="panel">
          <p className="eyebrow">MODEL DETAILS</p>
          <Metric label="Direction score" value={fmt(analysis?.score, 2)} />
          <Metric label="Signal strength" value={strengthLabel(analysis?.score)} />
          <Metric label="Reliability" value={`${analysis?.reliability || 0}%`} />
          <Metric label="Market condition" value={analysis?.marketCondition || "—"} />
          <Metric label="Risk level" value={analysis?.riskLevel || "—"} />
          <Metric label="Smart entry score" value={`${analysis?.entryScore || 0}/100`} />
          <Metric label="EMA 9 / 21" value={`${fmt(indicators?.ema9)} / ${fmt(indicators?.ema21)}`} />
          <Metric label="EMA 50 / 200" value={`${fmt(indicators?.ema50)} / ${fmt(indicators?.ema200)}`} />
          <Metric label="RSI 14" value={fmt(indicators?.rsi, 1)} />
          <Metric label="ATR 14" value={fmt(indicators?.atr, 3)} />
          <Metric label="ADX 14" value={fmt(indicators?.adx, 1)} />
          <Metric label="+DI / -DI" value={`${fmt(indicators?.plusDI, 1)} / ${fmt(indicators?.minusDI, 1)}`} />
          <Metric label="MACD histogram" value={fmt(indicators?.macdHistogram, 4)} />
          <Metric label="Support" value={fmt(levels?.support)} />
          <Metric label="Resistance" value={fmt(levels?.resistance)} />
          <Metric label="Pattern backtest" value={`${backtest?.patternAccuracy || 0}% / ${backtest?.patternSamples || 0}`} />
          <Metric label="Overall decided" value={`${backtest?.decidedAccuracy || 0}% / ${backtest?.decidedSamples || 0}`} />
          <Metric label="Updated" value={updated} />
        </aside>
      </section>

      <section className="panel reasons"><p className="eyebrow">เหตุผลของโมเดล · {active === "oneMinute" ? "1M" : "5M"}</p><div className="reasonGrid">{(analysis?.reasons || ["รอข้อมูลวิเคราะห์"]).map((reason) => <div className="reason" key={reason}>{reason}</div>)}</div></section>

      <section className="panel logic"><p className="eyebrow">MODEL LOGIC v9.0 SERVER ALERT</p><h2>ตัดสัญญาณอ่อนออกก่อนแสดง BUY หรือ SELL</h2><p>ระบบรองรับทั้งการเข้าแบบตามเทรนด์และสวนเทรนด์ โดยใช้ Forecast 3/5 แท่ง, EMA, RSI, ATR, MACD, ADX และตำแหน่งแนวรับแนวต้านร่วมกัน ระบบผ่อนเกณฑ์เพื่อเพิ่มความถี่ แต่จะตัดสัญญาณทันทีเมื่อคุณภาพต่ำ ความเสี่ยงสูง หรือ Forecast ไม่สอดคล้อง ผลลัพธ์เป็นการประเมินเชิงสถิติ ไม่ใช่คำแนะนำทางการเงิน และควรใช้ร่วมกับการบริหารความเสี่ยงเสมอ</p></section>
      </> : (
        <section className="panel closedChart">
          <p className="eyebrow">CLOSED CANDLE CHART</p>
          <div className="empty">ตลาดปิดช่วงสุดสัปดาห์<br/><small>ระบบจะกลับมาดึงข้อมูลอัตโนมัติเมื่อ session เปิด</small></div>
        </section>
      )}
    </main>
  );
}
