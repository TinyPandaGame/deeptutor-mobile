import type { UpdateOffer } from "./update-offer.ts";

export type OtaState = {
  status: "idle" | "checking" | "available" | "downloading" | "ready" | "current" | "error";
  offer?: UpdateOffer; checkedAt?: number; message?: string;
};
export type OtaDriver = {
  check(): Promise<UpdateOffer | null>;
  download(offer: UpdateOffer): Promise<{ ready: boolean }>;
  reload(): Promise<void>;
};

// No learning account or service client participates in application updates.
export class OtaController {
  snapshot: OtaState = { status: "idle" };
  private listeners = new Set<() => void>();
  private pending: Promise<void> | null = null;
  private lastCheck = -Infinity;
  private prompted = new Set<string>();
  private driver: OtaDriver;
  constructor(driver: OtaDriver) { this.driver = driver; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private set(value: OtaState) { this.snapshot = value; this.listeners.forEach(fn => fn()); }
  check = (fresh = false): Promise<void> => {
    if (this.pending) return this.pending;
    if (this.snapshot.status === "ready") return Promise.resolve();
    if (!fresh && Date.now() - this.lastCheck < 60000) return Promise.resolve();
    this.lastCheck = Date.now();
    this.pending = this.run().finally(() => { this.pending = null; });
    return this.pending;
  };
  private async run() {
    this.set({ ...this.snapshot, status: "checking", message: undefined });
    try {
      const offer = await this.driver.check();
      this.set({ status: offer ? "available" : "current", offer: offer || undefined, checkedAt: Date.now() });
    } catch (error) {
      this.set({ ...this.snapshot, status: "error", message: error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)
        ? error.message : "暂时无法检查更新，请联网后重试。" });
    }
  }
  // Claim once per version/install method in this app run. Dismissal does not
  // discard the offer: the page can still show it and start an explicit download.
  claimPrompt = (): UpdateOffer | null => {
    const { status, offer } = this.snapshot;
    if (status !== "available" || !offer) return null;
    const key = `${offer.release.tag}:${offer.kind}`;
    if (this.prompted.has(key)) return null;
    this.prompted.add(key);
    return offer;
  };
  download = (tag: string): Promise<void> => {
    if (this.pending) return this.snapshot.status === "checking"
      ? this.pending.then(() => this.download(tag)) : this.pending;
    const { offer, status } = this.snapshot;
    if (!offer || offer.kind !== "ota" || offer.release.tag !== tag || status === "ready") return Promise.resolve();
    this.pending = this.fetch(offer).finally(() => { this.pending = null; });
    return this.pending;
  };
  private async fetch(offer: UpdateOffer) {
    this.set({ ...this.snapshot, status: "downloading", message: undefined });
    try {
      const download = await this.driver.download(offer);
      if (!download.ready) throw Error("Update not downloaded");
      this.set({ ...this.snapshot, status: "ready" });
    } catch {
      this.set({ ...this.snapshot, status: "error", message: "下载未完成，请重试。你可以继续使用当前版本。" });
    }
  }
  restart = async () => {
    if (this.snapshot.status !== "ready") return;
    try { await this.driver.reload(); }
    catch { this.set({ ...this.snapshot, message: "请关闭并重新打开应用，让已下载的更新生效。" }); }
  };
}
