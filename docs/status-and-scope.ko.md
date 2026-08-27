---
source: docs/status-and-scope.md
source_sha256: 43b1a3aac42a84b360491a9d7f48442038ef2dc0ccaec56c73119cda6a21ee76
translated_at: 2026-08-27
---

# 현재 상태와 범위

> 상태: 2026-08-27에 검토한 Stage 2 control-plane 구현 단계입니다. Bounded pack inspection을 포함한 source-built write-free command 아홉 개, strict provider/self-test protocol과 empty compiled catalog가 있는 closed-world process-containment assessment, static Godot status/capability adapter, internal permission-bound Godot executable discovery와 version probe, assessment에 결합된 blocked receipt를 보존하는 fail-closed headless-preflight admission, explicit read-only STDIO MCP runtime이 존재하며 Codex setup은 plan-only이고 live-engine 지원은 planned입니다.

[English](status-and-scope.md) · [문서](README.ko.md)

## 현재 저장소 상태

저장소에는 private pnpm/TypeScript workspace, versioned schema, semantic validator, typed registry validation/generation, deterministic workflow-plan attestation, implemented command용 runtime registry, digest 결합 공개 surface, test, Windows/Linux CI, fail-closed containment assessment와 immutable empty compiled provider catalog가 있는 초기 core package, private evidence package, managed-pack/skill runtime, internal permission-bound executable discovery, exact-version process, assessment 결합 fail-closed headless-preflight 경계가 있는 static Godot status/capability adapter, experimental CLI package, experimental MCP package, plan-only Codex adapter package가 있습니다.

구현된 core 경계는 다음을 포함합니다.

- writable link traversal 없는 canonical project-root binding과 portable path resolution;
- bounded deterministic root-entry/directory/file inspection;
- staged SHA-256 compare-and-swap write, delete, reversible empty-directory removal;
- environment, working directory, time, idle, output을 제한하는 digest-bound direct process execution;
- exact root 하나와 고정 project-write/network/child-process denial policy에 결합된 path-free process-containment assessment, 빈 closed provider catalog, immutable `block` report, same-process witness 검사;
- implementation, catalog, host, challenge, fixture, timing, ordered negative probe, effect, derived outcome을 launch authority 없이 결합하는 strict path-free provider descriptor와 bounded self-test request/report schema;
- bounded waiting과 dead-owner-only recovery를 가진 root/project 결합 mutation lease 하나;
- schema-bound permission admission, exact scoped signed grant, effect settlement;
- deterministic workflow-plan resolution과 immutable state transition;
- restart classification을 포함한 canonical append-only checkpoint chain;
- compare-and-swap head, exact authority binding, redaction check를 포함한 canonical append-only run-receipt record;
- canonical filename check, latest-record 존재, same-process load witness, 고정 entry/head/byte limit을 포함한 bounded whole-directory receipt-head query;
- complete project-local artifact snapshot을 receipt가 증명하는 manifest와 함께 immutable SHA-256 object로 승격하는 private promotion;
- raw process output을 복사하지 않고 bounded process와 structured test-report observation을 fail-closed로 정규화하는 경계;
- project-only preparation, exact bounded source selection, signed single-use `host-tool-inspection` 승인, recursion/process launch 없음, scan 후 identity check, effect settlement, source-path 없는 result field를 가진 internal Godot executable-discovery 경계;
- 원본 same-process discovery candidate만 받고 exact executable digest에 결합된 두 번째 signed single-use 승인을 요구하며 고정 process-tree/time/idle/output limit, 실행 후 identity check, effect settlement, raw path/output 없는 result field, 명시적 `not-enforced` filesystem/network isolation을 가진 internal Godot `--version` executor;
- 원본 completed version report만 받고 exact project/executable/workflow/invocation identity와 core가 만든 containment assessment를 세 번째 signed approval에 bind하며 admission 직전에 원본 witness를 다시 확인하고 project process를 한 번도 시작하지 않은 채 digest 결합 canonical blocked receipt를 보존하는 internal Godot headless-preflight admission;
- raw content를 출력하지 않으면서 보존된 UTF-8, canonical JSON 또는 non-interlaced PNG artifact 하나와 선택적 current-registry `AssetProvenance` 일치를 fail-closed로 평가하는 경계;
- exact project binding, host-disclosure acknowledgement, schema validation, bounded message, canonical result를 포함해 explicit generated read-only tool subset을 modern STDIO로 등록하는 경계;
- 적격한 static Godot capability routing을 포함해 filesystem mutation 없이 machine-specific local-only Codex project MCP configuration 하나와 registry-derived project-inspection skill target 하나를 deterministic하게 계획하고 검사하는 경계.

Private pack runtime은 write-free preflight, canonical installed state, exact dependency/ownership, local add/update/remove transaction, active marker, append-only journal, compare-and-swap promotion, clear-failure rollback, marker-bound direct-parent directory ownership, reversible tombstone, bounded recovery inspection, 별도 승인 stable-state finalization을 구현합니다.

