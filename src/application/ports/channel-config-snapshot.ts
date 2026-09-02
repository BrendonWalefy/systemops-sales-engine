export type WhatsAppProvider = "z_api" | "meta_cloud_api" | "waha";

export type ChannelConfigSnapshot = Readonly<{
  provider: WhatsAppProvider;
  zapi: Readonly<{
    instanceId: string;
    token: string;
    clientToken?: string;
  }> | null;
  meta: Readonly<{
    phoneNumberId: string;
    accessToken: string;
  }> | null;
  waha: Readonly<{
    baseUrl: string;
    apiKey: string;
    session: string;
  }> | null;
}>;
