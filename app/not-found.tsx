'use client';

import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="container mx-auto px-4 py-16">
      <div className="max-w-md mx-auto text-center">
        <p className="text-sm font-semibold text-primary mb-2">404</p>
        <h1 className="text-2xl font-bold mb-2">Page not found</h1>
        <p className="text-muted-foreground mb-6">
          That page doesn&apos;t exist or may have moved.
        </p>
        <Button asChild>
          <a href="/search">Back to search</a>
        </Button>
      </div>
    </main>
  );
}
