type BlueprintStatus = "complete" | "attention" | "pending";

export type ClinicBlueprintInput = {
  clinic: {
    specialty?: string | null;
    city?: string | null;
    address?: string | null;
    greetingMessage?: string | null;
    businessHours?: string | null;
    calendarMode?: "internal" | "google_calendar" | null;
    googleCalendarId?: string | null;
    receptionistPhone?: string | null;
    autoReplyEnabled: boolean;
    isTest: boolean;
    plan?: "essencial" | "clinica" | "rede" | "custom" | null;
    monthlyRevenueBrl?: number | null;
    billingStartedAt?: Date | null;
    defaultAppointmentDurationMinutes?: number | null;
    postAppointmentBufferMinutes?: number | null;
    takeoverTtlHours?: number | null;
    channelProvider?: "z_api" | "meta_cloud_api" | null;
    zapiInstanceId?: string | null;
    zapiToken?: string | null;
    metaPhoneNumberId?: string | null;
    metaAccessToken?: string | null;
    hasTtsConfig?: boolean;
    hasElevenLabsTts?: boolean;
    elevenLabsNeedsVoiceId?: boolean;
  };
  playbook: {
    toneOfVoice?: string | null;
    commercialPolicy?: string | null;
    notes?: string | null;
    differentialsCount: number;
    mediaLibraryCount: number;
    objectionsCount: number;
  };
  treatments: Array<{
    pipelineStepsCount: number;
  }>;
};

export type BlueprintSection = {
  id:
    | "identity"
    | "channel"
    | "schedule"
    | "playbook"
    | "commercial"
    | "treatments"
    | "objections"
    | "media"
    | "tts"
    | "go_live";
  title: string;
  status: BlueprintStatus;
  summary: string;
  missing: string[];
};

export type ClinicBlueprint = {
  readinessPercent: number;
  status: BlueprintStatus;
  sections: BlueprintSection[];
  criticalMissing: string[];
};

function normalize(value?: string | null): string {
  return value?.trim() ?? "";
}

function statusFromMissing(
  missing: string[],
  totalChecks: number,
): BlueprintStatus {
  if (missing.length === 0) return "complete";
  if (missing.length === totalChecks) return "pending";
  return "attention";
}

function scoreStatus(status: BlueprintStatus): number {
  if (status === "complete") return 1;
  if (status === "attention") return 0.5;
  return 0;
}

