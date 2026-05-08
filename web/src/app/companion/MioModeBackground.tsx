"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

const PARTICLES = [
  { kind: "orb", left: "8%", top: "68%", size: "12px", duration: "17s", delay: "-3s", alpha: "0.82", driftX: "18px", driftY: "-54px", glow: "cyan" },
  { kind: "dust", left: "18%", top: "58%", size: "5px", duration: "21s", delay: "-9s", alpha: "0.48", driftX: "12px", driftY: "-38px", glow: "ice" },
  { kind: "dust", left: "29%", top: "36%", size: "4px", duration: "19s", delay: "-5s", alpha: "0.42", driftX: "-10px", driftY: "-30px", glow: "cyan" },
  { kind: "orb", left: "40%", top: "74%", size: "10px", duration: "20s", delay: "-7s", alpha: "0.76", driftX: "14px", driftY: "-62px", glow: "cyan" },
  { kind: "dust", left: "56%", top: "48%", size: "6px", duration: "18s", delay: "-11s", alpha: "0.5", driftX: "16px", driftY: "-26px", glow: "ice" },
  { kind: "orb", left: "64%", top: "66%", size: "9px", duration: "16s", delay: "-4s", alpha: "0.68", driftX: "-12px", driftY: "-48px", glow: "cyan" },
  { kind: "dust", left: "74%", top: "40%", size: "5px", duration: "22s", delay: "-12s", alpha: "0.44", driftX: "11px", driftY: "-24px", glow: "cyan" },
  { kind: "orb", left: "84%", top: "60%", size: "11px", duration: "18s", delay: "-6s", alpha: "0.74", driftX: "-16px", driftY: "-58px", glow: "ice" },
  { kind: "dust", left: "12%", top: "46%", size: "4px", duration: "20s", delay: "-8s", alpha: "0.38", driftX: "9px", driftY: "-28px", glow: "cyan" },
  { kind: "dust", left: "90%", top: "28%", size: "4px", duration: "23s", delay: "-13s", alpha: "0.36", driftX: "-8px", driftY: "-22px", glow: "ice" },
  { kind: "orb", left: "76%", top: "52%", size: "8px", duration: "24s", delay: "-16s", alpha: "0.46", driftX: "-18px", driftY: "-32px", glow: "cyan" },
];

const STARS = [
  { left: "6%", top: "12%", size: "2px", duration: "32s", delay: "-4s", alpha: "0.44" },
  { left: "14%", top: "26%", size: "3px", duration: "28s", delay: "-11s", alpha: "0.62" },
  { left: "22%", top: "10%", size: "2px", duration: "35s", delay: "-17s", alpha: "0.38" },
  { left: "31%", top: "22%", size: "2px", duration: "30s", delay: "-8s", alpha: "0.52" },
  { left: "39%", top: "14%", size: "3px", duration: "34s", delay: "-14s", alpha: "0.58" },
  { left: "48%", top: "8%", size: "2px", duration: "29s", delay: "-6s", alpha: "0.41" },
  { left: "57%", top: "18%", size: "2px", duration: "33s", delay: "-9s", alpha: "0.47" },
  { left: "66%", top: "11%", size: "3px", duration: "31s", delay: "-15s", alpha: "0.64" },
  { left: "74%", top: "24%", size: "2px", duration: "36s", delay: "-12s", alpha: "0.43" },
  { left: "83%", top: "9%", size: "2px", duration: "27s", delay: "-7s", alpha: "0.5" },
  { left: "91%", top: "19%", size: "3px", duration: "38s", delay: "-19s", alpha: "0.57" },
  { left: "11%", top: "34%", size: "2px", duration: "33s", delay: "-13s", alpha: "0.39" },
];

const LIGHT_PILLAR_SPEC = {
  light_pillars: {
    type: "vertical_cyan_light_columns",
    position: "from upper sky to ocean horizon",
    color: "#63CFFF",
    features: [
      "thin luminous vertical beams",
      "soft cyan bloom",
      "varying height and intensity",
      "subtle reflection on ocean surface",
      "sparse distribution",
    ],
    animation: {
      motion: "slow downward slide and dissolve",
      rhythm: "staggered asynchronous loops",
      head: "small radiant source with ice blue core",
    },
  },
};

const METEORS = [
  { left: "14%", top: "8%", height: "36vh", width: "2px", duration: "12s", delay: "-5s", alpha: "0.54", travel: "18vh", headSize: "10px" },
  { left: "31%", top: "18%", height: "24vh", width: "1px", duration: "15s", delay: "-9s", alpha: "0.34", travel: "14vh", headSize: "7px" },
  { left: "48%", top: "10%", height: "34vh", width: "2px", duration: "11s", delay: "-7s", alpha: "0.66", travel: "20vh", headSize: "12px" },
  { left: "68%", top: "16%", height: "27vh", width: "1px", duration: "14s", delay: "-12s", alpha: "0.4", travel: "16vh", headSize: "8px" },
  { left: "86%", top: "6%", height: "38vh", width: "2px", duration: "13s", delay: "-10s", alpha: "0.6", travel: "19vh", headSize: "11px" },
];

type MioModeBackgroundProps = {
  active: boolean;
  speaking: boolean;
  emotion: string;
  action: string;
  activityPulse: number;
};

function resolveTimeTone(hour: number) {
  if (hour < 5) return "deep-night";
  if (hour < 8) return "dawn";
  if (hour < 17) return "day";
  if (hour < 20) return "evening";
  return "night";
}

