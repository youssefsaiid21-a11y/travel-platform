"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Shared "confirmed, then auto-reverts" pattern for inline success feedback
// (copy-to-clipboard, etc.) - was hand-rolled with its own useState + setTimeout
// in every component that needed it.
export function useTemporaryFlag(durationMs = 2000): [boolean, () => void] {
  const [active, setActive] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = useCallback(() => {
    setActive(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setActive(false), durationMs);
  }, [durationMs]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return [active, trigger];
}
