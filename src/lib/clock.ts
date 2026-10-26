import { useEffect, useState } from "react";

/** The time, refreshed each minute, so "live" starts and ends on the clock without a reload. */
export function useMinute(): number {
  const [t, setT] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const id = window.setInterval(() => setT(Math.floor(Date.now() / 60_000)), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return t;
}
