import { NextResponse } from 'next/server';
import { getMockDb, saveMockDb } from '@/lib/supabase/mockDb';

// La base mock es solo para desarrollo local: si hay un Supabase real configurado
// esta ruta no existe (antes exponía y permitía sobrescribir la base mock sin sesión).
function mockDeshabilitado() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.startsWith('https://') && url.includes('.supabase.co')
}

export async function GET() {
  if (mockDeshabilitado()) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  const db = await getMockDb();
  return NextResponse.json(db);
}

export async function POST(request: Request) {
  if (mockDeshabilitado()) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  try {
    const body = await request.json();
    await saveMockDb(body);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to save mock database' }, { status: 500 });
  }
}

