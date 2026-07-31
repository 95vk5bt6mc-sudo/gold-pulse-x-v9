"use client";

import { useEffect, useRef, useState } from "react";

function ema(values, period) {
  const output = Array(values.length).fill(null);
  if (values.length < period) return output;
  const multiplier = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i];
  output[period - 1] = seed / period;
  for (let i = period; i < values.length; i += 1) {
    output[i] = values[i] * multiplier + output[i - 1] * (1 - multiplier);
  }
  return output;
}

function toTime(datetime) {
  const iso = String(datetime || "").includes("T")
    ? String(datetime)
    : String(datetime || "").replace(" ", "T") + "+07:00";
  return Math.floor(new Date(iso).getTime() / 1000);
}

export default function CandleChart({ candles }) {
  const containerRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let chart;
    let observer;
    let cancelled = false;

    async function mount() {
      try {
        const lib = await import("lightweight-charts");
        if (cancelled || !containerRef.current) return;
        const rows = (candles || []).slice(-140).map((c) => ({
          time: toTime(c.datetime),
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close)
        })).filter((c) => Number.isFinite(c.time) && [c.open, c.high, c.low, c.close].every(Number.isFinite));
        if (!rows.length) return;

        chart = lib.createChart(containerRef.current, {
          autoSize: true,
          layout: { background: { color: "#0b1017" }, textColor: "#9da7b7" },
          grid: { vertLines: { color: "#18202b" }, horzLines: { color: "#18202b" } },
          rightPriceScale: { borderColor: "#263140" },
          timeScale: { borderColor: "#263140", timeVisible: true, secondsVisible: false },
          crosshair: { mode: 1 }
        });

        const addCandles = () => {
          if (lib.CandlestickSeries && chart.addSeries) {
            return chart.addSeries(lib.CandlestickSeries, {
              upColor: "#39d69f", downColor: "#ff6474", borderVisible: false,
              wickUpColor: "#39d69f", wickDownColor: "#ff6474"
            });
          }
          return chart.addCandlestickSeries({
            upColor: "#39d69f", downColor: "#ff6474", borderVisible: false,
            wickUpColor: "#39d69f", wickDownColor: "#ff6474"
          });
        };
        const addLine = (options) => lib.LineSeries && chart.addSeries
          ? chart.addSeries(lib.LineSeries, options)
          : chart.addLineSeries(options);

        const candleSeries = addCandles();
        candleSeries.setData(rows);

        const closes = rows.map((row) => row.close);
        const colors = ["#e3bd5c", "#7ab8ff", "#c18cff"];
        [9, 21, 50].forEach((period, index) => {
          const values = ema(closes, period);
          const line = addLine({ color: colors[index], lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
          line.setData(values.map((value, i) => value == null ? null : ({ time: rows[i].time, value })).filter(Boolean));
        });

        chart.timeScale().fitContent();
        observer = new ResizeObserver(() => chart?.timeScale().fitContent());
        observer.observe(containerRef.current);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Chart failed to load");
      }
    }

    mount();
    return () => {
      cancelled = true;
      observer?.disconnect();
      chart?.remove();
    };
  }, [candles]);

  return <div ref={containerRef} className="chartCanvas">{error ? <div className="empty">โหลดกราฟไม่สำเร็จ: {error}</div> : null}</div>;
}
