'use client';

// global-error replaces the root layout when it crashes, so it must render
// its own <html>/<body> and import global styles itself. Kept dependency-light
// (no ThemeProvider, no ui/ components) since the layout itself just failed.
import './globals.css';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log for debugging — never rendered to the user
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <main className="container mx-auto px-4 py-16">
          <div className="max-w-md mx-auto text-center">
            <h1 className="text-2xl font-bold mb-2">
              Something went wrong
            </h1>
            <p className="text-muted-foreground mb-6">
              Flight data is temporarily unavailable. Please try again in a
              moment.
            </p>
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
