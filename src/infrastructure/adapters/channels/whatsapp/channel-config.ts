/**
 * Configuração de canal POR CLÍNICA.
 *
 * É isto que garante que a resposta de cada clínica saia pelo número/instância
 * dela — e não pelo de outra clínica.
 */
import { decryptCredentialNullable } from "@/infrastructure/crypto/credential-vault";
import type {
  ChannelConfigSnapshot,
  WhatsAppProvider,
} from "@/application/ports/channel-config-snapshot";

export type ZapiCreds = {
  instanceId: string;
  token: string;
  clientToken?: string;
};

export type MetaCreds = {
  phoneNumberId: string;
  accessToken: string;
};

export type WahaCreds = {
  baseUrl: string;
  apiKey: string;
  session: string;
};

/** Sessão default do WAHA quando a clínica não nomeia a sua. */
export const DEFAULT_WAHA_SESSION = "default";

export type ClinicChannelConfig = ChannelConfigSnapshot;

type ClinicChannelFields = {
  channelProvider?: WhatsAppProvider | null;
  zapiInstanceId?: string | null;
  zapiToken?: string | null;
  zapiClientToken?: string | null;
  metaPhoneNumberId?: string | null;
  metaAccessToken?: string | null;
  wahaBaseUrl?: string | null;
  wahaApiKey?: string | null;
  wahaSession?: string | null;
};

export function resolveChannelConfig(clinic: ClinicChannelFields): ClinicChannelConfig {
  const hasZapi = Boolean(clinic.zapiInstanceId && clinic.zapiToken);
  const hasWaha = Boolean(clinic.wahaBaseUrl && clinic.wahaApiKey);

  const provider: WhatsAppProvider =
    clinic.channelProvider ?? (hasZapi ? "z_api" : hasWaha ? "waha" : "meta_cloud_api");

  const zapi: ZapiCreds | null = hasZapi
    ? {
        instanceId: clinic.zapiInstanceId!,
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

  const waha: WahaCreds | null = hasWaha
    ? {
        // A barra final duplicaria a barra do path e o WAHA devolve 404.
        baseUrl: clinic.wahaBaseUrl!.trim().replace(/\/+$/, ""),
        apiKey: decryptCredentialNullable(clinic.wahaApiKey) ?? "",
        session: clinic.wahaSession?.trim() || DEFAULT_WAHA_SESSION,
      }
    : null;

  return { provider, zapi, meta, waha };
}
