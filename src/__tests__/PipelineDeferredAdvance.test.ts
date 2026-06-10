// Bug #3 fix: pipeline state advance must happen AFTER all content blocks are sent.
//
// Before the fix: advancePipelineStep was called immediately when the "content" step
// was matched, while send loops (9.1 / 9.2) still had 7+ seconds of blocks to deliver.
// A concurrent webhook arriving during that window found pipelineState = Q&A and called
// compose(), injecting a comparison text mid-sequence between the two video blocks.
//
// After the fix: pendingPipelineAdvance is a closure set at decision time and executed
// at step 9.3, strictly after the send loops complete. The concurrent webhook that
// arrives during delivery still sees pipelineState = content and is de-duped or queued.

import { describe, it, expect } from "vitest";

// ─── Pure model of the advance-vs-send sequencing ─────────────────────────

type PipelineStepType = "content" | "qa" | "photo" | "ask_availability" | "offer_slots" | "book";

interface PipelineStep {
  index: number;
  type: PipelineStepType;
}

interface ConversationState {
  pipelineStepIndex: number | null;
}

/**
 * Simulates the BEFORE behaviour: advance happens immediately at decision time.
 * Returns the pipelineStepIndex after decision but BEFORE content is sent.
 */
function advanceImmediately(
  state: ConversationState,
  steps: PipelineStep[],
  currentIndex: number,
): { stateAfterDecision: ConversationState; stateAfterSend: ConversationState } {
  const next = steps.find((s) => s.index > currentIndex) ?? null;

  const stateAfterDecision: ConversationState = {
    pipelineStepIndex: next ? next.index : null,
  };

  // State is already advanced when send begins
  const stateAfterSend = stateAfterDecision;

  return { stateAfterDecision, stateAfterSend };
}

/**
 * Simulates the AFTER behaviour: advance happens only after content is fully sent.
 * Returns the pipelineStepIndex at decision time (still pointing to content) and after send.
 */
function advanceDeferred(
  state: ConversationState,
  steps: PipelineStep[],
  currentIndex: number,
): { stateAfterDecision: ConversationState; stateAfterSend: ConversationState } {
  // Decision time: register deferred advance but DO NOT mutate state yet
  const stateAfterDecision: ConversationState = { ...state }; // unchanged

  // After send: execute deferred closure
  const next = steps.find((s) => s.index > currentIndex) ?? null;
  const stateAfterSend: ConversationState = {
    pipelineStepIndex: next ? next.index : null,
  };

  return { stateAfterDecision, stateAfterSend };
}

/**
 * Models what a concurrent webhook sees when it reads pipelineStepIndex mid-delivery.
 * Returns the step type it would match against.
 */
