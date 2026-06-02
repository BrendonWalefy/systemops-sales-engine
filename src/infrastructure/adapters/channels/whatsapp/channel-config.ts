/**
 * Configuração de canal POR CLÍNICA, com fallback para as envs globais.
 *
 * É isto que garante que a resposta de cada clínica saia pelo número/instância
 * dela — e não pelo de outra clínica (o vazamento mais visível do multi-tenant).
 * Enquanto uma clínica não tiver credenciais próprias cadastradas, cai nas envs
 * globais (comportamento da fase piloto).
 */

export type ZapiCreds = {
  instanceId: string;
  token: string;
  clientToken?: string;
};

export type MetaCreds = {
  phoneNumberId: string;
  accessToken: string;
};

export type ClinicChannelConfig = {
  provider: "z_api" | "meta_cloud_api";
  zapi: ZapiCreds | null;
  meta: MetaCreds | null;
};

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
    (process.env.WHATSAPP_PROVIDER === "z_api" ? "z_api" : "meta_cloud_api");

  const zapi: ZapiCreds | null =
    clinic.zapiInstanceId && clinic.zapiToken
      ? {
          instanceId: clinic.zapiInstanceId,
          token: clinic.zapiToken,
          clientToken: clinic.zapiClientToken ?? process.env.ZAPI_CLIENT_TOKEN ?? undefined,
        }
      : process.env.ZAPI_INSTANCE_ID && process.env.ZAPI_TOKEN
        ? {
            instanceId: process.env.ZAPI_INSTANCE_ID,
            token: process.env.ZAPI_TOKEN,
            clientToken: process.env.ZAPI_CLIENT_TOKEN ?? undefined,
          }
        : null;

  const meta: MetaCreds | null =
    clinic.metaPhoneNumberId && clinic.metaAccessToken
      ? { phoneNumberId: clinic.metaPhoneNumberId, accessToken: clinic.metaAccessToken }
      : process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN
        ? {
            phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
            accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
          }
        : null;

  return { provider, zapi, meta };
}
