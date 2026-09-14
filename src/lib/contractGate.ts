/**
 * Holds back every `/v1` request while the backend speaks a contract this
 * viewer cannot read.
 *
 * The health store decides: once `/health` reports a different contract
 * major the gate closes, and requests wait instead of reaching a backend
 * whose answers the viewer would misread. When a later `/health` reports
 * a supported contract the gate opens and the waiting requests go out.
 *
 * Before the first answer the gate can be held, so the requests the app
 * makes as it starts (the tree, the detectors, a file named in the link)
 * wait for that answer instead of racing it. A failed `/health` opens
 * the gate: nothing is known about the contract, and the requests then
 * fail or succeed on their own, as they would without the gate.
 */
import type { ContractCompatibility } from './utils/contractVersion';

type GateState = 'open' | 'waiting' | 'closed';

export class ContractGate {
  private state: GateState = 'open';
  private decided = false;
  private waiters = new Set<() => void>();

  /** Whether a request may go out now. */
  get isOpen(): boolean {
    return this.state === 'open';
  }

  /** Hold requests until the first decision. Does nothing after it. */
  hold(): void {
    if (!this.decided) this.state = 'waiting';
  }

  /** Open or close the gate for the contract the backend reported. */
  decide(contract: ContractCompatibility): void {
    this.decided = true;
    this.state = contract.kind === 'incompatible' ? 'closed' : 'open';
    if (this.state !== 'open') return;
    const waiting = [...this.waiters];
    this.waiters.clear();
    for (const release of waiting) release();
  }

  /**
   * Resolve when a request may go out: at once when the gate is open,
   * otherwise when it opens. Rejects with an AbortError, as `fetch` does,
   * when `signal` is aborted while waiting.
   */
  pass(signal?: AbortSignal | null): Promise<void> {
    if (this.state === 'open') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.waiters.delete(release);
        reject(new DOMException('The request was aborted while waiting.', 'AbortError'));
      };
      const release = () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
      this.waiters.add(release);
    });
  }

  /** Back to the state before any decision. For tests. */
  reset(): void {
    this.state = 'open';
    this.decided = false;
    this.waiters.clear();
  }
}

/** The gate every `/v1` request passes through. */
export const contractGate = new ContractGate();
