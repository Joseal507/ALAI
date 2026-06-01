import { NextRequest, NextResponse } from 'next/server';
import { runLearningCycle } from '@/lib/alai/learning/runner';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const result = await runLearningCycle(
      body?.topic ? String(body.topic) : undefined
    );

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'ALAI learning error',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const result = await runLearningCycle();

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'ALAI learning error',
      },
      { status: 500 }
    );
  }
}
