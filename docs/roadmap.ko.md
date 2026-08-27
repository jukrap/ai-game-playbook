---
source: docs/roadmap.md
source_sha256: 731989dd3dc22944e10d9f5a0973a7be06f9fd9d6513e16f508a6f80247de655
translated_at: 2026-08-27
---

# 로드맵

> 상태: 공통 기반과 Stage 2 안전 primitive를 구현하고 있습니다. 이후 단계, 날짜, availability는 약속이 아닙니다.

[English](roadmap.md) · [문서](README.ko.md)

## 현재 체크포인트

완료된 기반에는 versioned contract, strict registry validation, generated surface, deterministic workflow plan, canonical project/path handling, compare-and-swap filesystem operation, bounded process, project mutation lease, explicit host-tool inspection을 포함한 signed scoped permission admission, workflow checkpoint, durable private receipt record, bounded private receipt-head query, pure process/test result normalization, 제한된 retained-artifact assessment, recovery boundary가 있는 managed-pack transaction, project-bound read-only STDIO MCP runtime, shared read-only runtime을 둔 registry-derived project-inspection skill artifact 하나, write-free Codex project-configuration/skill-target planning이 포함됩니다.

현재 Stage 2 product slice에는 다음이 추가됐습니다.

- stable help, version, parsing, output, exit behavior를 가진 executable repository-local CLI;
- implemented command만 노출하는 exact runtime registry;
- `InitRequest`, `InitReport`, `DoctorRequest`, `DoctorReport`, `ProjectInspectRequest`, `ProjectInspectReport`, pack-list, pack-doctor, skill-list, skill-check, static engine-status/engine-capabilities schema;
- 고정된 project-local target 16개를 분류하는 write-free `agpb init`;
- runtime, registry, project state, installed-pack state, active marker를 검사하는 read-only `agpb doctor`;
- bounded engine marker, canonical profile compatibility, marker-only dirty state, unbound Editor signal을 검사하는 static read-only `agpb project inspect`;
- content 노출, repair, finalization 없이 bounded installed identity, ownership count, artifact/directory integrity, active recovery summary를 제공하는 read-only `agpb pack list`와 `agpb pack doctor`;
- bounded registry catalog와 materialization 없는 missing/current/conflicting/oversized/unsafe project-target observation을 제공하는 read-only `agpb skill list`와 `agpb skill check`;
- complete Godot project candidate 하나, `4.7.2` major/minor compatibility, explicit evidence gap을 보고하고 host executable path나 process launch를 허용하지 않는 static read-only `agpb engine status --engine godot`;
- compatible identity 하나에 공통 operation 14개를 모두 `planned`/`documented`로 유지하고 explicit containment gap을 보고하며 executable/provider input이나 process launch를 허용하지 않는 static read-only `agpb engine capabilities --engine godot`;
- project-only preparation, bounded exact source, signed single-use 승인, recursive search/process launch 없음, identity recheck, authority settlement, source-path 없는 result field를 가진 private Godot executable discovery;
- 원본 same-process discovery candidate만 받고 두 번째 exact 승인을 요구하며 bounded `--version` process 하나를 실행하고 support를 승격하지 않은 채 isolation gap을 보존하는 private Godot exact-version probe;
- exact runtime/registry authority, compare-and-swap head, redaction check, complete project-local artifact-locator 검증을 포함한 canonical append-only run-receipt persistence;
- 고정 entry/head/byte limit, explicit summary validation level, same-process detailed-load witness를 포함한 private whole-directory receipt-head query;
- complete artifact snapshot을 receipt가 증명하는 canonical manifest와 함께 immutable SHA-256 object로 승격하는 private promotion;
- bounded process와 structured test-report observation을 immutable component outcome으로 바꾸는 private fail-closed normalization;
- 보존된 UTF-8, canonical JSON, non-interlaced PNG와 선택적 current-registry asset-provenance evidence를 평가하는 private fail-closed assessment;
- exact project/schema binding 아래 explicit enabled generated read-only tool을 노출하는 private modern STDIO runtime;
- apply나 skill materialization 없이 deterministic Codex project configuration과 project-inspection skill target을 계획하고 create/retain/conflict를 검사하는 private 경계;
- compiled-handler digest attestation;
- generated/public availability parity.

이는 package를 installable하게 만들지 않으며 어떤 engine capability도 `planned`보다 높이지 않습니다.

## 남은 Stage 2 작업

다음 control-plane 작업은 다음과 같습니다.

