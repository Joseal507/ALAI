import { NextRequest, NextResponse } from 'next/server';
import { runAlaiChat } from '@/lib/alai';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const result = await runAlaiChat({
      message: String(body.message || body.question || ''),
      history: Array.isArray(body.history) ? body.history : [],
      userId: body.userId ? String(body.userId) : undefined,
    });

    return NextResponse.json({
      success: true,
      answer: result.answer,
      provider: result.provider,
      model: result.model,
      confidence: result.confidence,
      usedMemory: result.usedMemory || [],
      learningTriggered: Boolean(result.learningTriggered),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'ALAI chat error',
      },
      { status: 500 }
    );
  }
}
