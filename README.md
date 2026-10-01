<p align="center"><strong>한국어</strong> · <a href="README.en.md">English</a></p>

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
| **오늘의 조정과 실시간 사초** | 프롬프트·도구·수정·시험·윤허 통계와 최근 활동을 실시간으로 확인합니다. |
| **집중 알림** | 윤허 대기를 화면 알림·소리·브라우저 알림으로 놓치지 않도록 돕습니다. |
| **기존 작업 방식 그대로** | 도구별로 연결·해제합니다. 기존 설정은 보존하며, 실제로 변경되는 기존 설정 파일은 쓰기 전에 백업합니다. |

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
- `npm run local`은 포그라운드 서버입니다. 실행한 터미널을 닫으면 사이트도 내려가며, 서버를 끄려면 해당 터미널에서 **Ctrl+C**를 누르세요.

포트 변경, 전역 설치, 연결 해제는 [시작하기](docs/START-HERE.md)와 [상세 사용법](docs/USAGE.md)에서 안내합니다.

자주 쓰는 관리 명령은 다음과 같습니다.

```bash
npm run connect -- both --dry-run       # 설정을 바꾸지 않고 연결 계획 확인
npm run disconnect -- both              # Agent Court가 추가한 기록기만 제거
npm run local -- --port 4547            # 다른 포트로 실행
npm run local -- --data-dir /path/data  # 사용자 지정 기록 폴더 사용
```

현재 `--host` 옵션은 지원하지 않습니다.

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
| **macOS** | 코드상 지원 · 설치·연결·해제·기록·서버·배포본 수동 검증 완료 |
| **Linux** | 설치 코드 지원 · 실사용 환경 미검증 |
| **Windows** | 현재 미지원 |
| **Claude Code** | 로컬 명령 훅으로 작업 상태 기록 |
| **Codex CLI** | Codex Hooks 스키마를 전제로 연결 · 0.154.0에서 수동 확인 |
| **Codex 데스크톱 앱** | Hooks를 이용하는 연결 방식 · 실제 앱 작업 → 지도 반영은 미검증 |
| **원격 접속 / Cloudflare Tunnel** | 공식 지원 범위 밖 · 서버는 `127.0.0.1`에만 바인딩되며 로컬 사용을 전제로 함 |

같은 컴퓨터에서 실행하는 로컬 작업을 관찰합니다. 클라우드 작업과 팀 공동 서버는 현재 연결 범위에 포함되지 않습니다.

## 사이트가 열리지 않을 때

먼저 Agent Court를 설치한 컴퓨터의 프로젝트 폴더에서 서버를 다시 켜고, 터미널을 닫지 마세요.

```bash
npm run local
curl http://127.0.0.1:4545/api/state
```

- 터미널에 `Agent Court: http://localhost:4545`가 표시되고 `curl`이 JSON을 반환해야 정상입니다.
- `Connection refused`이면 서버가 실행 중이지 않은 상태입니다. `npm run local`을 다시 실행하세요.
- 4545번 포트가 사용 중이면 `npm run local -- --port 4547`로 실행한 뒤 [localhost:4547](http://localhost:4547)을 여세요.
- 화면은 열리지만 세션이 없다면 연결 후 Claude Code·Codex의 **새 로컬 세션**에서 작업을 시작하고, 두 프로세스가 같은 `--data-dir`를 사용하는지 확인하세요.

현재 서버는 소스상 `127.0.0.1`에 고정 바인딩되고 인증 없는 로컬 대시보드를 전제로 합니다. Cloudflare 계정에 Named Tunnel을 연결했더라도 다음 조건이 모두 맞아야 공개 주소의 읽기 화면이 열립니다.

1. Agent Court 원본 서버가 계속 실행 중이어야 합니다.
2. `cloudflared`가 원본 서버와 같은 컴퓨터·네트워크 공간에서 `http://127.0.0.1:4545`에 도달할 수 있어야 합니다.
3. 컨테이너를 사용한다면 터널 컨테이너의 `127.0.0.1`은 Agent Court 컨테이너가 아닐 수 있으므로, 두 컨테이너 사이에서 접근 가능한 원본 주소를 사용해야 합니다.

Cloudflare를 통한 외부 공개는 현재 공식 지원 범위가 아닙니다. 상태 API에는 별도 로그인 보호가 없고, 세션 이름·관직·숨김 같은 변경 요청은 localhost Origin만 허용하므로 공개 주소에서는 일부 기능이 `403`으로 실패할 수 있습니다. 불가피하게 공개할 때는 **Cloudflare Access 같은 인증 보호를 먼저 적용**하고, 로컬 전용이라는 현재 보안 경계를 이해한 상태에서 사용하세요.

## 내 컴퓨터에 남는 실록

`agent-court connect`가 설치하는 개인용 observe-only 기록기는 시각, 세션 ID, 작업 폴더, 도구 이름과 작업 종류를 로컬에 저장합니다. **프롬프트, 대화 본문, 명령 원문, 패치, 파일 내용과 도구 출력은 새로 저장하지 않습니다.** 저장소에 보존된 이전 개발용 비-observe-only 수신기와 웹 어명 경로는 메시지 본문·첨부를 저장할 수 있지만 개인용 배포에는 포함되지 않습니다.

맵을 위한 **추가 모델/API 호출은 없습니다.** 기록기와 서버, 브라우저는 컴퓨터 자원을 사용합니다. 원래 에이전트에서 수행하는 작업의 사용량은 해당 서비스 기준대로 계산됩니다.

기본 기록 폴더는 `~/.agent-court/data/`이며 서버는 `127.0.0.1`에서 실행됩니다. 서버 재시작 시 화면에는 최근 12시간의 기록을 복원하고, 이벤트 로그가 30MB를 넘으면 최근 2일치만 남깁니다. 기존 기록 호환성과 Google Fonts 연결 등 자세한 내용은 [기록과 사용량 안내](docs/USAGE.md#기록되는-정보와-사용량)를 참고하세요.

## 더 알아보기

| 안내 | 내용 |
| --- | --- |
| [처음 시작하기](docs/START-HERE.md) | 설치, 연결, 실행, 연결 해제, 화면에 세션이 안 나올 때 |
| [상세 사용법](docs/USAGE.md) | 모든 명령, 기록 위치, 관청별 작업, 호환성과 문제 해결 |
| [개발과 검증](docs/USAGE.md#개발과-검증) | 테스트 환경 준비, PNG 검증, 배포 패키지 검증 |
| [에셋 안내](THIRD-PARTY-NOTICES.md) | 지도·인물 이미지와 외부 글꼴 출처 |

풍경과 인물 7종은 이 프로젝트를 위해 OpenAI ImageGen으로 생성했습니다.
