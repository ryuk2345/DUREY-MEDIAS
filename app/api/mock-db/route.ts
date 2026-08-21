import { NextResponse } from 'next/server';
import { getMockDb, saveMockDb } from '@/lib/supabase/mockDb';

export async function GET() {
  const db = await getMockDb();
  return NextResponse.json(db);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    await saveMockDb(body);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to save mock database' }, { status: 500 });
  }
}

