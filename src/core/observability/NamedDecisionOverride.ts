export type DeterministicIntentOverrideRule =
  | "stop_contact_normalization"
  | "business_intent_coercion"
  | "commercial_pause"
  | "payment_policy_question"
  | "business_hours_question"
  | "quantity_price_followup"
  | "procedure_clarification"
  | "uncatalogued_maintenance"
  | "clinical_judgment_handoff"
  | "atypical_case_triage"
  | "existing_work_damage"
  | "warranty_policy"
  | "deposit_change_after_proof"
  | "missing_pending_offer_normalization"
  | "open_offer_acceptance";

/** Mantém o valor final e a ordem exata das regras determinísticas aplicadas. */
export class NamedDecisionOverrideTracker<T extends string> {
  private currentValue: T;
  private readonly appliedRules: DeterministicIntentOverrideRule[] = [];

  constructor(initialValue: T) {
    this.currentValue = initialValue;
  }

  apply(nextValue: T, rule: DeterministicIntentOverrideRule): T {
    if (nextValue !== this.currentValue) {
      this.currentValue = nextValue;
      this.appliedRules.push(rule);
    }
    return this.currentValue;
  }

  get value(): T {
    return this.currentValue;
  }

  get rules(): readonly DeterministicIntentOverrideRule[] {
    return [...this.appliedRules];
  }
}
