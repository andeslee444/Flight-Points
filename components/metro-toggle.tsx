'use client';

import { useSearchStore } from '@/stores/search-store';
import { Button } from '@/components/ui/button';

export function MetroToggle() {
  const { showAllAirports, setShowAllAirports } = useSearchStore();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setShowAllAirports(!showAllAirports)}
      className="text-xs text-muted-foreground hover:text-foreground"
    >
      {showAllAirports ? 'Group nearby airports' : 'Show all airports'}
    </Button>
  );
}
