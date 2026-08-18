/**
 * Configuração de canal POR CLÍNICA.
 *
 * É isto que garante que a resposta de cada clínica saia pelo número/instância
 * dela — e não pelo de outra clínica.
 */
import { decryptCredentialNullable } from "@/infrastructure/crypto/credential-vault";
import type { ChannelConfigSnapshot } from "@/application/ports/channel-config-snapshot";

export type ZapiCreds = {
  instanceId: string;
  token: string;
  clientToken?: string;
};

export type MetaCreds = {
  phoneNumberId: string;
  accessToken: string;
};

export type ClinicChannelConfig = ChannelConfigSnapshot;

type ClinicChannelFields = {
  channelProvider?: "z_api" | "meta_cloud_api" | null;
  zapiInstanceId?: string | null;
  zapiToken?: string | null;
  zapiClientToken?: string | null;
  metaPhoneNumberId?: string | null;
  metaAccessToken?: string | null;
};

export function resolveChannelConfig(clinic: ClinicChannelFields): ClinicChannelConfig {
  const provider =
    clinic.channelProvider ??
    (clinic.zapiInstanceId && clinic.zapiToken ? "z_api" : "meta_cloud_api");

  const zapi: ZapiCreds | null =
    clinic.zapiInstanceId && clinic.zapiToken
      ? {
          instanceId: clinic.zapiInstanceId,
          token: decryptCredentialNullable(clinic.zapiToken) ?? "",
          clientToken: decryptCredentialNullable(clinic.zapiClientToken) ?? undefined,
        }
      : null;

  const meta: MetaCreds | null =
    clinic.metaPhoneNumberId && clinic.metaAccessToken
      ? {
          phoneNumberId: clinic.metaPhoneNumberId,
          accessToken: decryptCredentialNullable(clinic.metaAccessToken) ?? "",
        }
      : null;

  return { provider, zapi, meta };
}
