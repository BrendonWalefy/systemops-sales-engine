/**
 * Arbitrates attention side effects within one orchestration turn.
 * A response-plan safety review has priority over business-path handoffs that
 * run later in the same turn, so its canonical reason is never replaced and
 * operators receive a single notification.
 */
export class TurnSafetyHandoffGuard {
  private safetyHandoffApplied = false;

  get hasSafetyHandoff(): boolean {
    return this.safetyHandoffApplied;
  }

  async applySafetyHandoff(effect: () => Promise<void>): Promise<boolean> {
    if (this.safetyHandoffApplied) return false;
    this.safetyHandoffApplied = true;
    await effect();
    return true;
  }

  async applyLaterHandoff(effect: () => Promise<void>): Promise<boolean> {
    if (this.safetyHandoffApplied) return false;
    await effect();
    return true;
  }
}
