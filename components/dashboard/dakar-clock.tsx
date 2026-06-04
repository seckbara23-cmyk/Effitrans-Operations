"use client";

import { useEffect, useState } from "react";

/** Dakar runs on GMT year-round (no daylight saving). */
function dakarTime(): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Dakar",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export function DakarClock({ className }: { className?: string }) {
  // Start null so server and first client render match (no hydration mismatch);
  // the effect fills in the live time right after mount.
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setTime(dakarTime());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className={className}>
      Dakar · {time ?? "--:--"} GMT
    </span>
  );
}
