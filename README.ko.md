---
source: README.md
source_sha256: 0699c97ad91cc5419377b266d36fa3b4ec436ff839c5f5a385738fb652b119ec
translated_at: 2026-08-26
---

# AI Game Playbook

> 상태: control plane 계약, registry, 초기 core 안전 경계와 private managed-pack transaction runtime을 구현하는 단계입니다. 설치 가능한 패키지, `agpb` 실행 파일, MCP 서버, 엔진 어댑터는 아직 없습니다.

[English](README.md)

AI Game Playbook은 Godot, Unity 또는 Unreal Engine으로 게임을 만드는 소규모 팀을 위한 AI 보조 게임 개발 하네스입니다. 코드 생성만이 아니라 범위가 제한된 워크플로, 명시적 권한, 재현 가능한 증거, 실제 엔진 동작을 중심으로 설계하고 있습니다.

## 현재 존재하는 것

- versioned 공개 schema와 semantic validation을 포함한 pnpm/TypeScript workspace.
- command, skill, workflow, role lens, schema, pack descriptor를 검증하고 범위가 제한된 설계 projection을 생성하며 exact command authority에 결합된 결정적 workflow plan을 해석하는 typed registry.
- canonical project root 결합, 고정 레이아웃 project-state bootstrap, portable path 해석, bounded file snapshot, staged SHA-256 compare-and-swap 쓰기와 단일 파일 삭제, digest 결합 direct process 실행, 초기화된 project마다 root/project에 결합된 mutating lease 하나, registry 결합 permission admission과 서명된 scoped grant, resolved-plan state machine, durable append-only checkpoint store를 제공하는 초기 private core package.
- 검증된 offline·hook-free regular-file pack을 immutable plan으로 준비하고, 명시적으로 승인된 plan만 attest된 project lane, compare-and-swap file operation, canonical installed state, append-only transaction record를 통해 적용하는 private `pack-runtime`.
- 의도한 command 및 skill surface를 담은 digest 결합 추적 계획.
- 영어 문서와 한국어 미러.
- contract, 생성 계획 drift, 문서 정합성을 검사하는 cross-platform static check.

이 기반은 개발용 library와 검사이며 사용 가능한 제품이 아닙니다. private state machine은 immutable hash-linked checkpoint를 만들고 authorization과 dispatch를 분리하며 exact run receipt와 보고된 effect를 정산하고 선언된 failure 또는 rollback transition을 진행하며 uncertainty나 누적 budget 초과에서 중단합니다. checkpoint record는 이제 canonical append-only file과 compare-and-swap head로 유지되며, load할 때 제한된 전체 chain과 exact project/workflow authority를 다시 검증합니다. restart recovery는 사용하지 않은 authorization을 버리고 재승인을 요구하며 dispatch 경계를 넘은 step은 `uncertain`으로 전환합니다. 별도의 제한된 bootstrap은 구현된 primitive가 요구하는 lock, workflow state, pack state의 고정 디렉터리 6개만 생성합니다. 재실행해도 안전하며 link와 대소문자 alias를 거부하고, 명확히 실패한 호출이 직접 만든 디렉터리만 제거합니다. pack preflight는 계속 write-free입니다. 별도 private executor는 같은 process의 plan, broker가 발급한 install authorization, attest된 `project-write` lease만 받고 local add, update, installed-state 소유권 기반 remove를 수행합니다. started/terminal transaction을 기록하고 실제 effect를 정산하며 뒤 파일의 명확한 실패가 발생하면 이미 commit한 파일을 rollback합니다. started record 전에는 기대 post-state와 고정 관찰 budget을 담은 canonical active marker 하나를 쓰고, 불확실하지 않게 끝난 terminal 뒤에는 exact digest로 marker를 지웁니다. marker가 남아 있으면 새 pack plan을 중단합니다. 읽기 전용 recovery inspector는 제한된 snapshot을 두 번 취해 일치하는 preimage, postimage, mixed state, terminal drift와 marker-only crash window를 구분합니다. 안정적이고 일치하는 report에 대해서만 별도 private finalizer가 같은 process의 digest 결합 plan, broker가 새로 발급한 install 승인, attest된 `project-write` lease를 요구합니다. 쓰기 전 다시 검사하고 누락된 journal closure 또는 별도 reconciliation record를 append할 수 있으며, marker를 지우기 전에 exact journal과 state를 확인하고 해제 뒤 검증이 실패하면 marker를 복원합니다. pack artifact를 repair·retry·rollback하지 않고 stale, mixed, unstable, unreadable, contradictory 또는 foreign-marker state를 거부합니다. executor와 finalizer는 pack artifact parent directory를 만들거나 approval·lane을 직접 얻지 않으며 CLI도 노출하지 않습니다. approval reservation과 active lease는 여전히 memory에만 있고 이 primitive를 호출하는 dispatcher나 approval UI도 없습니다. lane primitive도 초기화된 local project state와 명시적 갱신이 필요하며 parallel reader를 조정하거나 Editor를 제어하지 않습니다. CPU와 memory sandbox도 아직 없습니다. 현재 저장소는 설치 가능한 npm 패키지나 동작하는 게임 엔진 자동화를 제공하지 않습니다. 문서의 명령은 인터페이스 계획이며 지금 실행할 수 있는 명령이 아닙니다.

