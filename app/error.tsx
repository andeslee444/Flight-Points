'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function Error({
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
    <main className="container mx-auto px-4 py-16">
      <div className="max-w-md mx-auto text-center">
        <h1 className="text-2xl font-bold mb-2">Deal data is temporarily unavailable</h1>
        <p className="text-muted-foreground mb-6">
          We couldn&apos;t load the latest award flight data. This is usually
          brief — please try again in a moment.
        </p>
        <Button onClick={() => reset()}>Try again</Button>
      </div>
    </main>
  );
}
