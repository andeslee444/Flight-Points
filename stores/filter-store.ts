'use client';

import { create } from 'zustand';

export type CabinFilter = 'all' | 'economy' | 'business' | 'first';
export type RegionFilter =
  | 'all'
  | 'US'
  | 'Europe'
  | 'Japan'
  | 'Korea'
  | 'China/HK/TW'
  | 'SEA'
  | 'India'
  | 'Middle East'
  | 'Australia/NZ';
export type ProgramFilter =
  | 'all'
  | 'amex-mr'
  | 'chase-ur'
  | 'citi-typ'
  | 'capital-one'
  | 'bilt';

interface DealFilterState {
  cabin: CabinFilter;
  region: RegionFilter;
  program: ProgramFilter;
  setCabin: (cabin: CabinFilter) => void;
  setRegion: (region: RegionFilter) => void;
  setProgram: (program: ProgramFilter) => void;
}

export const useDealFilterStore = create<DealFilterState>()((set) => ({
  cabin: 'all',
  region: 'all',
  program: 'all',
  setCabin: (cabin) => set({ cabin }),
  setRegion: (region) => set({ region }),
  setProgram: (program) => set({ program }),
}));
