'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import type { ChartConfig } from '@/components/ui/chart';
import type { HistoryPoint } from '@/lib/price-history';

const chartConfig = {
  miles: {
    label: 'Points Required',
    color: 'var(--chart-1)',
  },
} satisfies ChartConfig;

interface PriceHistoryChartProps {
  data: HistoryPoint[];
  from: string;
  to: string;
  cabin: string;
}

export function PriceHistoryChart({ data, from, to, cabin }: PriceHistoryChartProps) {
  if (data.length === 0) {
    return (
      <div className="mt-8 p-6 border border-border rounded-lg bg-card text-center">
        <p className="text-muted-foreground text-sm">
          Price history will appear after a few days of monitoring this route
        </p>
      </div>
    );
  }

  // Format date for X-axis: "MM/DD"
  const formatDate = (dateStr: string) => {
    const parts = dateStr.split('-');
    return `${parts[1]}/${parts[2]}`;
  };

  // Format miles for Y-axis: "85k"
  const formatMiles = (v: number) => `${(v / 1000).toFixed(0)}k`;

  return (
    <div className="mt-8">
      <h3 className="text-lg font-semibold mb-3">
        Price History: {from} &rarr; {to}
        <span className="text-sm text-muted-foreground font-normal ml-2">
          ({cabin} &middot; last 30 days &middot; cheapest per day)
        </span>
      </h3>
      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="milesGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.4} />
              <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickFormatter={formatDate}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickFormatter={formatMiles}
            tick={{ fontSize: 12 }}
            width={40}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area
            type="monotone"
            dataKey="miles"
            stroke="var(--chart-1)"
            fill="url(#milesGrad)"
            strokeWidth={2}
            dot={false}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