## 제품 방향

첫 제품 목표는 개인 또는 최대 5인 팀이 만드는 Windows x64용 오프라인 싱글플레이 3D vertical slice입니다. 의도한 흐름은 다음과 같습니다.

1. 프로젝트를 검사하고 사용 가능한 엔진 capability를 협상합니다.
2. 범위가 제한된 feature contract와 권한 예산을 정의합니다.
3. 프로젝트 단위 실행 lane 하나에서 소스 또는 Editor 상태를 변경합니다.
4. compile/import, test, play, 결정적 입력 재생, 실제 runtime 증거 캡처를 수행합니다.
5. build/export하고 receipt를 기록하며 필요하면 안전하게 rollback합니다.

Godot, Unity, Unreal Engine만 계획된 first-party 엔진입니다. 웹 게임 프레임워크, 멀티플레이어, 모바일, 콘솔, XR, macOS 검증은 첫 alpha 범위 밖입니다.

## 설계 약속

- 하나의 typed registry가 command 및 skill descriptor를 정의하고 현재 설계 projection을 생성합니다. 향후 CLI, MCP, 도움말, host integration도 동일하게 검증된 authority metadata를 사용해야 합니다.
- 지원하지 않는 capability는 명시적으로 degrade해야 하며 낮은 등급의 증거를 `verified`로 표시할 수 없습니다.
- Editor mutation은 프로젝트별로 직렬화하며 identity 또는 dirty file 상태가 모호해지면 중단합니다.
- 설치, 네트워크, 외부 전송, 유료 호출, 파괴 작업, publish에는 별도 승인이 필요합니다.
- telemetry는 계획하지 않습니다. 증거는 명시적인 export 작업을 통해서만 로컬 프로젝트 밖으로 나갑니다.
- 엔진과 콘텐츠 제작 애플리케이션은 탐지하지만 자동 설치하지 않습니다.

## 설계 문서 읽기

- [문서 색인](docs/README.ko.md)
- [현재 상태와 범위](docs/status-and-scope.ko.md)
- [핵심 개념과 공개 타입](docs/concepts.ko.md)
- [계획된 명령줄 인터페이스](docs/planned-cli.ko.md)
- [목표 아키텍처](docs/architecture.ko.md)
- [엔진 지원 모델](docs/engine-support.ko.md)
- [보안과 권한](docs/security-and-permissions.ko.md)
- [자산과 provenance](docs/assets-and-provenance.ko.md)
- [증거와 검증](docs/evidence-and-verification.ko.md)
- [로드맵](docs/roadmap.ko.md)

## 설치

아직 설치할 수 없습니다. 이 프로젝트로 생각하고 비슷한 이름의 패키지를 설치하지 마세요. 문서 게이트가 승인되고 실제 패키지가 clean install, update, rollback, conflict, uninstall 테스트를 통과한 뒤에만 설치 안내를 추가합니다.

## 프로젝트 상태와 라이선스

구현 과정에서 인터페이스가 바뀔 수 있습니다. 프로젝트 라이선스는 아직 선택하지 않았으므로 라이선스 파일이 추가되기 전에는 재배포 권리를 가정하지 마세요. 이 결정 전에는 release나 package publish를 진행하지 않습니다.
