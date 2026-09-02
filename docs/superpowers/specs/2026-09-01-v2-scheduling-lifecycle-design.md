# V2 Scheduling Lifecycle Design

Date: 2026-09-01
Status: approved execution slice

## Objective

Complete the definitive V2 scheduling conversation without recreating the agenda stack. V2 owns
interpretation and typed orchestration; `SlotEngine`, `ConversationStateMachine`,
`SlotReservationService`, `BookingService`, the tenant calendar gateway and the appointment
repository remain the operational authorities.

The slice covers availability, professional preference, slot offer/reoffer, booking, appointment
confirmation, listing, cancellation and rescheduling. It has no V1 runtime or fallback.

## Boundaries and ownership

- `Understanding<DentalRequest>` identifies the scheduling request and closed entities. It never
  decides whether a slot or appointment exists.
- `dental-scheduling` continues to own availability, persisted slot offers, slot choice, booking
  and appointment confirmation.
- New `dental-appointment-lifecycle` owns listing, cancellation and the start of rescheduling.
- `BookingService` owns irreversible booking/cancellation/rescheduling effects and their
  compensation rules.
- `ConversationStateMachine` owns the pending offer. Reschedule context is persisted beside the
  offered slots; it is never reconstructed from message text.
- The response pipeline verbalizes only typed facts and effect receipts. It does not choose dates,
  professionals or appointments.

## Understanding contract

Add `list-appointments` to the closed request vocabulary and `entities.professional` as a nullable
canonical professional name. The model receives an allowlisted active professional catalog for the
claimed tenant. It may copy one exact canonical name; unknown names remain text-free ambiguity and
are resolved by deterministic code.

Scheduling mappings:

- availability or new booking request -> `book-appointment`;
- selection from the current slot offer -> `confirm-slot` with ordinal/date/time;
- explicit confirmation of a pending appointment -> `confirm-appointment`;
- request to see current appointments -> `list-appointments`;
- cancellation -> `cancel-appointment` with optional ordinal/date/time;
- rescheduling -> `reschedule-appointment` with optional ordinal/date/time plus requested new
  date/period and professional.

No request is inferred from keywords after the structured contract is accepted.

## Tenant-bound ports

`DentalSchedulingReadPort` gains professional-aware slot search. A new lifecycle port exposes:

```ts
type DentalAppointmentLifecycleReadPort = {
  listActiveAppointments(): Promise<readonly DentalAppointmentReference[]>;
  resolveActiveAppointment(input: AppointmentSelection): Promise<
    | { kind: "resolved"; appointment: DentalAppointmentReference }
    | { kind: "missing" }
    | { kind: "ambiguous"; appointments: readonly DentalAppointmentReference[] }
  >;
  listReplacementSlots(input: ReplacementSlotSearch): Promise<DentalSlotSearchResult>;
};

type DentalAppointmentLifecycleWritePort = {
  persistReplacementOffer(input: ReplacementOffer): Promise<DentalSlotSearchResult>;
  cancelAppointment(appointmentId: string): Promise<DentalSchedulingWriteOutcome>;
};
```

Every adapter is constructed with one clinic and lead. Model output never carries a clinic ID,
lead ID, appointment ID or professional ID. Exact IDs come only from tenant-scoped reads and
persisted state.

## Professional preference

Only active professionals from the claimed tenant are eligible. Exact normalized name/alias
resolution yields one ID; zero or multiple matches ask for clarification. No default professional
is guessed when several active professionals exist.

Availability passes the selected professional to the calendar gateway and independently enforces
the professional work schedule. Existing clinic-wide reservation exclusion remains conservative:
the slice does not weaken double-booking protection or introduce parallel same-time reservations.
The selected professional is persisted on the resulting appointment by `BookingService`.

## Appointment selection

Active appointments are restricted to the claimed clinic and lead, statuses `scheduled` or
`confirmed`, ordered by `(startsAt, id)`. Selection is deterministic:

- one active appointment and no selector -> resolved;
- ordinal, local date or local time that matches exactly one -> resolved;
- zero -> missing;
- more than one -> ambiguous and returned as authorized options.

Provider timestamps and message prose never choose an appointment.

## State machines

### New booking

```text
book-appointment
  -> resolve treatment/professional
  -> list real slots
  -> persist slots_offered with treatment/professional tuple
  -> confirm-slot resolves one persisted slot
  -> BookingService.book
  -> appointment_created or typed failure/reoffer
```

