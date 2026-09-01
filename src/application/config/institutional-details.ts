import { z } from "zod";
import type { SocialChannel } from "@/domain/entities/clinic";

const unsafeDisplayControlPattern = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const boundedDisplayText = (max: number) => z.string()
  .trim()
  .min(1)
  .max(max)
  .refine((value) => !unsafeDisplayControlPattern.test(value), "texto contém caractere inválido");

const socialChannelSchema = z.object({
  label: boundedDisplayText(40),
  url: z.string()
    .trim()
    .max(240)
    .url()
    .refine((value) => new URL(value).protocol === "https:", "URL deve usar HTTPS"),
}).strict();

const institutionalDetailsSchema = z.object({
  parkingInformation: z.union([boundedDisplayText(240), z.null()]),
  socialChannels: z.union([
    z.array(socialChannelSchema).max(5).superRefine((channels, context) => {
      const labels = new Set<string>();
      channels.forEach((channel, index) => {
        const normalized = channel.label.normalize("NFKC").toLocaleLowerCase("pt-BR");
        if (labels.has(normalized)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "label"],
            message: "rótulo de canal duplicado",
          });
        }
        labels.add(normalized);
      });
    }),
    z.null(),
  ]),
}).strict();

export type InstitutionalDetails = Readonly<{
  parkingInformation: string | null;
  socialChannels: SocialChannel[] | null;
}>;

export function parseInstitutionalDetails(input: {
  parkingInformation?: string | null;
  socialChannels?: readonly { label?: string | null; url?: string | null }[] | null;
}): InstitutionalDetails {
  const parkingInformation = input.parkingInformation?.trim() || null;
  const socialChannels = (input.socialChannels ?? [])
    .map((channel) => ({
      label: channel.label?.trim() ?? "",
      url: channel.url?.trim() ?? "",
    }))
    .filter((channel) => channel.label.length > 0 || channel.url.length > 0);

  return institutionalDetailsSchema.parse({
    parkingInformation,
    socialChannels: socialChannels.length > 0 ? socialChannels : null,
  });
}