Source-built `agpb` executable은 현재 plan-only `init`, read-only `doctor`, static `project inspect`, `pack list`, `pack doctor`, `skill list`, `skill check`, static read-only `engine status --engine godot`와 `engine capabilities --engine godot`를 노출합니다. `init`은 고정된 project-local target 16개를 분류해 identity-bound `InitReport`를 출력하지만 plan을 apply할 수 없습니다. `doctor`는 runtime-registry parity, 지원 Node.js 범위, canonical project root 하나, fixed runtime layout, installed-pack-state validity, active transaction marker를 검사합니다. `project inspect`는 bounded Godot/Unity/Unreal marker candidate, canonical profile validity/compatibility, marker-only dirty-state knowledge, unbound static Editor signal을 보고합니다. `pack list`는 artifact content/path/source location 없이 bounded installed identity와 ownership count를 보고합니다. `pack doctor`는 repair, marker clear, finalization 없이 bounded artifact/directory ownership과 active recovery state를 검증합니다. `skill list`는 artifact body나 absolute source path 없이 bounded registry catalog를 반환합니다. `skill check`는 packaged skill identity를 다시 검증하고 materialization 없이 missing, current, conflicting, oversized, unsafe project target을 보고합니다. `engine status`는 complete Godot candidate 하나를 요구하고 version hint를 pin된 `4.7.2` target과 비교하며 executable/live-engine evidence 누락을 attention gap으로 보존합니다. `engine capabilities`는 같은 status 경계를 재사용하고 compatible하고 모호하지 않은 Godot identity에만 공통 operation 14개를 explicit limitation, permission, evidence duty, unavailable containment launch와 함께 모두 `planned`/`documented`로 반환합니다. 아홉 명령 모두 registered report에서 human 또는 canonical JSON output을 만들며 write를 수행하지 않습니다.

Source-built MCP runtime은 startup에서 generated registry surface로부터 명시적으로 선택한 tool name만 노출합니다. 현재 tool은 bounded pack inspection과 project-only Godot status/capabilities를 포함한 같은 write-free command 아홉 개이며 mutation, repair, recovery finalization, network, executable/provider input, engine process execution, evidence export, arbitrary handler execution을 노출하지 않습니다. Runtime registry는 bounded `project.inspection` skill 하나를 static inspection과, Godot observation이 적격할 때만 static capability report로 route합니다. Shared skill runtime이 packaged artifact를 검증하고 CLI, MCP, Codex setup에 같은 catalog와 target observation을 제공합니다. Codex adapter는 현재 Node.js와 MCP entry identity를 자체 결정하고 prompt-mode project configuration과 deterministic project-skill byte를 render한 뒤 각 target을 absent, exact, conflicting, oversized, linked, case-aliased로 분류합니다. 어느 target도 write하지 않고 기존 file을 merge하거나 project를 trusted로 바꾸거나 skill을 설치하지 않습니다.

## 사용할 수 없는 것

Installable/published package, 지원되는 MCP/Codex setup command, configuration apply path, materialized project skill, general command dispatcher, approval UI, durable approval store, evidence CLI/export path, 공개 executable discovery/version probe/headless preflight, containment self-test runner, 등록된 containment provider, launch handle, mutating pack CLI, recovery-finalization command, CPU/memory/filesystem/network/child-process sandbox, engine bridge, engine pack, live-engine automation, playable golden project는 없습니다.

Mutating initialization, pack add/update/remove와 recovery finalization, `skill install`, MCP/Codex configuration apply, project-skill materialization, live capability negotiation, `engine connect`, engine-backed operation, workflow execution, verification, evidence command, documentation command integration은 planned입니다. Private library function은 public command가 아니며 runtime registry도 이러한 planned operation을 노출하지 않습니다.

Project-state bootstrap, artifact promotion, receipt persistence와 bounded head query, component result normalization, retained-artifact assessment, process-containment assessment, pack mutation, recovery inspection, recovery finalization, permission-bound executable discovery, permission-bound Godot exact-version process, workflow-bound headless-preflight admission은 private API입니다. 현재 `init`은 layout intent와 conflict를 보고할 수 있지만 profile, policy, ignore, runtime-state byte를 만들 수 없습니다. 현재 doctor는 unsafe state를 식별할 수 있지만 initialize, repair, clear, recovery classify, finalize할 수 없습니다. Project inspection과 두 public Godot engine command는 Git 실행, executable discovery, process 열거, Editor liveness/session identity 확립, stage evidence content 검증, engine 연결, engine support grade 승격을 수행하지 않습니다. 공개 request는 host executable, containment provider, self-test, launch path를 선택할 수 없습니다. Private discovery는 승인한 exact source만 검사하고 recursive search나 process launch를 수행하지 않으며 source path나 execution authority를 반환하지 않습니다. Private version executor는 그 원본 same-process selected report만 받고 별도 process authority를 요구하며 headless project validation, Editor connection, runtime verification이 아닙니다. 현재 preflight 경계는 exact same-process containment witness를 얻어 다시 검사하지만 provider catalog가 비어 있어 assessment가 `block`만 반환합니다. Project process를 시작하지 않고 engine evidence가 되지 않으며 assessment는 CPU, memory, filesystem, network, child-process sandbox가 아닙니다. 실제 Godot binary를 목격하지 않았습니다. Workflow runtime은 general dispatch와 연결되지 않았습니다. Durable receipt JSON, bounded head summary, bounded content-addressed artifact byte, pure process/test outcome normalization, 제한된 Godot version-output parsing, 제한된 UTF-8/canonical-JSON/non-interlaced-PNG 및 provenance assessment는 존재합니다. Head summary는 canonical head data와 latest-record 존재만 증명하며 full-chain validity에는 원본 same-process query witness와 상세 load가 필요합니다. 더 넓은 engine process/report parsing, 더 넓은 format/decode QA, assessment persistence, runtime-frame provenance, retention, historical migration, evidence command, export는 없습니다.

Godot, Unity, Unreal live-engine support grade는 모두 `planned`입니다. `init`, `doctor`, `project inspect`, `pack list`, `pack doctor`, `skill list`, `skill check`, static `engine status`, static `engine capabilities` availability는 control-plane command 상태이며 engine execution evidence가 아닙니다.

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
