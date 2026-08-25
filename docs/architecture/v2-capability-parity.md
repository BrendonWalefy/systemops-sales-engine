# V2-only capability parity

Status: executable classification for the V2-only production cut. The table is
ordered and complete by contract; no behavior may resolve to V1.

| Behavior | Resolution | Current owner and safe boundary |
| --- | --- | --- |
| `opening_reception` | `v2_capability` | Dental reception/catalog capability produces an authorized response plan. |
| `catalog` | `v2_capability` | Dental catalog capability reads only the claimed tenant catalog. |
| `authorized_price` | `v2_capability` | Catalog facts disclose only explicitly quotable prices. |
| `objections` | `safe_handoff` | No deterministic V2 objection capability exists yet; unsupported cases end in explicit human attention. |
| `multi_turn_pipeline` | `shared_service` | Deterministic guided-pipeline state and operator-selected content remain shared; interpretation-dependent continuation durably pauses for human attention without V1 replay. |
| `media` | `shared_service` | Canonical ingress/history persists media independently of runtime selection; unsupported interpretation creates no inferred effect or V1 call. |
| `qualification` | `obsolete` | V2 does not infer and persist lead qualification as a side effect of model text; deterministic capabilities own explicit business effects. |
| `scheduling_revalidation` | `v2_capability` | Dental scheduling capability uses BookingService and tenant-scoped calendar reads. |
| `reservation` | `shared_service` | SlotReservationService and BookingService own reservation and double-booking safety. |
| `deposit` | `shared_service` | Existing deterministic reservation, proof review and operator decision services own deposit effects; no V1 runtime selection is involved. |
| `cancel_reschedule` | `safe_handoff` | Unscoped calendar mutations are rejected; a tenant-scoped V2 capability is required. |
| `opt_out` | `shared_service` | Deterministic stop-contact policy persists consent and creates at most one confirmation. |
| `handoff` | `v2_capability` | Dental escalation capability returns a human-action-required result. |
| `takeover` | `shared_service` | Live turn configuration suppresses active takeover and resumes only an expired lease. |
| `turn_follow_up` | `shared_service` | Existing durable follow-up service remains outside engine selection and tenant-scoped. |
| `voice` | `shared_service` | Voice module configuration is resolved by the claimed clinic ID; sender owns delivery format. |

## Runtime boundary

The production composition root constructs only `V2LiveConversationHandler`.
Missing provider configuration raises a typed V2 error. Unsupported behavior
uses a V2 safe response or handoff; it never constructs or calls V1.

During the Task-4/Task-5 implementation boundary, new sender-owned V2 delivery
remains fail-closed. Task 5 replaces that temporary closed boundary with the
definitive atomic creation fence and sender-time authority/safety preflight.
