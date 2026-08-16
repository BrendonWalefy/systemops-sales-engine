# ADR — Authorized reads in Conversation Intelligence V2 capabilities

Date: 2026-08-16
Status: accepted for Cycle G

## Context

`CapabilityContext` contains only state, structured policy and clock. Scheduling and catalog
decisions need current facts, but adding repositories or provider clients to that context would
couple the core to infrastructure and turn it into a service locator.

## Decision

Concrete capabilities own narrow ports injected at construction. A composition root creates
tenant-scoped instances. Read ports are referenced only by `decide()`; write ports only by
`execute()`. The core knows neither interface nor adapter and `CapabilityContext` is unchanged.

The pipeline obtains every Decision before executing the first one. This makes read/decision
failure fail closed with zero writes and preserves pack order for subsequent execution.

## Consequences

- Dependencies stay inverted and capabilities remain independently testable.
- Tenant scope is fixed before a turn rather than supplied repeatedly by untrusted claim data.
- Shadow can later replace write ports/execution without replacing decision reads.
- A capability with several unrelated dependencies is a design smell; ports remain vertical and
  capability-specific rather than becoming a shared registry.
- Concrete DB/calendar adapters and production composition remain separate wiring work; G proves
  the operational contracts without enabling V2 in production.