export function buildClinicBlueprint(
  input: ClinicBlueprintInput,
): ClinicBlueprint {
  const { clinic, playbook, treatments } = input;
  const hasZapi = Boolean(
    normalize(clinic.zapiInstanceId) && normalize(clinic.zapiToken),
  );
  const hasMeta = Boolean(
    normalize(clinic.metaPhoneNumberId) && normalize(clinic.metaAccessToken),
  );
  const hasChannel =
    clinic.channelProvider === "z_api"
      ? hasZapi
      : clinic.channelProvider === "meta_cloud_api"
        ? hasMeta
        : false;
  const usesGoogleCalendar = clinic.calendarMode === "google_calendar";
  const treatmentsWithPipeline = treatments.filter(
    (t) => t.pipelineStepsCount > 0,
  ).length;

  function createSection(
    id: BlueprintSection["id"],
    title: string,
    summary: string,
    checks: Array<string | null>,
  ): BlueprintSection {
    const missing = checks.filter(Boolean) as string[];
    return {
      id,
      title,
      summary,
      missing,
      status: statusFromMissing(missing, checks.length),
    };
  }

  const sections: BlueprintSection[] = [
    createSection(
      "identity",
      "Identidade",
      "Posicionamento básico da clínica para a IA e confirmações.",
      [
        !normalize(clinic.specialty) ? "especialidade principal" : null,
        !normalize(clinic.city) ? "cidade" : null,
        !normalize(clinic.address) ? "endereço" : null,
        !normalize(clinic.greetingMessage) ? "mensagem de boas-vindas" : null,
      ],
    ),
    createSection(
      "channel",
      "Canal",
      "Canal oficial da clínica e rota de handoff humano.",
      [
        !clinic.channelProvider ? "provedor do WhatsApp" : null,
        !hasChannel ? "credenciais completas do canal" : null,
        !normalize(clinic.receptionistPhone)
          ? "telefone da recepção humana"
          : null,
      ],
    ),
    createSection(
      "schedule",
      "Agenda",
      usesGoogleCalendar
        ? "Operação guiada por agenda integrada ao Google Calendar."
        : "Operação guiada pela agenda interna da plataforma.",
      [
        !normalize(clinic.businessHours) ? "horário comercial" : null,
        !clinic.defaultAppointmentDurationMinutes ? "duração padrão" : null,
        clinic.postAppointmentBufferMinutes == null
          ? "buffer pós-consulta"
          : null,
        clinic.takeoverTtlHours == null ? "janela de takeover humano" : null,
        usesGoogleCalendar && !normalize(clinic.googleCalendarId)
          ? "Google Calendar ID"
          : null,
      ],
    ),
    createSection(
      "playbook",
      "Playbook",
      "Regras editoriais e comerciais que a IA usa para responder.",
      [
        !normalize(playbook.toneOfVoice) ? "tom de voz" : null,
        !normalize(playbook.commercialPolicy) ? "política comercial" : null,
        playbook.differentialsCount === 0 ? "ao menos 1 diferencial" : null,
      ],
    ),
    createSection(
      "commercial",
      "Comercial",
      "Plano, valor contratado e status de cobrança da clínica.",
      [
        !clinic.plan ? "plano comercial" : null,
        clinic.plan === "custom" ? "plano final ainda não definido" : null,
        !clinic.isTest && !clinic.monthlyRevenueBrl
          ? "valor mensal contratado"
          : null,
        !clinic.isTest && !clinic.billingStartedAt
          ? "data de início da cobrança"
          : null,
      ],
    ),
    createSection(
      "treatments",
      "Tratamentos",
      `${treatments.length} tratamento(s) cadastrados, ${treatmentsWithPipeline} com pipeline ativo.`,
      [
        treatments.length === 0 ? "cadastro de tratamentos" : null,
        treatments.length > 0 && treatmentsWithPipeline === 0
          ? "pipeline configurado em ao menos 1 tratamento"
          : null,
      ],
    ),
    createSection(
      "objections",
      "Objeções",
      "Objeções mapeadas ajudam a IA a converter leads que hesitam.",
      [
        playbook.objectionsCount === 0
          ? "ao menos 1 objeção mapeada no playbook"
          : null,
      ],
    ),
    createSection(
      "media",
      "Mídia",
      playbook.mediaLibraryCount > 0
        ? `${playbook.mediaLibraryCount} item(s) na biblioteca de mídia.`
        : "Biblioteca de mídia vazia — a IA não enviará vídeos ou áudios.",
      [
        playbook.mediaLibraryCount === 0
          ? "ao menos 1 item na biblioteca de mídia"
          : null,
      ],
    ),
    createSection(
      "tts",
      "Voz da IA",
      clinic.hasElevenLabsTts
        ? "ElevenLabs Pro ativa — voz profissional de alta fidelidade."
        : clinic.elevenLabsNeedsVoiceId
          ? "ElevenLabs Pro ativado mas Voice ID não configurado."
          : clinic.hasTtsConfig
            ? "Voz básica ativa (OpenAI nova). Configure ElevenLabs Pro para máxima naturalidade."
            : "Usando voz padrão do sistema. Nenhum módulo de voz ativo.",
      [
        clinic.elevenLabsNeedsVoiceId ? "configurar Voice ID do ElevenLabs" : null,
        !clinic.hasTtsConfig && !clinic.hasElevenLabsTts && !clinic.elevenLabsNeedsVoiceId
          ? "ativar módulo de voz (voice_tts ou ElevenLabs Pro)"
          : null,
      ],
    ),
  ];

  const enrichmentSectionIds: BlueprintSection["id"][] = [
    "objections",
    "media",
    "tts",
  ];

  const criticalMissing = sections
    .filter((s) => !enrichmentSectionIds.includes(s.id))
    .flatMap((section) =>
      section.missing.map((item) => `${section.title}: ${item}`),
    );

  const goLiveChecks = [
    clinic.isTest ? "clínica ainda está marcada como ambiente de teste" : null,
    !clinic.autoReplyEnabled ? "IA ainda está pausada" : null,
    ...sections
      .filter(
        (section) =>
          section.status !== "complete" &&
          !enrichmentSectionIds.includes(section.id),
      )
      .flatMap((section) =>
        section.missing.map(
          (item) => `${section.title.toLowerCase()}: ${item}`,
        ),
      ),
  ];
  const goLiveMissing = goLiveChecks.filter(Boolean) as string[];

  sections.push({
    id: "go_live",
    title: "Go-live",
    missing: goLiveMissing,
    summary: clinic.autoReplyEnabled
      ? "IA pronta para operar quando a clínica estiver validada."
      : "A clínica ainda depende de validação final antes de ativar a IA.",
    status: statusFromMissing(goLiveMissing, goLiveChecks.length),
  });

  const readinessPercent = Math.round(
    (sections.reduce((sum, section) => sum + scoreStatus(section.status), 0) /
      sections.length) *
      100,
  );
  const status =
    readinessPercent === 100
      ? "complete"
      : readinessPercent >= 50
        ? "attention"
        : "pending";

  return {
    readinessPercent,
    status,
    sections,
    criticalMissing,
  };
}
