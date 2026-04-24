"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Voice-assistant orb. A living plasma sphere that reacts to audio —
 * no glyph, no letter. Inspired by ChatGPT voice mode / Siri.
 *
 * The core is an SVG circle with multiple blurred radial-gradient blobs
 * inside. The blobs drift on slow parametric paths so the orb feels
 * alive even in idle; speaking/listening/thinking states swap colour
 * palettes and amplify motion. Outer layers add rings that expand when
 * the assistant speaks plus a subtle reactive halo keyed to mic input.
 *
 * Everything uses transforms and opacity only — no layout thrash, no
 * page reflow, and no RAF churn beyond the smoother.
 */
export type OrbState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

type Blob = {
  id: number;
  cx: number;
  cy: number;
  r: number;
  phaseX: number;
  phaseY: number;
  speedX: number;
  speedY: number;
  colorIdx: 0 | 1 | 2;
};

const BLOBS: Blob[] = [
  { id: 0, cx: 50, cy: 45, r: 38, phaseX: 0.0, phaseY: 0.5, speedX: 0.00025, speedY: 0.00033, colorIdx: 0 },
  { id: 1, cx: 60, cy: 55, r: 34, phaseX: 1.4, phaseY: 2.1, speedX: 0.00028, speedY: 0.00021, colorIdx: 1 },
  { id: 2, cx: 42, cy: 58, r: 30, phaseX: 2.7, phaseY: 0.9, speedX: 0.00019, speedY: 0.00037, colorIdx: 2 },
  { id: 3, cx: 55, cy: 40, r: 26, phaseX: 3.9, phaseY: 1.6, speedX: 0.00031, speedY: 0.00024, colorIdx: 0 },
  { id: 4, cx: 48, cy: 52, r: 22, phaseX: 5.1, phaseY: 3.0, speedX: 0.00023, speedY: 0.00030, colorIdx: 1 },
];

