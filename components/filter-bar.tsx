'use client';

import {
  useDealFilterStore,
  type CabinFilter,
  type RegionFilter,
  type ProgramFilter,
} from '@/stores/filter-store';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const CABIN_OPTIONS: { value: CabinFilter; label: string }[] = [
  { value: 'all', label: 'All Cabins' },
  { value: 'economy', label: 'Economy' },
  { value: 'business', label: 'Business' },
  { value: 'first', label: 'First' },
];

const REGION_OPTIONS: { value: RegionFilter; label: string }[] = [
  { value: 'all', label: 'All Regions' },
  { value: 'Europe', label: 'Europe' },
  { value: 'Japan', label: 'Japan' },
  { value: 'Korea', label: 'Korea' },
  { value: 'SEA', label: 'Southeast Asia' },
  { value: 'China/HK/TW', label: 'China / HK / Taiwan' },
  { value: 'India', label: 'India' },
  { value: 'Middle East', label: 'Middle East' },
  { value: 'Australia/NZ', label: 'Australia / NZ' },
  { value: 'US', label: 'Domestic US' },
];

const PROGRAM_OPTIONS: { value: ProgramFilter; label: string }[] = [
  { value: 'all', label: 'All Programs' },
  { value: 'amex-mr', label: 'Amex MR' },
  { value: 'chase-ur', label: 'Chase UR' },
  { value: 'citi-typ', label: 'Citi ThankYou' },
  { value: 'capital-one', label: 'Capital One' },
  { value: 'bilt', label: 'Bilt' },
];

export function FilterBar() {
  const { cabin, region, program, setCabin, setRegion, setProgram } =
    useDealFilterStore();

  return (
    <div className="flex flex-wrap gap-3 mb-6">
      <Select value={cabin} onValueChange={(v) => setCabin(v as CabinFilter)}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Cabin" />
        </SelectTrigger>
        <SelectContent>
          {CABIN_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={region}
        onValueChange={(v) => setRegion(v as RegionFilter)}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Region" />
        </SelectTrigger>
        <SelectContent>
          {REGION_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={program}
        onValueChange={(v) => setProgram(v as ProgramFilter)}
      >
        <SelectTrigger className="w-[170px]">
          <SelectValue placeholder="Program" />
        </SelectTrigger>
        <SelectContent>
          {PROGRAM_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
