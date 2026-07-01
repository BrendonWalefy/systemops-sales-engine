import { describe, expect, it } from "vitest";
import { buildClinicBlueprint } from "@/application/onboarding/clinic-blueprint";

describe("buildClinicBlueprint", () => {
  it("flags missing go-live prerequisites for test organizations with incomplete setup", () => {
    const result = buildClinicBlueprint({
      clinic: {
        specialty: "odontologia",
        city: "",
        address: "",
        greetingMessage: "",
        businessHours: "",
        calendarMode: "google_calendar",
        googleCalendarId: "",
        receptionistPhone: "",
        autoReplyEnabled: false,
        isTest: true,
        plan: "custom",
        monthlyRevenueBrl: 0,
        billingStartedAt: null,
        defaultAppointmentDurationMinutes: 60,
        postAppointmentBufferMinutes: 30,
        takeoverTtlHours: 4,
        channelProvider: "z_api",
        zapiInstanceId: "",
        zapiToken: "",
      },
      playbook: {
        toneOfVoice: "",
        commercialPolicy: "",
        notes: "",
        differentialsCount: 0,
        mediaLibraryCount: 0,
        objectionsCount: 0,
      },
      treatments: [],
    });

    expect(result.status).toBe("pending");
    expect(
      result.sections.find((section) => section.id === "identity")?.missing,
    ).toContain("cidade");
    expect(
      result.sections.find((section) => section.id === "channel")?.missing,
    ).toContain("credenciais completas do canal");
    expect(
      result.sections.find((section) => section.id === "go_live")?.missing,
    ).toContain("clínica ainda está marcada como ambiente de teste");
  });

  it("marks the blueprint as complete when clinic is operationally ready", () => {
    const result = buildClinicBlueprint({
      clinic: {
        specialty: "odontologia estética",
        city: "São Paulo",
        address: "Av. Exemplo, 123",
        greetingMessage: "Olá! Como posso ajudar?",
        businessHours: "Seg-Sex 09:00-18:00",
        calendarMode: "internal",
        googleCalendarId: null,
        receptionistPhone: "+5511999999999",
        autoReplyEnabled: true,
        isTest: false,
        plan: "avancado",
        monthlyRevenueBrl: 149700,
        billingStartedAt: new Date("2026-06-01T00:00:00.000Z"),
        defaultAppointmentDurationMinutes: 60,
        postAppointmentBufferMinutes: 30,
        takeoverTtlHours: 4,
        channelProvider: "meta_cloud_api",
        metaPhoneNumberId: "123",
        metaAccessToken: "token",
        hasTtsConfig: true,
      },
      playbook: {
        toneOfVoice: "acolhedor",
        commercialPolicy: "Pix, débito, crédito e parcelamento.",
        notes: "Sempre confirmar o procedimento antes do horário.",
        differentialsCount: 2,
        mediaLibraryCount: 1,
        objectionsCount: 2,
      },
      treatments: [{ pipelineStepsCount: 4 }, { pipelineStepsCount: 2 }],
    });

    expect(result.status).toBe("complete");
    expect(result.readinessPercent).toBe(100);
    expect(
      result.sections.every((section) => section.status === "complete"),
    ).toBe(true);
  });

  it("treats ElevenLabs with Voice ID as a complete voice setup even without basic TTS", () => {
    const result = buildClinicBlueprint({
      clinic: {
        specialty: "odontologia estética",
        city: "São Paulo",
        address: "Av. Exemplo, 123",
        greetingMessage: "Olá! Como posso ajudar?",
        businessHours: "Seg-Sex 09:00-18:00",
        calendarMode: "internal",
        googleCalendarId: null,
        receptionistPhone: "+5511999999999",
        autoReplyEnabled: true,
        isTest: false,
        plan: "rede",
        monthlyRevenueBrl: 299700,
        billingStartedAt: new Date("2026-06-01T00:00:00.000Z"),
        defaultAppointmentDurationMinutes: 60,
        postAppointmentBufferMinutes: 30,
        takeoverTtlHours: 4,
        channelProvider: "meta_cloud_api",
        metaPhoneNumberId: "123",
        metaAccessToken: "token",
        hasTtsConfig: false,
        hasElevenLabsTts: true,
        elevenLabsNeedsVoiceId: false,
      },
      playbook: {
        toneOfVoice: "Profissional e premium",
        commercialPolicy: "Pix, débito, crédito e parcelamento.",
        notes: "Sempre confirmar o procedimento antes do horário.",
        differentialsCount: 2,
        mediaLibraryCount: 1,
        objectionsCount: 2,
      },
      treatments: [{ pipelineStepsCount: 4 }],
    });

    expect(result.sections.find((section) => section.id === "tts")?.status).toBe(
      "complete",
    );
    expect(
      result.sections.find((section) => section.id === "tts")?.missing,
    ).toEqual([]);
  });
});
