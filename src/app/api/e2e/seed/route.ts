import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/infrastructure/db/client';
import { organizations } from '@/infrastructure/db/schema';
import { e2eGuard, E2E_CLINIC_ID } from '../_guard';

export async function POST(req: NextRequest) {
  const blocked = e2eGuard(req);
  if (blocked) return blocked;

  if (!E2E_CLINIC_ID) {
    return NextResponse.json({ error: 'E2E_CLINIC_ID not configured' }, { status: 500 });
  }

  await db
    .update(organizations)
    .set({ autoReplyEnabled: true })
    .where(eq(organizations.id, E2E_CLINIC_ID));

  return NextResponse.json({ ok: true });
}
