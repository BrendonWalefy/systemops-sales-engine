// Storage em memória compartilhado pelos testes de telemetria de navegação.
// Não é arquivo de teste (o include do vitest é `**/*.test.ts`), é helper:
// antes existia uma cópia literal em ContentReadyReporterBudget.test.ts e
// outra em ContentReadyReporterComponent.test.ts, e duas cópias de um duplo
// de teste divergem em silêncio.
export class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  get length(): number {
    return this.values.size;
  }
}
