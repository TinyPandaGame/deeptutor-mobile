/** Invalidates pending UI work when its account, content or view changes. */
export class ActionGate {
  private revision = 0;
  private pending = false;
  readonly owner: unknown;
  readonly identity: string;
  constructor(owner: unknown, identity = '') { this.owner = owner; this.identity = identity; }
  reset() { this.revision++; this.pending = false; }
  token() { return this.revision; }
  active(token: number) { return token === this.revision; }
  busy() { return this.pending; }
  begin(token: number) {
    if (!this.active(token) || this.pending) return false;
    this.pending = true; return true;
  }
  finish(token: number) { if (this.active(token)) this.pending = false; }
}
