import { z } from "zod";

/**
 * VALIDAÇÃO ÚNICA DE ONBOARDING.
 *
 * Tanto o script (scripts/create-clinic.ts) quanto a tela do painel owner
 * validam por aqui. A regra crítica é a mesma do gate de publicação: política
 * comercial NÃO pode ser vazia — é isso que impede a IA de ficar sem dado e
 * inventar na frente do cliente.
 */

const onboardingPlaybookSchema = z.object({
  // Mesma regra crítica do publishablePlaybookSchema (gate de publicação).
  commercialPolicy: z
    .string()
    .trim()
    .min(1, "política comercial não pode ser vazia (a IA inventaria condições)"),
  toneOfVoice: z.string().trim().min(1).default("acolhedor"),
  procedureDescription: z.string().trim().optional(),
  differentials: z.array(z.string()).default([]),
  objections: z
    .array(z.object({ objection: z.string(), response: z.string() }))
    .default([]),
  notes: z.string().trim().optional(),
});

const channelSchema = z
  .object({
    provider: z.enum(["z_api", "meta_cloud_api"]),
    zapi: z
      .object({
        instanceId: z.string().trim().min(1),
        token: z.string().trim().min(1),
        clientToken: z.string().trim().optional(),
      })
      .optional(),
    meta: z
      .object({
        phoneNumberId: z.string().trim().min(1),
        accessToken: z.string().trim().min(1),
      })
      .optional(),
  })
  .superRefine((c, ctx) => {
    if (c.provider === "z_api" && !c.zapi) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["zapi"], message: "credenciais Z-API obrigatórias" });
    }
    if (c.provider === "meta_cloud_api" && !c.meta) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["meta"], message: "credenciais Meta obrigatórias" });
    }
  });

export const onboardingConfigSchema = z.object({
  name: z.string().trim().min(1, "nome obrigatório"),
  slug: z
    .string()
    .trim()
    .min(1, "slug obrigatório")
    .regex(/^[a-z0-9-]+$/, "slug só pode ter minúsculas, números e hífen"),
  specialty: z.string().trim().default("odontology"),
  timezone: z.string().trim().default("America/Sao_Paulo"),
  businessHours: z.string().trim().optional(),
  greetingMessage: z.string().trim().optional(),
  channel: channelSchema,
  // O gate editorial: política comercial não pode ser vazia.
  playbook: onboardingPlaybookSchema,
  procedures: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        durationMinutes: z.number().int().positive().default(60),
        description: z.string().trim().optional(),
        requiresEvaluationFirst: z.boolean().default(false),
      }),
    )
    .default([]),
  admins: z
    .array(
      z.object({
        email: z.string().trim().email(),
        password: z.string().min(8, "senha deve ter pelo menos 8 caracteres"),
        role: z.enum(["owner", "clinic_admin"]).default("clinic_admin"),
      }),
    )
    .min(1, "ao menos um admin é obrigatório"),
});

export type OnboardingConfig = z.infer<typeof onboardingConfigSchema>;
