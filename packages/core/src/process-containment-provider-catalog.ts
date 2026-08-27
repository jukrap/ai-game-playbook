import {
  computeProcessContainmentProviderCatalogDigest,
  type ProcessContainmentProviderDescriptor,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";

export interface ProcessContainmentProviderCatalogSnapshot {
  readonly schemaVersion: "1.0.0";
  readonly registration: "compiled";
  readonly dynamicRegistration: false;
  readonly providers: readonly ProcessContainmentProviderDescriptor[];
  readonly catalogDigest: Sha256Digest;
}

const COMPILED_PROCESS_CONTAINMENT_PROVIDERS: readonly ProcessContainmentProviderDescriptor[] =
  Object.freeze([]);

export const PROCESS_CONTAINMENT_PROVIDER_CATALOG_DIGEST: Sha256Digest =
  computeProcessContainmentProviderCatalogDigest(
    COMPILED_PROCESS_CONTAINMENT_PROVIDERS,
  );

const CATALOG_SNAPSHOT: ProcessContainmentProviderCatalogSnapshot =
  Object.freeze({
    schemaVersion: "1.0.0",
    registration: "compiled",
    dynamicRegistration: false,
    providers: COMPILED_PROCESS_CONTAINMENT_PROVIDERS,
    catalogDigest: PROCESS_CONTAINMENT_PROVIDER_CATALOG_DIGEST,
  });

export function inspectProcessContainmentProviderCatalog(): ProcessContainmentProviderCatalogSnapshot {
  return CATALOG_SNAPSHOT;
}
