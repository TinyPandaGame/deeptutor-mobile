import type { OtaController } from "./ota-controller.ts";
import type { UpdateOffer } from "./update-offer.ts";

export function observeUpdateChecks(controller: OtaController, app: {
  current(): string | null;
  subscribe(listener: (status: string) => void): () => void;
}, prompt: (offer: UpdateOffer) => void) {
  let mounted = true;
  let previous = app.current();
  const notify = () => {
    if (!mounted || app.current() !== "active") return;
    const offer = controller.claimPrompt();
    if (offer) prompt(offer);
  };
  const unsubscribe = controller.subscribe(notify);
  const check = () => { void controller.check(true).then(notify); };
  if (!previous || previous === "active") check();
  const stop = app.subscribe(status => {
    if (status === "active" && previous !== "active") check();
    previous = status;
  });
  return () => { mounted = false; unsubscribe(); stop(); };
}
