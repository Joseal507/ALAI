import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'ALAI Core',
    version: '0.1.0',
    status: 'alive',
    time: new Date().toISOString(),
  });
}
