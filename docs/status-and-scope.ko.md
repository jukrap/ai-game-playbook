---
source: docs/status-and-scope.md
source_sha256: 19c8ca027baf79882dd136a14ebeb8a74d127475b2a45efddf1169868103a113
translated_at: 2026-08-26
---

# 현재 상태와 범위

> 상태: 2026-08-26에 검토한 Stage 2 control plane 안전 경계 구현 단계입니다.

[English](status-and-scope.md) · [문서](README.ko.md)

## 현재 저장소 상태

현재 저장소에는 private pnpm/TypeScript workspace, versioned contract schema, semantic validator, typed registry 검증 및 projection, 결정적인 resolved workflow-plan attestation, digest 결합 foundation plan, test, Windows/Linux CI 설정, 초기 private core package와 private managed-pack runtime이 있습니다. resolved plan은 exact registry, workflow descriptor, project stage, input/output schema, 위상 정렬된 step, command와 handler digest, lane, permission, budget, failure transition, terminal oracle, evidence duty를 결합합니다. 구현된 filesystem 경계는 canonical project root를 결합하고 identity를 확인하는 멱등 bootstrap으로 고정 runtime directory 6개를 생성하며 writable link를 따라가지 않으면서 portable project path를 해석하고 directory 검사와 파일 크기를 제한합니다. 또한 precondition, drift, 결과 불확실성 보고를 갖춘 SHA-256 compare-and-swap 쓰기 또는 exact-digest 단일 파일 삭제를 stage합니다. process 경계는 local executable identity와 digest를 결합하고 direct argument-array spawn을 사용하며 environment 권한, working directory, time, idle time, output을 제한합니다. cancellation 또는 budget 초과 시 owned process tree를 종료하며, 종료가 확인돼도 중단된 실행은 mutation-uncertain으로 유지합니다. mutating-lane 경계는 고정된 local lock, root/project digest, run/runtime identity, 명시적 lease 갱신, 제한된 대기와 cancellation, dead-owner-only stale recovery를 사용합니다. permission 경계는 등록 command payload와 project/feature/workflow/session binding을 검증하고 중첩된 execution-budget ceiling을 적용하며 exact Ed25519 approval grant를 검증해 memory에서 원자적으로 소비하고, 성공을 수용하기 전에 보고된 effect를 승인 scope와 비교합니다. workflow 경계는 exact plan을 다시 해석하고 immutable authorization/dispatch/settlement/rollback transition을 기록하며 canonical append-only checkpoint chain을 compare-and-swap head 뒤에 영속화합니다. 제한된 loader는 모든 parent transition과 현재 run authority를 검증하고, safe restart hydration은 dispatch 전 step에 재승인을 요구하며 dispatch 후 정산하지 못한 step을 `uncertain`으로 표시합니다. pack preflight는 offline regular-file content, canonical installed state, dependency, ownership, downgrade policy, conflict를 검증하고 쓰기 없는 같은 process의 immutable plan을 만듭니다. pack 전용 executor는 해당 exact plan, broker가 발급한 install 승인, attest된 project-write lane을 모두 요구하며 started record 전 exact active marker를 영속화하고 terminal record를 기록하며 compare-and-swap으로 artifact와 canonical installed state를 반영합니다. 명시된 artifact 직접 부모는 absent일 때만 pack digest 결합 ownership marker와 함께 생성하고, 기존 directory는 shared로 유지하며, update에서 exact identity를 보존하고 remove에서 reversible same-parent tombstone을 사용합니다. 명확한 부분 실패는 역순 rollback하고 불확실하지 않은 terminal 뒤에만 marker를 지웁니다. 남은 marker나 tombstone uncertainty는 이후 plan을 차단합니다. 제한된 read-only inspector는 journal의 preimage와 postimage에 대해 관찰을 두 번 비교하고 안전한 finalization 후보, mixed, unstable, unreadable 또는 contradictory state를 변경 없이 attest합니다. 별도 private finalizer는 새 exact 승인과 일치하는 project-write lane을 요구하고 각 closure 경계 전에 다시 검사하며 exact empty detached tombstone만 정리할 수 있고, 누락된 journal closure 또는 reconciliation record만 append하며 state와 journal을 검증한 뒤에만 exact marker를 지웁니다. 해제 뒤 검증이 실패하면 marker를 복원하고 artifact를 repair·retry·rollback하지 않습니다. pack이 active registry에서 사라져도 installed-state 소유권을 기준으로 제거할 수 있습니다.

