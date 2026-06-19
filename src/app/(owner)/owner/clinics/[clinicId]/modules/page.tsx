export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { db } from "@/infrastructure/db/client";
import { clinics, clinicModules } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { MODULE_CATALOG } from "@/application/modules/module-catalog";
import type { ModuleKey } from "@/application/modules/module-catalog";
import type { ClinicPlan } from "@/application/onboarding/clinic-commercial-settings";
import { toggleModule, syncPlanModules } from "./actions";

async function getData(clinicId: string) {
  const [clinic, moduleRows] = await Promise.all([
    db
      .select({ id: clinics.id, name: clinics.name, plan: clinics.plan })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({
        moduleKey: clinicModules.moduleKey,
        isActive: clinicModules.isActive,
        config: clinicModules.config,
        updatedAt: clinicModules.updatedAt,
        updatedBy: clinicModules.updatedBy,
      })
      .from(clinicModules)
      .where(eq(clinicModules.clinicId, clinicId)),
  ]);
  return { clinic, moduleRows };
}

export default async function ClinicModulesPage({
  params,
}: {
  params: Promise<{ clinicId: string }>;
}) {
  const { clinicId } = await params;
  const { clinic, moduleRows } = await getData(clinicId);
  if (!clinic) notFound();

  const plan = clinic.plan as ClinicPlan;
  const moduleMap = new Map(moduleRows.map((r) => [r.moduleKey, r]));

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ marginBottom: "24px" }}>
        <Link
          href={`/owner/clinics/${clinicId}`}
          style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#71717a", textDecoration: "none", marginBottom: "12px" }}
        >
          <ArrowLeft size={14} /> Voltar para a clínica
        </Link>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#fafafa" }}>{clinic.name} — Módulos</h1>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#71717a" }}>
              Plano: <span style={{ color: "#34d399", fontWeight: 600, textTransform: "capitalize" }}>{plan}</span>
            </p>
          </div>
          <form
            action={async () => {
              "use server";
              await syncPlanModules(clinicId, plan);
            }}
          >
            <button
              type="submit"
              style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#fafafa", fontSize: "13px", cursor: "pointer" }}
            >
              Sincronizar com plano
            </button>
          </form>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {MODULE_CATALOG.map((def) => {
          const row = moduleMap.get(def.key);
          const isActive = row?.isActive ?? false;
          const inPlan = def.plans.includes(plan);

          return (
            <div
              key={def.key}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "16px",
                padding: "14px 16px",
                borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.07)",
                background: isActive ? "rgba(16,185,129,0.04)" : "rgba(255,255,255,0.02)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "14px", fontWeight: 600, color: "#fafafa" }}>{def.label}</span>
                  <span style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: "4px",
                    ...(isActive
                      ? { background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)" }
                      : { background: "rgba(255,255,255,0.05)", color: "#52525b", border: "1px solid rgba(255,255,255,0.07)" }),
                  }}>
                    {isActive ? "Ativo" : "Inativo"}
                  </span>
                  {!inPlan && (
                    <span style={{ fontSize: "10px", color: "#52525b", display: "inline-flex", alignItems: "center", gap: "3px" }}>
                      <Lock size={10} /> fora do plano
                    </span>
                  )}
                </div>
                <p style={{ margin: "3px 0 0", fontSize: "12px", color: "#52525b" }}>{def.description}</p>
                {!inPlan && (
                  <p style={{ margin: "3px 0 0", fontSize: "11px", color: "#3f3f46" }}>
                    Disponível no plano {def.plans.filter((p) => p !== "custom").join(", ")} ou superior
                  </p>
                )}
              </div>

              <form
                action={async () => {
                  "use server";
                  await toggleModule(clinicId, def.key as ModuleKey, !isActive);
                }}
              >
                <button
                  type="submit"
                  disabled={!inPlan && !isActive}
                  title={!inPlan && !isActive ? "Disponível em plano superior" : undefined}
                  style={{
                    width: "44px",
                    height: "24px",
                    borderRadius: "12px",
                    border: "none",
                    background: isActive ? "#10b981" : "rgba(255,255,255,0.1)",
                    cursor: (!inPlan && !isActive) ? "not-allowed" : "pointer",
                    position: "relative",
                    transition: "background 200ms",
                    flexShrink: 0,
                    opacity: (!inPlan && !isActive) ? 0.4 : 1,
                  }}
                >
                  <span style={{
                    position: "absolute",
                    top: "3px",
                    left: isActive ? "23px" : "3px",
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    background: "#fff",
                    transition: "left 200ms",
                  }} />
                </button>
              </form>
            </div>
          );
        })}
      </div>
    </div>
  );
}
