import { useSyncExternalStore } from "react";
import * as Updates from "expo-updates";
import { OtaController } from "./ota-controller";
import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import { APP_RELEASE } from "./app-release";
import { githubUpdate } from "./github-ota";
import { checkReleases } from "./updates";
import { selectUpdateOffer } from "./update-offer";

const adapter = requireOptionalNativeModule<{ prepare(manifest: string | null, signature: string | null): Promise<boolean> }>("LearningUpdates");

function version(manifest: unknown): string | undefined {
  const value = manifest as { extra?: { expoClient?: { extra?: { releaseVersion?: unknown } } } } | undefined;
  const label = value?.extra?.expoClient?.extra?.releaseVersion;
  return typeof label === "string" ? label : undefined;
}
export const ota = new OtaController({
  async check() {
    return selectUpdateOffer(await checkReleases(), APP_RELEASE, Platform.OS, Updates.runtimeVersion || "",
      Updates.isEnabled && !!adapter && !__DEV__);
  },
  async download(offer) {
    if (!Updates.isEnabled || !adapter || __DEV__ || offer.kind !== "ota") return { ready: false };
    // Bind consent to the displayed release, even if another release appears
    // between the prompt and the tap. Native signature checks remain mandatory.
    const update = await githubUpdate(Platform.OS, Updates.runtimeVersion || "", APP_RELEASE, fetch, [offer.release]);
    if (!update || !await adapter.prepare(update.manifest, update.signature)) return { ready: false };
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable || version(check.manifest) !== update.version) return { ready: false };
    const result = await Updates.fetchUpdateAsync();
    return { ready: result.isNew && version(result.manifest) === update.version };
  },
  reload: () => Updates.reloadAsync(),
});
export const useOta = () => useSyncExternalStore(ota.subscribe, ota.getSnapshot, ota.getSnapshot);
