---
source: docs/roadmap.md
source_sha256: 890da8948e46d14a661a315598caffca85596070ee2b4ae114e640907bf090fa
translated_at: 2026-08-26
---

# 로드맵

> 상태: 공통 기반과 Stage 2 안전 primitive를 구현하고 있습니다. 후속 단계, 일정, 제공 시점은 약속하지 않습니다.

[English](roadmap.md) · [문서](README.ko.md)

## Gate 0: 문서 승인 — 완료

제품 구현을 시작하기 전에 저장소/설치 생명주기, 명령 및 메모리 orchestration, 세 엔진 각각, 게임 제작과 asset, 통합 공개 설계를 다루는 7개 문서 gate를 검토하고 승인했습니다.

승인은 초기 contract, risk, permission default, evidence threshold, golden task, release scope를 동결합니다. 검토 결과 gate를 수정 단계로 되돌릴 수 있습니다. 설계 완료만으로 제품 release가 생기지 않습니다.

## Stage 1: 공통 기반 — 진행 중

- 완료: pnpm workspace, versioned contract schema, semantic validation, typed registry 검증 및 projection, pack dependency graph 검증, 결정적 resolved workflow-plan attestation, 추적 가능한 digest 결합 foundation plan, 고정 레이아웃 project-state bootstrap, marker 결합 artifact-parent lifecycle·active barrier·read-only recovery 분류·승인/lane 결합 recovery closure를 갖춘 private managed-pack preflight와 transaction executor.
- 남음: core runtime, 실행 가능한 CLI, MCP server, Codex adapter, runtime parity generation.
- 남음: 실행 가능한 pack CLI와 registry parity, recovery doctor와 dispatcher 통합, 더 넓은 lifecycle evaluation, pack distribution. 고정 runtime directory bootstrap과 local approval/lane 결합 add, update, installed-state 소유권 기반 remove, marker 결합 missing-parent 생성과 reversible remove, active-marker blocking, journal, read-only recovery inspection, stable-state finalization, 명확한 실패의 rollback, conflict 검사는 private library primitive로 구현했습니다.
- package는 private으로 유지하고 publish를 별도로 승인하기 전까지 `ai-game-playbook`과 `agpb`를 예약된 interface 이름으로만 사용합니다.

## Stage 2: 실행, 증거, 안전

- 구현된 primitive: compare-and-swap write와 단일 파일 삭제, canonical project-root identity, 고정 project-state bootstrap, identity 결합 directory 생성과 reversible remove, bounded direct process 실행, 직렬화된 root/project 결합 mutating lease, exact signed grant와 effect settlement를 사용하는 in-memory registry 결합 permission admission, receipt chain·rollback·evidence·누적 budget을 강제하는 immutable resolved-plan checkpoint transition, 제한된 chain 검증과 restart-safe hydration을 포함한 append-only checkpoint 영속화, immutable local pack plan, marker 결합 artifact-parent lifecycle·active marker·append-only started/terminal/reconciliation record·제한된 역순 rollback·two-pass read-only recovery observation·별도 승인된 stable-state closure를 갖춘 authorization/lane 결합 transaction executor.
- 남음: durable approval/receipt/evidence storage, 일반 workflow uncertainty reconciliation, 일반 workflow dispatcher 통합, 완전한 project/Editor identity attestation, automatic lease heartbeat integration, parallel-read coordination.
- 현재 bounded state machine을 중심으로 repair/retry와 cancellation transition, dispatcher 소유 checkpoint 영속화, receipt/evidence storage, 명시적 reconciliation을 완성합니다.
- content-addressed receipt, evidence storage, redacted diagnostic, retention, explicit export를 추가합니다.
- traversal, symlink escape, invalid token, output growth, timeout, stale process, ambiguous Editor, install lifecycle conflict를 테스트합니다.

## Stage 3: Godot adapter와 첫 alpha

- movement, camera, collision, collectible, HUD, save/load, restart, win state를 갖춘 공통 3D graybox를 만듭니다.
- detect, inspect, change, save, script validation, test, run, deterministic input, gameplay state, runtime capture, log, recovery, Windows export startup을 검증합니다.
- Godot 전체 loop와 package lifecycle이 통과한 뒤에만 `0.1.0-alpha`를 publish합니다. 이 시점에도 Unity와 Unreal은 `planned`입니다.

## Stage 4: Unity adapter

- 공식 automation path를 먼저 구현하고 hard gate를 통과한 fallback만 허용합니다.
- EditMode/PlayMode test, domain-reload recovery, 실제 Game View evidence, Windows x64 Development Build startup을 포함해 graybox를 재현합니다.
- 개별 Unity capability는 목격한 가장 강한 등급까지만 올립니다.

## Stage 5: Unreal adapter

- exact session identity와 transaction을 갖춘 공식 MCP, Editor Python, Automation, UAT, UBT 경로를 구현합니다.
- Blueprint와 C++ 흐름에서 graybox를 재현합니다.
- PIE gameplay를 packaged startup과 분리해 검증하고 cook/package, rollback, asset/actor recovery를 확인합니다.

## Stage 6: 선택적 확장

- UI reconstruction, balance simulation, Blender QA, optional hosted image-provider pack 하나를 추가합니다.
- CLI workflow가 안정화된 뒤 dashboard와 desktop UI 필요성을 평가합니다.
- 3D/audio generation, macOS validation, 추가 distribution target은 후속 작업으로 둡니다.

## Release 기준

`0.1.0-alpha`에는 Godot golden loop, safe installation lifecycle, bounded recovery, behavior evaluation이 필요합니다. 후속 pre-release는 한 번에 하나의 verified engine을 추가하고 나머지의 상태를 과장하지 않습니다.

`1.0`은 Godot, Unity, Unreal의 required capability가 모두 `verified`이고 clean install, reinstall, update, user-conflict, rollback, uninstall이 안정화되며 behavior evaluation이 permission/interruption path를 다루고 두 언어의 공개 문서가 생성된 runtime surface와 일치할 때만 허용합니다.

## 지속적인 non-goal

로드맵은 engine 자동 설치, telemetry, 승인하지 않은 network access, autonomous publish, broad process control, unbounded repair loop를 허가하지 않습니다. 새 엔진은 first-party scope를 조용히 확장하는 대신 공개 adapter contract를 통한 community pack으로 들어옵니다.
