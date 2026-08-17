export type ChannelConfigSnapshot = Readonly<{
  provider: "z_api" | "meta_cloud_api";
  zapi: Readonly<{
    instanceId: string;
    token: string;
    clientToken?: string;
  }> | null;
  meta: Readonly<{
    phoneNumberId: string;
    accessToken: string;
  }> | null;
}>;
