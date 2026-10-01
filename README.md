<p align="center">
  <img src="docs/assets/agent-court-banner.svg" alt="Agent Court · 에이전트 조정" width="100%">
</p>

<h3 align="center">에이전트들은 어명을 받아라.</h3>

<p align="center">
  Claude Code와 Codex의 일상이, 조선의 조정으로.<br>
  내 코딩 에이전트가 무엇을 하는지 도트 지도에서 보는 개인용 로컬 대시보드입니다.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.0-a8282b?style=flat-square" alt="Version 0.2.0">
  <img src="https://img.shields.io/badge/Node.js-20%2B-4d665c?style=flat-square" alt="Node.js 20 이상">
  <img src="https://img.shields.io/badge/runtime_dependencies-0-b8892d?style=flat-square" alt="실행용 외부 npm 의존성 없음">
  <img src="https://img.shields.io/badge/runs-locally-3a2414?style=flat-square" alt="내 컴퓨터에서 실행">
</p>

<p align="center">
  <a href="#빠른-시작">빠른 시작</a> ·
  <a href="docs/START-HERE.md">설치 가이드</a> ·
  <a href="docs/USAGE.md">상세 사용법</a> ·
  <a href="https://github.com/Magiof/agent-court/issues">문제 제보</a>
</p>

![Agent Court에서 Claude Code와 Codex의 가상 세션을 함께 표시한 화면](docs/assets/agent-court-demo.jpg)

<p align="center"><sub>가상 데모 세션으로 촬영한 실제 앱 화면입니다.</sub></p>

## 에이전트의 일터를 한눈에

문서를 읽으면 **규장각**, 코드를 고치면 **공조**, 테스트를 돌리면 **과거장**으로 이동합니다. 신하들은 정해진 길을 걷고, 서브에이전트는 도깨비로 나타납니다. `Court`는 이들이 모여 일하는 조정(朝廷)을 뜻합니다.

| 조정에서 보이는 것 | 할 수 있는 일 |
| --- | --- |
| **움직이는 도트 마을** | 작업 종류에 따라 인물이 관청을 이동하고, 지도를 확대·축소하며 살펴봅니다. |
| **내 에이전트 명부** | Claude Code와 Codex를 함께 보고, 세션의 이름·관직을 정하거나 숨깁니다. |
| **공무와 윤허 대기** | 최근 작업, 테스트, 권한 승인 대기와 응답 완료 상태를 확인합니다. |
| **기존 작업 방식 그대로** | 도구별로 연결·해제합니다. 기존 설정은 보존하고 변경 전에 백업합니다. |

개인용 버전은 **작업 관찰용**입니다. 지시와 권한 승인은 평소 쓰던 Claude Code·Codex에서 진행하세요.

## 빠른 시작

**Node.js 20 이상**과 연결할 Claude Code 또는 Codex가 설치되어 있어야 합니다. 원하는 위치에서 실행하세요.

```bash
git clone https://github.com/Magiof/agent-court.git
cd agent-court
npm run connect -- both
npm run local
```

브라우저에서 [localhost:4545](http://localhost:4545)를 열고 평소처럼 작업하면 됩니다. 실행용 외부 npm 의존성이 없어 별도의 `npm install`은 필요하지 않습니다.

- 한 도구만 사용하면 `both` 대신 `claude` 또는 `codex`를 지정하세요.
- Claude Code는 연결 후 새 세션을 시작하세요. `/hooks`에서 등록을 확인할 수 있습니다.
- Codex는 앱의 **Hooks 설정** 또는 CLI의 `/hooks`에서 기록기를 검토하고 신뢰한 뒤 새 로컬 세션을 시작하세요.
- 서버를 끄려면 해당 터미널에서 **Ctrl+C**를 누르세요.

포트 변경, 전역 설치, 연결 해제는 [시작하기](docs/START-HERE.md)와 [상세 사용법](docs/USAGE.md)에서 안내합니다.

<details>
<summary><strong>연결 전에 화면부터 둘러보고 싶다면</strong></summary>

프로젝트 폴더에서 가상 세션 데모를 실행하세요. 도구 연결이나 실제 AI 작업 없이 화면을 볼 수 있습니다.

```bash
FARM_NO_AGENTS=1 npm run demo
```

[localhost:4546](http://localhost:4546)에서 열립니다. 가상 기록은 프로젝트의 `data-demo/`에 저장됩니다.

</details>

## 지원 범위

| 환경 / 도구 | 현재 상태 |
| --- | --- |
| **macOS** | 설치·연결·해제·기록·서버·배포본 검증 완료 |
| **Linux** | 설치 코드 지원 · 실사용 환경 미검증 |
| **Windows** | 현재 미지원 |
| **Claude Code** | 로컬 명령 훅으로 작업 상태 기록 |
| **Codex CLI** | 0.154.0에서 연결 설정 인식 확인 |
| **Codex 데스크톱 앱** | Hooks를 이용하는 연결 방식 · 실제 앱 작업 → 지도 반영은 미검증 |

같은 컴퓨터에서 실행하는 로컬 작업을 관찰합니다. 클라우드 작업과 팀 공동 서버는 현재 연결 범위에 포함되지 않습니다.

## 내 컴퓨터에 남는 실록

기록기는 시각, 세션 ID, 작업 폴더, 도구 이름과 작업 종류를 로컬에 저장합니다. **프롬프트, 대화 본문, 명령 원문, 패치, 파일 내용과 도구 출력은 새로 저장하지 않습니다.**

맵을 위한 **추가 모델/API 호출은 없습니다.** 기록기와 서버, 브라우저는 컴퓨터 자원을 사용합니다. 원래 에이전트에서 수행하는 작업의 사용량은 해당 서비스 기준대로 계산됩니다.

기본 기록 폴더는 `~/.agent-court/data/`이며 서버는 `127.0.0.1`에서 실행됩니다. 기존 기록 호환성과 Google Fonts 연결 등 자세한 내용은 [기록과 사용량 안내](docs/USAGE.md#기록되는-정보와-사용량)를 참고하세요.

## 더 알아보기

| 안내 | 내용 |
| --- | --- |
| [처음 시작하기](docs/START-HERE.md) | 설치, 연결, 실행, 연결 해제, 화면에 세션이 안 나올 때 |
| [상세 사용법](docs/USAGE.md) | 모든 명령, 기록 위치, 관청별 작업, 호환성과 문제 해결 |
| [개발과 검증](docs/USAGE.md#개발과-검증) | 테스트 환경 준비, PNG 검증, 배포 패키지 검증 |
| [에셋 안내](THIRD-PARTY-NOTICES.md) | 지도·인물 이미지와 외부 글꼴 출처 |

풍경과 인물 7종은 이 프로젝트를 위해 OpenAI ImageGen으로 생성했습니다.