### Cancellation

```text
cancel-appointment
  -> resolve active appointment
  -> missing / ambiguous options / exact appointment
  -> BookingService.cancel with exact clinic+lead binding
  -> appointment_cancelled or appointment_cancel_failed
```

Cancellation is idempotent for an already-cancelled exact appointment and never cancels every
appointment merely because the lead used a plural or omitted a selector.

### Rescheduling

```text
reschedule-appointment
  -> resolve exact active appointment
  -> list replacement slots without mutating the current appointment
  -> persist slots_offered with replacesAppointmentId
  -> confirm-slot resolves one persisted replacement
  -> BookingService.reschedule
  -> appointment_rescheduled or typed failure/reoffer
```

The old appointment remains active until the replacement slot is reserved and revalidated.
`BookingService.reschedule` updates the same appointment rather than creating a second live
appointment. It reserves the target, excludes the same appointment from overlap checks, updates
the external event when present, persists the new interval/professional, confirms the new
reservation and releases the old reservation. A failure before the external update releases the
target and leaves the old appointment unchanged. A DB failure after an external update attempts
one compensation back to the old interval; failed compensation becomes explicit handoff and is
never reported as success.

Retries reuse the durable turn authority and persisted offer. An appointment already at the exact
target is success; no second external update, appointment or reply is created.

## Outcomes and response authorization

Add typed outcomes and provenance for:

- `appointments_listed`;
- `appointment_cancelled` / `appointment_cancel_failed`;
- `appointment_reschedule_offered`;
- `appointment_rescheduled` / `appointment_reschedule_failed`;
- `appointment_selection_required`;
- `no_active_appointment`;
- `slot_taken_reoffered` when fresh replacement options are available.

Appointment/slot labels and professional display names are the only scheduling display facts.
Internal IDs, calendar IDs and failure details never enter model input, response text or Decision
Trace. A successful effect requires write evidence. Failure cannot be verbalized as completion.

## Failure and retry policy

- stale/expired offer -> fresh bounded offer or clarification, never booking from stale data;
- slot taken before write -> fresh offer when available;
- provider/calendar unavailable before mutation -> typed safe failure, no appointment mutation;
- indeterminate external/DB compensation -> terminal handoff with no automatic recomposition;
- process retries remain bounded by the existing three-claim budget;
- sender retries remain bounded by the existing ten-attempt budget;
- outbox dedupe remains one live reply per inbound authority tuple.

No polling, heartbeat, continuously running worker or new queue is introduced.

## Trace and privacy

Existing stages remain canonical: `v2.understanding`, `v2.decision`, `v2.action_result`, response
plan/validation, outbox and sender. Metadata adds closed request, capability, action and outcome
codes plus counts for active appointments and offered slots. It excludes names, phone numbers,
message content, timestamps presented to the lead, calendar IDs and raw provider errors.

## Tests and performance

Required RED/GREEN cases include:

- requested professional exact/unknown/ambiguous/cross-tenant/inactive;
- date/period availability and persisted deterministic order;
- expired offer, ordinal/date/time selection and slot-taken reoffer;
- list zero/one/multiple appointments;
- cancel exact, ambiguous, duplicate retry and cross-tenant denial;
- reschedule success, target conflict, provider failure, DB compensation and idempotent retry;
- old appointment retained until the new target is safely committed;
- no duplicate appointment/outbox/reply under concurrent confirmation;
- sender and authority-v2 gates unchanged.

Runtime measurements use the frozen baseline. One turn still uses one Understanding call and at
most one verbalization. No-path query growth may exceed two bounded round trips versus the current
scheduling path; p50/p95 turn latency must remain within +10% and +100/+250 ms; tokens within
+10%/+15%; lock p95 within +10%/+5 ms; job/outbox cardinality remains one each. Idle SQL wakeups
and Neon compute-active time must not increase.

## Rollout and rollback

The deploy does not activate or modify tenants. Paused, disabled, demo, prospect, cancelled or
authority-below-v2 tenants remain fail-closed. Sender preflight and the global kill switch remain
unchanged.

Rollback before any reschedule use is a normal revert. After a V2 reschedule has completed,
rollback may disable live sends or deploy a previously proven V2-only build; it never routes to
V1. Schema migration is not expected for this slice. If implementation proves one is necessary,
generated Drizzle migration review is a separate stop boundary.

