---
source: docs/roadmap.md
source_sha256: 9f058ac517a2e2e6978de794a489c2f1dfce45dc5b8ac395facf61bc98b77425
translated_at: 2026-08-26
---

# 로드맵

> 상태: 계획된 순서입니다. 일정과 제공 시점을 약속하지 않습니다.

[English](roadmap.md) · [문서](README.ko.md)

## Gate 0: 문서 승인

제품을 구현하기 전에 저장소/설치 생명주기, 명령 및 메모리 orchestration, 세 엔진 각각, 게임 제작과 asset, 통합 공개 설계를 다루는 7개 문서 gate를 검토하고 승인합니다.

승인은 초기 contract, risk, permission default, evidence threshold, golden task, release scope를 동결합니다. 검토 결과 gate를 수정 단계로 되돌릴 수 있습니다. 설계 완료만으로 제품 release가 생기지 않습니다.

## Stage 1: 공통 기반

- pnpm workspace와 versioned contract package를 만듭니다.
- typed registry, generator, core runtime, CLI, MCP surface, Codex adapter를 구현합니다.
- digest-owned pack staging, install, update, conflict handling, rollback, uninstall을 구현합니다.
- publish가 승인된 뒤에만 npm package 이름 `ai-game-playbook`과 executable 이름 `agpb`를 사용합니다.

## Stage 2: 실행, 증거, 안전

- permission broker, compare-and-swap write, project/Editor identity, serialized mutation lane을 구현합니다.
- bounded workflow, checkpoint, resume validation, repair limit, cancellation, uncertainty handling을 추가합니다.
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
