import { NextRequest, NextResponse } from "next/server";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { composeField, type FieldTarget } from "@/core/intelligence/FieldComposer";

export const dynamic = "force-dynamic";

const VALID_FIELDS: FieldTarget[] = [
  "procedureDescription",
  "toneOfVoice",
  "commercialPolicy",
  "differentials",
  "objections",
  "notes",
  "greetingMessage",
];

// POST /api/playbook/advisor/rewrite
// Proposes a rewritten version of a single playbook field.
// Never persists anything — only proposes.
export async function POST(req: NextRequest) {
  try {
    await requireSessionClinicId();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json() as {
      field: FieldTarget;
      userInput: string;
      currentValue: string;
      clinicContext: { specialty: string; toneOfVoice: string };
    };

    if (!body.field || !VALID_FIELDS.includes(body.field)) {
      return NextResponse.json({ error: "invalid field" }, { status: 400 });
    }
    if (!body.userInput?.trim()) {
      return NextResponse.json({ error: "userInput is required" }, { status: 400 });
    }

    const result = await composeField({
      field: body.field,
      userInput: body.userInput,
      currentValue: body.currentValue ?? "",
      clinicContext: {
        specialty: body.clinicContext?.specialty ?? "",
        toneOfVoice: body.clinicContext?.toneOfVoice ?? "acolhedor",
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[playbook/advisor/rewrite]", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
