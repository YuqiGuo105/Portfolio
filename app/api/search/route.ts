import { NextResponse } from 'next/server';
import { searchItems } from '../../../src/lib/searchItems';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();
  const source = searchParams.get('source') || undefined;
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');

  if (!q) {
    return NextResponse.json({ error: 'Missing query parameter: q' }, { status: 400 });
  }

  const limit = limitParam ? Number(limitParam) : undefined;
  const offset = offsetParam ? Number(offsetParam) : undefined;

  try {
    const results = await searchItems({ q, source, limit, offset });
    return NextResponse.json(results, { status: 200 });
  } catch (error) {
    console.error('[search] error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
