// Lógica PURA de disponibilidade do modo interno — sem I/O, 100% testável.
// O gateway (infra) faz as queries e delega transformação/overlap para cá,
// espelhando a separação que o SlotEngine já adota.

export type AppointmentLike = {
  startsAt: Date;
  endsAt: Date;
  professionalId: string | null;
};

export type BlockLike = {
  startsAt: Date;
  endsAt: Date;
  professionalId: string | null;
};

export type BusyEvent = {
  startsAt: Date;
  endsAt: Date;
  appliesPostEventBuffer?: boolean;
};

// Com profissional informado, contam apenas os eventos dele + os da clínica
// inteira (professionalId null). Sem profissional, tudo conta (clínica tratada
// como recurso único — comportamento da Fase A; Fase C refina por sala/profissional).
function matchesProfessional(rowProfessionalId: string | null, professionalId?: string): boolean {
  return !professionalId || rowProfessionalId === null || rowProfessionalId === professionalId;
}

export function buildBusyEvents(input: {
  appointments: AppointmentLike[];
  blocks: BlockLike[];
  professionalId?: string;
}): BusyEvent[] {
  const busy: BusyEvent[] = [];

  for (const a of input.appointments) {
    if (matchesProfessional(a.professionalId, input.professionalId)) {
      // Consultas recebem o buffer pós-evento configurado na clínica.
      busy.push({ startsAt: a.startsAt, endsAt: a.endsAt, appliesPostEventBuffer: true });
    }
  }

  for (const b of input.blocks) {
    if (matchesProfessional(b.professionalId, input.professionalId)) {
      // Bloqueios não recebem buffer (espelha o comportamento do GCal).
      busy.push({ startsAt: b.startsAt, endsAt: b.endsAt, appliesPostEventBuffer: false });
    }
  }

  return busy;
}

// Overlap de intervalos meio-aberto [start, end). Eventos que apenas encostam
// (fim de um == início do outro) NÃO conflitam.
export function hasOverlap(
  busy: { startsAt: Date; endsAt: Date }[],
  startsAt: Date,
  endsAt: Date,
): boolean {
  const startMs = startsAt.getTime();
  const endMs = endsAt.getTime();
  return busy.some((e) => e.startsAt.getTime() < endMs && e.endsAt.getTime() > startMs);
}
