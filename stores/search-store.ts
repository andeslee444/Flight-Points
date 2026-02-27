'use client';

import { create } from 'zustand';

interface SearchState {
  showAllAirports: boolean; // false = metro collapsed, true = show individual airports
  setShowAllAirports: (v: boolean) => void;
}

export const useSearchStore = create<SearchState>()((set) => ({
  showAllAirports: false,
  setShowAllAirports: (v) => set({ showAllAirports: v }),
}));
