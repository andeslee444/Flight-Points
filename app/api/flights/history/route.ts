// app/api/flights/history/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { getPriceHistory } from '@/lib/price-history';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const fromRaw = sp.get('from') || '';
  const toRaw = sp.get('to') || '';
  const cabin = sp.get('cabin') || 'business';
  const daysStr = sp.get('days') || '30';

  // Multi-airport: take only the first airport code (v1 simplification)
  const from = fromRaw.split(',')[0]?.trim().toUpperCase() || '';
  const to = toRaw.split(',')[0]?.trim().toUpperCase() || '';

  if (!from || !to) {
    return NextResponse.json({ error: 'Missing from/to parameters' }, { status: 400 });
  }

  // Validate days as integer in range [1, 365]
  const days = parseInt(daysStr, 10);
  if (isNaN(days) || days < 1 || days > 365) {
    return NextResponse.json({ error: 'days must be an integer between 1 and 365' }, { status: 400 });
  }

  try {
    const data = await getPriceHistory(from, to, cabin, days);

    if (data.length === 0) {
      return NextResponse.json({
        data: [],
        from,
        to,
        cabin,
        days,
        message: 'Not enough data yet — price history appears after a few days of monitoring this route',
      });
    }

    return NextResponse.json({
      data,
      from,
      to,
      cabin,
      days,
    });
  } catch (err) {
    console.error('[history] Query error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
