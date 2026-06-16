import {
  getZApiInstanceStatus,
  type ZApiInstanceStatus,
} from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";

export type ChannelHealthInput = {
  clinicId: string;
  clinicName: string;
  channelProvider?: "z_api" | "meta_cloud_api" | null;
  zapiInstanceId?: string | null;
  zapiToken?: string | null;
  zapiClientToken?: string | null;
  metaPhoneNumberId?: string | null;
  metaAccessToken?: string | null;
};

export type ChannelHealthStatus = {
  status: "healthy" | "degraded" | "unknown";
  detail: string | null;
  checkedAt: Date;
};

function normalizeErrorDetail(error: string | undefined): string | null {
  if (!error) return null;
  if (error.includes("Instance not found")) return "Z-API retornou Instance not found";
  return error;
}

function evaluateZApiStatus(status: ZApiInstanceStatus): ChannelHealthStatus {
  if (status.connected === true && status.smartphoneConnected === true) {
    return { status: "healthy", detail: null, checkedAt: new Date() };
  }

  const parts: string[] = [];
  if (status.connected === false) parts.push("instância desconectada");
  if (status.smartphoneConnected === false) parts.push("celular offline");
  const errorDetail = normalizeErrorDetail(status.error);
  if (errorDetail) parts.push(errorDetail);

  return {
    status: "degraded",
    detail: parts.join(" | ") || "status de canal indisponível",
    checkedAt: new Date(),
  };
}

export async function probeClinicChannelHealth(
  clinic: ChannelHealthInput,
): Promise<ChannelHealthStatus> {
  const config = resolveChannelConfig(clinic);

  if (config.provider === "z_api") {
    if (!config.zapi) {
      return {
        status: "degraded",
        detail: "credenciais Z-API ausentes",
        checkedAt: new Date(),
      };
    }

    return evaluateZApiStatus(await getZApiInstanceStatus(config.zapi));
  }

  if (config.provider === "meta_cloud_api") {
    if (!config.meta) {
      return {
        status: "degraded",
        detail: "credenciais Meta ausentes",
        checkedAt: new Date(),
      };
    }

    return {
      status: "unknown",
      detail: "check ativo para Meta ainda não implementado",
      checkedAt: new Date(),
    };
  }

  return {
    status: "degraded",
    detail: "provedor de canal não configurado",
    checkedAt: new Date(),
  };
}
