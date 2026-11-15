import { useEffect, useState } from "react";

/**
 * True once `active` has stayed true for `ms` milliseconds; false again the moment it stops, and
 * counting starts over the next time. For "this is taking a while" messages (#38).
 */
export function useAfterDelay(active: boolean, ms = 5000): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setElapsed(true), ms);
    // The cleanup runs when `active` turns false (or the component goes away): counting starts over.
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [active, ms]);

  return active && elapsed;
}
