---
source: docs/status-and-scope.md
source_sha256: 0b44244982a979f8d0743b7bce5d2d28b99ccba422c3e674d0c80dddb22d06b8
translated_at: 2026-08-27
---

# 현재 상태와 범위

> 상태: 2026-08-27에 검토한 Stage 2 control-plane 구현 단계입니다. Source-built write-free command 세 개를 사용할 수 있으며 engine 지원은 planned입니다.

[English](status-and-scope.md) · [문서](README.ko.md)

## 현재 저장소 상태

저장소에는 private pnpm/TypeScript workspace, versioned schema, semantic validator, typed registry validation/generation, deterministic workflow-plan attestation, implemented command용 runtime registry, digest 결합 공개 surface, test, Windows/Linux CI, 초기 core package, private evidence package, managed-pack runtime, experimental CLI package가 있습니다.

구현된 core 경계는 다음을 포함합니다.

- writable link traversal 없는 canonical project-root binding과 portable path resolution;
- bounded deterministic root-entry/directory/file inspection;
- staged SHA-256 compare-and-swap write, delete, reversible empty-directory removal;
- environment, working directory, time, idle, output을 제한하는 digest-bound direct process execution;
- bounded waiting과 dead-owner-only recovery를 가진 root/project 결합 mutation lease 하나;
- schema-bound permission admission, exact scoped signed grant, effect settlement;
- deterministic workflow-plan resolution과 immutable state transition;
- restart classification을 포함한 canonical append-only checkpoint chain;
- compare-and-swap head, exact authority binding, redaction check를 포함한 canonical append-only run-receipt record;
- canonical filename check, latest-record 존재, same-process load witness, 고정 entry/head/byte limit을 포함한 bounded whole-directory receipt-head query;
- complete project-local artifact snapshot을 receipt가 증명하는 manifest와 함께 immutable SHA-256 object로 승격하는 private promotion;
- raw process output을 복사하지 않고 bounded process와 structured test-report observation을 fail-closed로 정규화하는 경계;
- raw content를 출력하지 않으면서 보존된 UTF-8, canonical JSON 또는 non-interlaced PNG artifact 하나와 선택적 current-registry `AssetProvenance` 일치를 fail-closed로 평가하는 경계.

Private pack runtime은 write-free preflight, canonical installed state, exact dependency/ownership, local add/update/remove transaction, active marker, append-only journal, compare-and-swap promotion, clear-failure rollback, marker-bound direct-parent directory ownership, reversible tombstone, bounded recovery inspection, 별도 승인 stable-state finalization을 구현합니다.

Source-built `agpb` executable은 현재 plan-only `init`, read-only `doctor`, static read-only `project inspect`를 노출합니다. `init`은 고정된 project-local target 16개를 분류해 identity-bound `InitReport`를 출력하지만 plan을 apply할 수 없습니다. `doctor`는 runtime-registry parity, 지원 Node.js 범위, canonical project root 하나, fixed runtime layout, installed-pack-state validity, active transaction marker를 검사합니다. `project inspect`는 bounded Godot/Unity/Unreal marker candidate, canonical profile validity/compatibility, marker-only dirty-state knowledge, unbound static Editor signal을 보고합니다. 세 명령 모두 registered report에서 human 또는 canonical JSON output을 만들며 write를 수행하지 않습니다.

## 사용할 수 없는 것

Installable/published package, MCP server, Codex integration package, general command dispatcher, approval UI, durable approval store, evidence CLI/export path, engine report parser, mutating pack CLI, recovery-finalization command, CPU/memory sandbox, engine bridge, engine pack, live-engine automation, playable golden project는 없습니다.

Mutating initialization, pack/skill command, engine command, workflow execution, verification, evidence command, documentation command integration은 planned입니다. Private library function은 public command가 아니며 runtime registry도 이러한 planned operation을 노출하지 않습니다.

