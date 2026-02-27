'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { AIRPORT_LIST, type AirportOption } from '@/lib/airports-data';

const CABIN_OPTIONS = [
  { value: 'any', label: 'Any Cabin' },
  { value: 'economy', label: 'Economy' },
  { value: 'business', label: 'Business' },
  { value: 'first', label: 'First Class' },
];

const PROGRAM_OPTIONS = [
  { value: 'amex-mr', label: 'Amex MR' },
  { value: 'chase-ur', label: 'Chase UR' },
  { value: 'citi-typ', label: 'Citi ThankYou' },
  { value: 'capital-one', label: 'Capital One' },
  { value: 'bilt', label: 'Bilt' },
];

interface SearchFormProps {
  initialValues?: {
    from?: string;
    to?: string;
    class?: string;
    program?: string;
    date?: string;
  };
}

interface AirportComboboxProps {
  value: string;
  onChange: (code: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder: string;
}

function AirportCombobox({
  value,
  onChange,
  open,
  onOpenChange,
  placeholder,
}: AirportComboboxProps) {
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? AIRPORT_LIST.filter(
        (a: AirportOption) =>
          a.code.toLowerCase().includes(query.toLowerCase()) ||
          a.city.toLowerCase().includes(query.toLowerCase()),
      ).slice(0, 20)
    : AIRPORT_LIST.slice(0, 20);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-start font-normal text-left"
        >
          {value ? (
            <span className="font-medium">{value}</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search airports..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No airports found.</CommandEmpty>
            <CommandGroup>
              {filtered.map((airport: AirportOption) => (
                <CommandItem
                  key={airport.code}
                  value={`${airport.code} ${airport.city}`}
                  onSelect={() => {
                    onChange(airport.code);
                    setQuery('');
                    onOpenChange(false);
                  }}
                >
                  <span className="font-mono font-semibold mr-2">{airport.code}</span>
                  <span className="text-muted-foreground">— {airport.city}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function SearchForm({ initialValues }: SearchFormProps) {
  const router = useRouter();
  const [from, setFrom] = useState(initialValues?.from || '');
  const [to, setTo] = useState(initialValues?.to || '');
  const [cabin, setCabin] = useState(initialValues?.class || 'business');
  const [program, setProgram] = useState(initialValues?.program || 'amex-mr');
  const [date, setDate] = useState(initialValues?.date || '');
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!from || !to) return;
    const params = new URLSearchParams({ from, to, class: cabin, program });
    if (date) params.set('date', date);
    router.push('/search?' + params.toString());
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
        {/* Origin Combobox */}
        <div className="md:col-span-1">
          <label className="text-xs text-muted-foreground mb-1 block">From</label>
          <AirportCombobox
            value={from}
            onChange={setFrom}
            open={fromOpen}
            onOpenChange={setFromOpen}
            placeholder="Origin"
          />
        </div>

        {/* Destination Combobox */}
        <div className="md:col-span-1">
          <label className="text-xs text-muted-foreground mb-1 block">To</label>
          <AirportCombobox
            value={to}
            onChange={setTo}
            open={toOpen}
            onOpenChange={setToOpen}
            placeholder="Destination"
          />
        </div>

        {/* Cabin Select */}
        <div className="md:col-span-1">
          <label className="text-xs text-muted-foreground mb-1 block">Cabin</label>
          <Select value={cabin} onValueChange={setCabin}>
            <SelectTrigger className="w-full">
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
        </div>

        {/* Date Input */}
        <div className="md:col-span-1">
          <label className="text-xs text-muted-foreground mb-1 block">Date (optional)</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {/* Program Select */}
        <div className="md:col-span-1">
          <label className="text-xs text-muted-foreground mb-1 block">Program</label>
          <Select value={program} onValueChange={setProgram}>
            <SelectTrigger className="w-full">
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

        {/* Search Button */}
        <div className="md:col-span-1 flex items-end">
          <Button
            type="submit"
            disabled={!from || !to}
            className="w-full"
          >
            Search
          </Button>
        </div>
      </div>
    </form>
  );
}
