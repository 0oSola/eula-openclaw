"use client";

import type { CSSProperties } from "react";

const PARTICLES = [
  { left: "8%", top: "16%", size: "8px", duration: "14s", delay: "-3s" },
  { left: "18%", top: "62%", size: "10px", duration: "17s", delay: "-9s" },
  { left: "29%", top: "28%", size: "6px", duration: "13s", delay: "-5s" },
  { left: "40%", top: "72%", size: "12px", duration: "18s", delay: "-7s" },
  { left: "56%", top: "18%", size: "7px", duration: "15s", delay: "-11s" },
  { left: "64%", top: "64%", size: "9px", duration: "16s", delay: "-4s" },
  { left: "74%", top: "34%", size: "11px", duration: "19s", delay: "-12s" },
  { left: "84%", top: "56%", size: "7px", duration: "14s", delay: "-6s" },
  { left: "12%", top: "42%", size: "5px", duration: "12s", delay: "-8s" },
  { left: "90%", top: "24%", size: "6px", duration: "15s", delay: "-10s" },
];

type MioModeBackgroundProps = {
  active: boolean;
};

export function MioModeBackground({ active }: MioModeBackgroundProps) {
  if (!active) return null;

  return (
    <div className="mio-background" aria-hidden="true">
      <div className="mio-background-image" />
      <div className="mio-background-vignette" />
      <div className="mio-background-arcs">
        <span className="mio-background-arc mio-background-arc-one" />
        <span className="mio-background-arc mio-background-arc-two" />
      </div>
      <div className="mio-background-horizon" />
      <div className="mio-background-circle">
        <span className="mio-background-ring mio-background-ring-one" />
        <span className="mio-background-ring mio-background-ring-two" />
        <span className="mio-background-ring mio-background-ring-three" />
      </div>
      <div className="mio-background-particles">
        {PARTICLES.map((particle, index) => (
          <span
            key={index}
            className="mio-background-particle"
            style={
              {
                "--particle-left": particle.left,
                "--particle-top": particle.top,
                "--particle-size": particle.size,
                "--particle-duration": particle.duration,
                "--particle-delay": particle.delay,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}