Project-state bootstrap, artifact promotion, receipt persistence와 bounded head query, component result normalization, retained-artifact assessment, pack mutation, recovery inspection, recovery finalization은 private API입니다. 현재 `init`은 layout intent와 conflict를 보고할 수 있지만 profile, policy, ignore, runtime-state byte를 만들 수 없습니다. 현재 doctor는 unsafe state를 식별할 수 있지만 initialize, repair, clear, recovery classify, finalize할 수 없습니다. Project inspection은 Git 실행, process 열거, Editor liveness/session identity 확립, stage evidence content 검증, engine 연결, engine support grade 승격을 수행하지 않습니다. Workflow runtime은 general dispatch와 연결되지 않았습니다. Durable receipt JSON, bounded head summary, bounded content-addressed artifact byte, pure process/test outcome normalization, 제한된 UTF-8/canonical-JSON/non-interlaced-PNG 및 provenance assessment는 존재합니다. Head summary는 canonical head data와 latest-record 존재만 증명하며 full-chain validity에는 원본 same-process query witness와 상세 load가 필요합니다. Engine report parsing, 더 넓은 format/decode QA, assessment persistence, runtime-frame provenance, retention, historical migration, evidence command, export는 없습니다.

Godot, Unity, Unreal capability는 모두 `planned`입니다. `init`, `doctor`, `project inspect` availability는 control-plane command 상태이며 engine evidence가 아닙니다.

## 대상 사용자와 첫 결과

주요 사용자는 개인 또는 1~5인 팀입니다. 첫 완성 결과는 movement, camera, collision, collectible, HUD counter, save/load, restart, win state를 포함한 Windows x64 offline single-player 3D vertical slice입니다.

첫 alpha는 넓은 genre coverage, polished content generation, autonomous long-running development보다 reliable graybox production과 verification을 우선합니다.

## First-party engine 범위

| Engine | 현재 grade | 초기 구현 방향 | 계획 version family |
| --- | --- | --- | --- |
| Godot | `planned` | 첫 adapter와 complete graybox loop | 4.7.x |
| Unity | `planned` | 두 번째 adapter, official automation path 우선 | 6.3 LTS |
| Unreal Engine | `planned` | 세 번째 adapter, Editor와 build path 분리 | 5.8.x |

이 version family는 dated planning target이며 tested compatibility claim이 아닙니다. 각 adapter stage 전에 exact patch와 required module을 detect하고 pin합니다.

## 첫 alpha 포함 범위

- Project detection, identity, stage, target, budget inspection.
- Bounded feature workflow와 explicit completion contract.
- Compare-and-swap check와 rollback을 포함한 safe source/Editor mutation.
- Compile/import, nonzero test execution, runtime play, deterministic input, state assertion, log, capture, profiling, build/export receipt.
- Provenance와 QA를 가진 typed placeholder와 user-provided/licensed asset.
- Local evidence storage와 explicit evidence export.
- 첫 build target Windows x64와 지원 가능한 Linux static/headless CI.

이는 alpha scope commitment이며 current capability claim이 아닙니다.

## 유예 또는 선택 사항

- Local Blender와 local image/ML tool은 optional이며 자동 설치하지 않습니다.
- Hosted image-provider pack은 최대 하나만 enable할 수 있고 installation과 모든 external/paid call에 별도 승인이 필요합니다.
- 3D/audio generation은 later pack입니다.
- UI reconstruction과 balance simulation은 core engine loop 뒤에 진행합니다.
- Dashboard, desktop UI, macOS verification은 later milestone입니다.

## 첫 alpha 제외 범위

- Browser-first game framework와 추가 engine first-party 지원.
- Multiplayer와 online service orchestration.
- Mobile, console, XR, web export target.
- Cinematic/video generation.
- Engine, Editor, Blender, system-wide tool 자동 설치.
- Automatic publish, release, store submission, remote evidence upload.

## 준비 기준

구현 시작 전에 문서 gate 7개를 모두 승인했습니다. `0.1.0-alpha`에는 complete Godot golden loop, stable executable lifecycle/recovery, clean external installation, selected license, explicit release authority가 필요합니다. `1.0`에는 세 엔진의 required `verified` capability와 common packaged scenario 통과가 필요합니다.