1. 기존 write-plan-only `init` 뒤의 mutation을 explicit project-metadata authority, fresh plan validation, staged write, rollback에 결합합니다.
2. 기존 plan, approval, lane, CAS, journal, rollback 요구를 약화하지 않고 approved pack add/update/remove와 recovery finalization을 general dispatcher에 연결합니다.
3. Approval interaction과 stable error envelope를 추가한 뒤 command deadline과 settlement를 durable receipt store에 연결합니다.
4. Executable surface에서 clean install, reinstall, update, conflict, interruption, rollback, recovery, uninstall을 검증합니다.

Private library function이 있다는 이유만으로 command를 available로 표시하지 않습니다.

## Stage 3 — evidence, MCP, Codex integration

Process/test normalization, 제한된 artifact assessment, bounded private receipt-head discovery, explicit read-only STDIO MCP runtime, registry-derived project-inspection skill artifact 하나, public read-only pack list/doctor와 skill list/check command, static Godot status/capability command, private Godot executable discovery/exact-version probe, plan-only Codex project-configuration/skill-target 기반은 구현했습니다. 더 넓은 engine process/report parser, required-test selection, gameplay/capture/performance/build normalizer, 더 넓은 artifact format, runtime-frame provenance, assessment persistence, runtime-to-receipt integration은 계획 단계입니다. 그 밖에 filtered/persistent evidence indexing, receipt-history migration/forensic access, checkpoint/handoff reconciliation, reachable-head retention cleanup, explicit evidence list/show/export command, 승인된 Codex configuration/skill materialization, approved mutating skill lifecycle을 계획합니다.

CLI, MCP, 문서, skill routing은 동일한 command ID, schema digest, permission, handler identity를 유지해야 합니다. MCP annotation은 hint이며 permission broker를 override할 수 없습니다. Background upload나 telemetry path는 계획하지 않습니다.

## Stage 4 — Godot alpha

Godot에는 첫 static status/capability adapter, private executable identity/version 경계, fail-closed headless-preflight admission이 생겼고 첫 live engine adapter 계획 대상인 점은 그대로입니다. 다음 engine checkpoint는 validated containment provider와 retained receipt를 포함한 실제 permission-bound preflight run이며 실제 Godot executable을 목격하기 전에는 support를 승격하지 않습니다. 이후 공통 3D graybox에서 movement, camera, collision, collectible, HUD count, process restart를 포함한 save/load, failure/restart 처리, win state, actual runtime frame, Windows export, exported-player startup을 증명해야 합니다.

Required Godot capability가 `verified`에 도달하고 pack lifecycle/recovery가 안정화되며 clean external installation, license, release authority가 해결된 뒤에만 `0.1.0-alpha`를 허용합니다. 그 시점에도 Unity와 Unreal은 planned입니다.

## Stage 5 — Unity

Unity 작업은 official command-line/automation path, exact Editor/project identity, EditMode/PlayMode report, domain-reload reconciliation, actual Game View evidence, Windows x64 Development Build, packaged startup을 우선합니다. Community fallback은 선택 사항이며 같은 authentication, schema, identity, timeout, output, recovery, evidence gate를 통과해야 합니다.

## Stage 6 — Unreal

Unreal 작업은 headless path에 UBT/UAT와 commandlet을 사용하고 editor-bound 작업에는 constrained Editor operation을 사용합니다. PIE, Editor viewport, Automation, cook/package, packaged execution evidence를 구분합니다. Global process termination, active worktree switch, broad asset deletion, unbounded arbitrary Python은 허용 경계 밖입니다.

## Stage 7 — 안정화와 1.0

`1.0`은 세 엔진이 required verified capability에 도달하고 common Windows x64 packaged scenario, stable install/update/recovery/uninstall, schema/pack migration, behavior eval, current live-engine evidence, release provenance를 통과하며 unresolved critical security/license blocker가 없어야 합니다.

## 후속 확장

UI reconstruction, deterministic balance simulation, optional Blender QA, hosted image-provider pack 최대 하나는 core loop 뒤에 진행합니다. Dashboard/desktop UI, 3D/audio generation, macOS validation은 이후 작업입니다. 추가 engine은 public adapter contract 뒤의 community pack으로 둡니다.

## 릴리스 규칙

- 이 단계에서 저장소는 private package/`UNLICENSED` 상태이며 npm에 publish하지 않습니다.
- Source-built command는 release가 아닙니다.
- Engine support는 roadmap 위치가 아니라 witnessed capability evidence를 따릅니다.
- Status claim을 바꾸기 전에 영문/한국어 공개 문서, generated surface, handler digest, test, Windows/Linux CI가 일치해야 합니다.
