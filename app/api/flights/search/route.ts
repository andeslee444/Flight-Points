// app/api/flights/search/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { getSearchResults } from '@/lib/search';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = sp.get('from') || '';
  const to = sp.get('to') || '';
  const cabin = sp.get('class') || 'business';
  const program = sp.get('program') || 'amex-mr';
  const date = sp.get('date') || undefined;

  if (!from || !to) {
    return NextResponse.json({ error: 'Missing from/to parameters' }, { status: 400 });
  }

  try {
    const results = await getSearchResults({ from, to, cabin, program, date });
    return NextResponse.json({
      results,
      count: results.length,
      source: 'daemon-cache',
    });
  } catch (err) {
    console.error('[search] Query error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