export default function AgentOrb({
  state,
  assistantLevel,
  userLevel,
  className,
  size = 260,
}: {
  state: OrbState;
  assistantLevel: number;
  userLevel: number;
  className?: string;
  size?: number;
}) {
  const sphereRef = useRef<HTMLDivElement | null>(null);
  const haloRef = useRef<HTMLDivElement | null>(null);
  const micRingRef = useRef<HTMLDivElement | null>(null);
  const logoRef = useRef<HTMLDivElement | null>(null);
  const blobRefs = useRef<(SVGCircleElement | null)[]>([]);
  const levelsRef = useRef({ a: 0, u: 0 });

  useEffect(() => {
    levelsRef.current.a = assistantLevel;
    levelsRef.current.u = userLevel;
  }, [assistantLevel, userLevel]);

  useEffect(() => {
    let raf = 0;
    let t0 = performance.now();
    const smooth = { a: 0, u: 0 };

    const tick = (t: number) => {
      const dt = t - t0;
      smooth.a += (levelsRef.current.a - smooth.a) * 0.18;
      smooth.u += (levelsRef.current.u - smooth.u) * 0.18;

      // Core sphere pulse
      if (sphereRef.current) {
        const s = 1 + smooth.a * 0.085;
        sphereRef.current.style.transform = `scale(${s})`;
      }
      // Outer soft glow
      if (haloRef.current) {
        const op = 0.42 + smooth.a * 0.55;
        const s = 1 + smooth.a * 0.18;
        haloRef.current.style.opacity = String(Math.min(1, op));
        haloRef.current.style.transform = `scale(${s})`;
      }
      // Mic input reactive ring
      if (micRingRef.current) {
        const s = 1 + smooth.u * 0.12;
        const op = 0.22 + smooth.u * 0.6;
        micRingRef.current.style.transform = `scale(${s})`;
        micRingRef.current.style.opacity = String(op);
      }
      // Grok logo watermark — gentle breathe with assistant voice
      if (logoRef.current) {
        const s = 1 + smooth.a * 0.09;
        const op = 0.55 + smooth.a * 0.35;
        logoRef.current.style.transform = `scale(${s})`;
        logoRef.current.style.opacity = String(Math.min(1, op));
      }
      // Move each blob on a parametric path (so the orb feels alive).
      for (let i = 0; i < BLOBS.length; i++) {
        const el = blobRefs.current[i];
        if (!el) continue;
        const b = BLOBS[i];
        const amp = 8 + smooth.a * 18;
        const dx = Math.sin(b.phaseX + dt * b.speedX) * amp;
        const dy = Math.cos(b.phaseY + dt * b.speedY) * amp;
        el.setAttribute("cx", String(b.cx + dx));
        el.setAttribute("cy", String(b.cy + dy));
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const palette = paletteFor(state);

  return (
    <div
      className={cn(
        "relative flex items-center justify-center select-none",
        className
      )}
      style={{ width: size, height: size }}
    >
      {/* 1. Ambient halo glow */}
      <div
        ref={haloRef}
        aria-hidden
        className="absolute inset-0 rounded-full blur-3xl transition-[background] duration-700"
        style={{
          background: `radial-gradient(closest-side, ${palette.glow}, transparent 72%)`,
          opacity: 0.5,
        }}
      />

      {/* 2. Slow rotating conic trim */}
      <div
        aria-hidden
        className="absolute rounded-full mix-blend-screen orb-rotate"
        style={{
          width: size * 0.98,
          height: size * 0.98,
          animationDuration: "18s",
          background: `conic-gradient(from 0deg, ${palette.a}00, ${palette.a}55, ${palette.b}44, ${palette.c}44, ${palette.a}00)`,
          filter: "blur(18px)",
          opacity: 0.65,
        }}
      />

      {/* 3. Speaking rings */}
      {state === "speaking" && (
        <>
          <div
            aria-hidden
            className="absolute rounded-full orb-ring border-2"
            style={{
              width: size * 0.86,
              height: size * 0.86,
              borderColor: `${palette.a}55`,
            }}
          />
          <div
            aria-hidden
            className="absolute rounded-full orb-ring orb-ring-delay-1 border"
            style={{
              width: size * 0.86,
              height: size * 0.86,
              borderColor: `${palette.b}55`,
            }}
          />
          <div
            aria-hidden
            className="absolute rounded-full orb-ring orb-ring-delay-2 border"
            style={{
              width: size * 0.86,
              height: size * 0.86,
              borderColor: `${palette.c}55`,
            }}
          />
        </>
      )}

      {/* 4. Mic input reactive ring */}
      <div
        ref={micRingRef}
        aria-hidden
        className="absolute rounded-full transition-colors duration-500"
        style={{
          width: size * 0.82,
          height: size * 0.82,
          border: `1px solid ${palette.a}55`,
          boxShadow: `inset 0 0 24px ${palette.a}18, 0 0 30px ${palette.a}22`,
        }}
      />

      {/* 5. Core sphere — plasma blobs */}
      <div
        ref={sphereRef}
        className="relative rounded-full overflow-hidden"
        style={{
          width: size * 0.74,
          height: size * 0.74,
          boxShadow: `
            inset 0 0 0 1px rgba(255,255,255,0.08),
            inset 0 20px 40px -18px rgba(255,255,255,0.18),
            inset 0 -40px 60px -30px rgba(0,0,0,0.6),
            0 24px 60px -18px rgba(0,0,0,0.8),
            0 0 60px ${palette.a}33
          `,
          background:
            "radial-gradient(circle at 35% 28%, rgba(255,255,255,0.14), rgba(10,11,14,0.95) 70%)",
        }}
      >
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 w-full h-full"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden
        >
          <defs>
            {["a", "b", "c"].map((key, i) => (
              <radialGradient
                key={key}
                id={`orb-blob-${key}`}
                cx="50%"
                cy="50%"
                r="50%"
              >
                <stop
                  offset="0%"
                  stopColor={[palette.a, palette.b, palette.c][i]}
                  stopOpacity="0.95"
                />
                <stop
                  offset="60%"
                  stopColor={[palette.a, palette.b, palette.c][i]}
                  stopOpacity="0.35"
                />
                <stop
                  offset="100%"
                  stopColor={[palette.a, palette.b, palette.c][i]}
                  stopOpacity="0"
                />
              </radialGradient>
            ))}
            <filter
              id="orb-blur"
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feGaussianBlur in="SourceGraphic" stdDeviation="4" />
            </filter>
          </defs>
          <g filter="url(#orb-blur)" style={{ mixBlendMode: "screen" }}>
            {BLOBS.map((b, i) => (
              <circle
                key={b.id}
                ref={(el) => {
                  blobRefs.current[i] = el;
                }}
                cx={b.cx}
                cy={b.cy}
                r={b.r}
                fill={`url(#orb-blob-${["a", "b", "c"][b.colorIdx]})`}
                opacity={0.85}
              />
            ))}
          </g>
        </svg>

        {/* Grok logo watermark — sits above the plasma, below the sheen.
           Drop-shadow is tinted by state so the logo picks up the vibe. */}
        <div
          ref={logoRef}
          aria-hidden
          className="absolute inset-0 flex items-center justify-center pointer-events-none transition-[filter] duration-500"
          style={{
            filter: `drop-shadow(0 0 14px ${palette.a}99) drop-shadow(0 0 28px ${palette.b}55)`,
            mixBlendMode: "screen",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/grok.png"
            alt=""
            className="select-none"
            draggable={false}
            style={{
              width: "46%",
              height: "46%",
              objectFit: "contain",
            }}
          />
        </div>

        {/* Top highlight sheen */}
        <div
          aria-hidden
          className="absolute inset-x-[12%] top-[6%] h-[32%] rounded-full pointer-events-none"
          style={{
            background:
              "linear-gradient(to bottom, rgba(255,255,255,0.26), transparent)",
            filter: "blur(8px)",
            opacity: 0.9,
          }}
        />

        {/* Subtle vignette ring */}
        <div
          aria-hidden
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, transparent 62%, rgba(0,0,0,0.55) 100%)",
          }}
        />
      </div>

      {/* Thin outermost orbit line for polish */}
      <div
        aria-hidden
        className="absolute rounded-full orb-rotate"
        style={{
          width: size * 0.94,
          height: size * 0.94,
          animationDuration: "48s",
          border: "1px dashed rgba(255,255,255,0.06)",
        }}
      />
    </div>
  );
}

function paletteFor(state: OrbState) {
  switch (state) {
    case "idle":
      return {
        a: "#8b5cf6",
        b: "#c9f26c",
        c: "#a855f7",
        glow: "rgba(139, 92, 246, 0.45)",
      };
    case "connecting":
      return {
        a: "#fcd34d",
        b: "#c9f26c",
        c: "#8b5cf6",
        glow: "rgba(252, 211, 77, 0.5)",
      };
    case "listening":
      return {
        a: "#c9f26c",
        b: "#a3e635",
        c: "#8b5cf6",
        glow: "rgba(201, 242, 108, 0.55)",
      };
    case "thinking":
      return {
        a: "#a855f7",
        b: "#c9f26c",
        c: "#8b5cf6",
        glow: "rgba(168, 85, 247, 0.6)",
      };
    case "speaking":
      return {
        a: "#ff6b35",
        b: "#c9f26c",
        c: "#a855f7",
        glow: "rgba(255, 107, 53, 0.6)",
      };
    case "error":
      return {
        a: "#ef4444",
        b: "#f97316",
        c: "#fcd34d",
        glow: "rgba(239, 68, 68, 0.6)",
      };
  }
}
