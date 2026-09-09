"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary (Next.js App Router). A thrown render error shows a calm
 * recovery card instead of a blank page — and never takes the nav with it.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // In a real deployment this is where Sentry.captureException(error) would go.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h2 className="text-xl font-semibold text-danger">Something went off-course</h2>
      <p className="mt-2 text-sm text-muted">
        A rendering error interrupted this view. The engine itself is unaffected — re-run
        the engagement to continue.
      </p>
      <button className="btn btn-primary mt-4" onClick={reset}>
        ↺ Try again
      </button>
    </div>
  );
}
