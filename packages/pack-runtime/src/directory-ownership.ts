import {
  canonicalizeJson,
  digestCanonicalJson,
  isPortableProjectPath,
  sha256Digest,
  type PackManifest,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";

import { PackRuntimeError } from "./errors.js";
import type { PackDirectoryOwnershipMarker } from "./types.js";

export const PACK_DIRECTORY_OWNERSHIP_MARKER_NAME = ".agpb-owned";

export interface CreatedPackDirectoryOwnershipMarker {
  readonly descriptor: PackDirectoryOwnershipMarker;
  readonly content: Uint8Array;
}

export function createPackDirectoryOwnershipMarker(
  pack: Pick<PackManifest, "id" | "digest">,
  directoryPath: string,
): CreatedPackDirectoryOwnershipMarker {
  const markerPath = `${directoryPath}/${PACK_DIRECTORY_OWNERSHIP_MARKER_NAME}`;
  if (!isPortableProjectPath(directoryPath) || !isPortableProjectPath(markerPath)) {
    throw new PackRuntimeError(
      "pack-plan-untrusted",
      directoryPath,
      "directory ownership marker path is not portable",
    );
  }
  const ownershipDigest: Sha256Digest = digestCanonicalJson({
    domain: "ai-game-playbook.pack-directory-ownership",
    version: "1",
    packId: pack.id,
    ownerPackDigest: pack.digest,
    directoryPath,
    markerPath,
  });
  const marker = {
    schemaVersion: "1.0.0" as const,
    packId: pack.id,
    ownerPackDigest: pack.digest,
    directoryPath,
    ownershipDigest,
  };
  const content = Buffer.from(`${canonicalizeJson(marker)}\n`, "utf8");
  return Object.freeze({
    descriptor: Object.freeze({
      directoryPath,
      path: markerPath,
      digest: sha256Digest(content),
      bytes: content.byteLength,
      ownershipDigest,
      ownerPackDigest: pack.digest,
    }),
    content: new Uint8Array(content),
  });
}