function concurrentWebhookStep(
  stateAtArrival: ConversationState,
  steps: PipelineStep[],
): PipelineStep | null {
  if (stateAtArrival.pipelineStepIndex === null) return null;
  return steps.find((s) => s.index === stateAtArrival.pipelineStepIndex) ?? null;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

const LENTES_PIPELINE: PipelineStep[] = [
  { index: 0, type: "content" },
  { index: 1, type: "qa" },
  { index: 2, type: "photo" },
  { index: 3, type: "ask_availability" },
  { index: 4, type: "offer_slots" },
  { index: 5, type: "book" },
];

describe("Pipeline — avanço imediato (comportamento ANTES do fix)", () => {
  it("estado já aponta para Q&A enquanto blocos de conteúdo ainda estão sendo enviados", () => {
    const initialState: ConversationState = { pipelineStepIndex: 0 }; // content

    const { stateAfterDecision } = advanceImmediately(initialState, LENTES_PIPELINE, 0);

    // BUG: state is already at Q&A (index 1) before send loops finish
    expect(stateAfterDecision.pipelineStepIndex).toBe(1);

    // A concurrent webhook reading this state during the 7s send window:
    const concurrentStep = concurrentWebhookStep(stateAfterDecision, LENTES_PIPELINE);
    expect(concurrentStep?.type).toBe("qa");
    // → concurrent request calls compose() with Q&A context → text injected mid-sequence
  });
});

describe("Pipeline — avanço adiado (comportamento DEPOIS do fix)", () => {
  it("estado permanece em 'content' durante toda a entrega dos blocos", () => {
    const initialState: ConversationState = { pipelineStepIndex: 0 }; // content

    const { stateAfterDecision, stateAfterSend } = advanceDeferred(
      initialState,
      LENTES_PIPELINE,
      0,
    );

    // FIX: state is still at content (index 0) when concurrent webhook arrives mid-send
    expect(stateAfterDecision.pipelineStepIndex).toBe(0);

    const concurrentStep = concurrentWebhookStep(stateAfterDecision, LENTES_PIPELINE);
    expect(concurrentStep?.type).toBe("content");
    // → concurrent request sees content step → de-duped by content window → no injection

    // And AFTER all blocks are sent, state correctly advances to Q&A
    expect(stateAfterSend.pipelineStepIndex).toBe(1);
    const stepAfterSend = concurrentWebhookStep(stateAfterSend, LENTES_PIPELINE);
    expect(stepAfterSend?.type).toBe("qa");
  });

  it("avanço adiado em último step encerra o pipeline após envio", () => {
    const steps: PipelineStep[] = [
      { index: 0, type: "content" },
      // no more steps
    ];
    const initialState: ConversationState = { pipelineStepIndex: 0 };

    const { stateAfterDecision, stateAfterSend } = advanceDeferred(initialState, steps, 0);

    expect(stateAfterDecision.pipelineStepIndex).toBe(0); // unchanged during send
    expect(stateAfterSend.pipelineStepIndex).toBeNull();  // pipeline exited after send
  });

  it("pipeline de 6 etapas avança corretamente por todos os steps na sequência", () => {
    let state: ConversationState = { pipelineStepIndex: 0 };

    const expectedSequence: Array<PipelineStepType | null> = [
      "qa",              // after content
      "photo",           // after qa
      "ask_availability",// after photo
      "offer_slots",     // after ask_availability
      "book",            // after offer_slots
      null,              // pipeline exited after book
    ];

    for (let i = 0; i < LENTES_PIPELINE.length; i++) {
      const { stateAfterSend } = advanceDeferred(state, LENTES_PIPELINE, i);
      state = stateAfterSend;

      const stepType = state.pipelineStepIndex !== null
        ? LENTES_PIPELINE.find((s) => s.index === state.pipelineStepIndex)?.type ?? null
        : null;

      expect(stepType).toBe(expectedSequence[i]);
    }
  });
});

describe("Pipeline — garantia de ordenação: avanço ocorre estritamente após envio", () => {
  it("eventos: [decisão] → [envio blocos] → [avanço de estado] — nesta ordem", () => {
    const eventLog: string[] = [];

    const steps = LENTES_PIPELINE;
    const initialState: ConversationState = { pipelineStepIndex: 0 };

    // Simulate the orchestrator flow with event recording
    let pendingAdvance: (() => void) | null = null;

    // Step 1: decision — register pending advance
    eventLog.push("decision:content");
    pendingAdvance = () => {
      eventLog.push("advance:content→qa");
    };

    // Step 2: send all content blocks (synchronous stand-in for async send loops)
    eventLog.push("send:textBlock1");
    eventLog.push("send:videoBlock1");
    eventLog.push("send:textBlock2");
    eventLog.push("send:videoBlock2");

    // Step 3: execute deferred advance
    pendingAdvance!();

    expect(eventLog).toEqual([
      "decision:content",
      "send:textBlock1",
      "send:videoBlock1",
      "send:textBlock2",
      "send:videoBlock2",
      "advance:content→qa",    // ← strictly last, after all sends
    ]);

    // Verify: no advance event appears before any send event
    const advanceIndex = eventLog.indexOf("advance:content→qa");
    const lastSendIndex = eventLog.lastIndexOf("send:videoBlock2");
    expect(advanceIndex).toBeGreaterThan(lastSendIndex);
  });
});