export function MioModeBackground({ active, speaking, emotion, action, activityPulse }: MioModeBackgroundProps) {
  const [timeTone, setTimeTone] = useState("night");

  useEffect(() => {
    const syncTimeTone = () => setTimeTone(resolveTimeTone(new Date().getHours()));
    syncTimeTone();
    const intervalId = window.setInterval(syncTimeTone, 10 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  if (!active) return null;

  return (
    <div
      className="mio-background"
      data-speaking={speaking ? "true" : "false"}
      data-emotion={emotion}
      data-action={action}
      data-activity={activityPulse > 0 ? "pulse" : "idle"}
      data-time-tone={timeTone}
      aria-hidden="true"
    >
      <div className="mio-background-image" />
      <div className="mio-background-vignette" />
      <div className="mio-background-moonlight" />
      <div className="mio-background-reflection" />
      <div className="mio-background-caustics" />
      <div className="mio-background-nebula" />
      <div className="mio-background-clouds">
        <span className="mio-background-cloud mio-background-cloud-one" />
        <span className="mio-background-cloud mio-background-cloud-two" />
        <span className="mio-background-cloud mio-background-cloud-three" />
      </div>
      <div className="mio-background-stars">
        {STARS.map((star, index) => (
          <span
            key={index}
            className="mio-background-star"
            style={
              {
                "--star-left": star.left,
                "--star-top": star.top,
                "--star-size": star.size,
                "--star-duration": star.duration,
                "--star-delay": star.delay,
                "--star-alpha": star.alpha,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="mio-background-meteors">
        {METEORS.map((meteor, index) => (
          <span
            key={index}
            className="mio-background-meteor"
            style={
              {
                "--meteor-left": meteor.left,
                "--meteor-top": meteor.top,
                "--meteor-height": meteor.height,
                "--meteor-width": meteor.width,
                "--meteor-duration": meteor.duration,
                "--meteor-delay": meteor.delay,
                "--meteor-alpha": meteor.alpha,
                "--meteor-travel": meteor.travel,
                "--meteor-head-size": meteor.headSize,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="mio-background-light-pillars">
        <span className="mio-background-light-pillar mio-background-light-pillar-one" />
        <span className="mio-background-light-pillar mio-background-light-pillar-two" />
        <span className="mio-background-light-pillar mio-background-light-pillar-three" />
        <span className="mio-background-light-pillar mio-background-light-pillar-four" />
        <span className="mio-background-light-pillar mio-background-light-pillar-five" />
      </div>
      <div className="mio-background-aura" />
      <div className="mio-background-backlight" />
      <div className="mio-background-arcs">
        <span className="mio-background-arc mio-background-arc-one" />
        <span className="mio-background-arc mio-background-arc-two" />
      </div>
      <div className="mio-background-horizon" />
      <div className="mio-background-stage-trails">
        <span className="mio-background-stage-trail mio-background-stage-trail-one" />
        <span className="mio-background-stage-trail mio-background-stage-trail-two" />
        <span className="mio-background-stage-trail mio-background-stage-trail-three" />
      </div>
      <div className="mio-background-circle">
        <span className="mio-background-ring mio-background-ring-one" />
        <span className="mio-background-ring mio-background-ring-two" />
      </div>
      <div className="mio-background-ring-scans">
        <span className="mio-background-ring-scan mio-background-ring-scan-one" />
        <span className="mio-background-ring-scan mio-background-ring-scan-two" />
      </div>
      <div className="mio-background-orbiters">
        <span className="mio-background-orbiter mio-background-orbiter-one" />
        <span className="mio-background-orbiter mio-background-orbiter-two" />
        <span className="mio-background-orbiter mio-background-orbiter-three" />
        <span className="mio-background-orbiter mio-background-orbiter-four" />
      </div>
      <div className="mio-background-voice-ripples">
        <span className="mio-background-ripple mio-background-ripple-one" />
        <span className="mio-background-ripple mio-background-ripple-two" />
      </div>
      <div className="mio-background-send-wave" key={activityPulse} />
      <div className="mio-background-particles">
        {PARTICLES.map((particle, index) => (
          <span
            key={index}
            className="mio-background-particle"
            data-kind={particle.kind}
            data-glow={particle.glow}
            style={
              {
                "--particle-left": particle.left,
                "--particle-top": particle.top,
                "--particle-size": particle.size,
                "--particle-duration": particle.duration,
                "--particle-delay": particle.delay,
                "--particle-alpha": particle.alpha,
                "--particle-drift-x": particle.driftX,
                "--particle-drift-y": particle.driftY,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="mio-background-emotion-particles">
        <span className="mio-background-emotion-particle mio-background-emotion-particle-one" />
        <span className="mio-background-emotion-particle mio-background-emotion-particle-two" />
        <span className="mio-background-emotion-particle mio-background-emotion-particle-three" />
        <span className="mio-background-emotion-particle mio-background-emotion-particle-four" />
        <span className="mio-background-emotion-particle mio-background-emotion-particle-five" />
        <span className="mio-background-emotion-particle mio-background-emotion-particle-six" />
      </div>
      <div className="mio-background-foreground-particles">
        <span className="mio-background-foreground-particle mio-background-foreground-particle-one" />
        <span className="mio-background-foreground-particle mio-background-foreground-particle-two" />
        <span className="mio-background-foreground-particle mio-background-foreground-particle-three" />
        <span className="mio-background-foreground-particle mio-background-foreground-particle-four" />
        <span className="mio-background-foreground-particle mio-background-foreground-particle-five" />
      </div>
    </div>
  );
}