설치 가능한 package, `agpb` 실행 파일, MCP server runtime, Codex integration 파일, 통합 command dispatcher, approval UI 또는 durable approval store, 실행 가능한 managed-pack CLI나 recovery doctor, CPU 또는 memory sandbox, engine bridge, engine pack, 실행 가능한 golden project는 아직 없습니다. project-state bootstrap, managed directory lifecycle, pack recovery inspection, pack recovery finalization은 private library 함수이며 실행 가능한 command가 아닙니다. finalizer는 inspector가 이미 분류한 stable state만 닫을 수 있고 artifact repair, mixed state 해결, 일반 workflow나 engine mutation recovery는 할 수 없습니다. 현재 workflow와 pack runtime은 실행 가능한 제품이 아니라 private library입니다. permission admission은 pack executor/finalizer의 lane·filesystem CAS 경로에만 결합되어 있으며 일반 dispatcher, process 또는 engine 경로, dirty-state preimage, durable receipt body 또는 evidence payload, 일반 reconciliation action과는 아직 결합되지 않았습니다. project secret-path classifier와 typed Editor-object operation scope도 없으므로 Editor object source mutation은 닫혀 있습니다. lane runtime도 automatic heartbeat scheduling, parallel-reader coordination, foreign live process start의 독립적인 OS attestation, durable recovery receipt, 실제 Editor control을 제공하지 않습니다. [planned-surface.json](planned-surface.json)의 명령 목록과 생성된 [foundation plan](../generated/foundation-plan.json)은 설계 전용이며 어느 command 또는 engine capability도 `planned`보다 높이지 않습니다.

## 대상 사용자와 첫 결과물

주요 사용자는 개인 또는 1~5인 개발팀입니다. 첫 완성 결과물은 movement, camera, collision, collectible, HUD counter, save/load, restart, win state를 갖춘 Windows x64용 오프라인 싱글플레이 3D vertical slice입니다.

첫 alpha는 폭넓은 장르 지원, 완성도 높은 콘텐츠 생성, 장시간 자율 개발보다 안정적인 graybox 제작과 검증을 우선합니다.

## First-party 엔진 범위

| 엔진 | 현재 등급 | 초기 구현 방향 | 계획 버전군 |
| --- | --- | --- | --- |
| Godot | `planned` | 첫 adapter와 완전한 graybox loop | 4.7.x |
| Unity | `planned` | 두 번째 adapter, 공식 자동화 경로 우선 | 6.3 LTS |
| Unreal Engine | `planned` | 세 번째 adapter, Editor와 build 경로 분리 | 5.8.x |

버전군은 날짜가 있는 계획 목표이지 테스트된 호환성 주장이 아닙니다. 구현을 시작하기 전에 exact patch와 필수 module을 다시 탐지하고 pin합니다.

## 첫 alpha에 포함

- 프로젝트 탐지와 identity, stage, target, budget 검사.
- 범위가 제한된 feature workflow와 명시적 완료 계약.
- compare-and-swap 검사와 rollback을 포함한 안전한 source 및 Editor mutation.
- compile/import, 0건이 아닌 test 실행, runtime play, 결정적 입력, state assertion, log, capture, profile, build/export receipt.
- typed placeholder와 provenance·QA를 갖춘 사용자 제공 또는 licensed asset.
- 로컬 evidence 저장과 명시적 evidence export.
- Windows x64 첫 build target과 지원 가능한 Linux static/headless CI.

## 연기 또는 선택 사항

- 로컬 Blender와 image/ML tool은 선택 사항이며 자동 설치하지 않습니다.
- hosted image-provider pack은 최대 하나만 활성화할 수 있고 설치 및 각 외부·유료 호출을 따로 승인합니다.
- 3D와 audio generation은 후속 pack입니다.
- UI reconstruction과 balance simulation은 핵심 엔진 loop 이후입니다.
- dashboard, desktop UI, macOS 검증은 후속 milestone입니다.

## 첫 alpha 범위 밖

- browser-first 게임 프레임워크와 추가 엔진의 first-party 지원.
- multiplayer와 online service orchestration.
- mobile, console, XR, web export target.
- cinematic 또는 video generation.
- engine, Editor, Blender, system-wide tool 자동 설치.
- 자동 publish, release, store submission, 원격 evidence upload.

## 준비 조건

7개 문서 gate를 모두 승인한 뒤 Stage 1 구현을 시작했습니다. `0.1.0-alpha`는 여전히 Godot golden loop 전체가 end-to-end로 통과해야 합니다. `1.0`은 세 엔진이 모두 `verified`에 도달하고 설치 생명주기, 복구, behavior evaluation이 안정화되어야 합니다.
