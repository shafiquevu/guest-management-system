"use client";

import { useEffect } from "react";

/**
 * Run an async loader whenever it changes (i.e. when its inputs change).
 *
 * The loader sets state after awaiting the database; starting it from a
 * resolved promise keeps that out of the effect body itself.
 */
export function useLoader(loader: () => Promise<unknown> | void) {
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) loader();
    });
    return () => {
      cancelled = true;
    };
  }, [loader]);
}
