# Agent Court · 에이전트 조정

**내 Claude Code와 Codex가 지금 무엇을 하는지, 조선 도트 마을에서 한눈에 봅니다.**

Agent Court는 각자 자신의 컴퓨터에 설치해서 자신의 코딩 에이전트 작업을 관찰하는 로컬 대시보드입니다. 문서를 읽으면 규장각으로, 코드를 고치면 공조로, 테스트를 돌리면 과거장으로 인물이 이동합니다. 작업 방식과 계정은 원래 쓰던 Claude Code·Codex 그대로입니다.

`Court`는 에이전트들이 모여 일하는 조정(朝廷)을 뜻합니다. 특정 AI 도구에 이름을 묶지 않고 Claude Code와 Codex를 함께 담습니다.

![Agent Court의 조선 도트 지도](public/assets/joseon/v2/map-concept-v1.png)

## 주요 기능

- Claude Code·Codex를 각각 연결하거나 두 도구를 함께 연결
- 작업 종류에 따라 관청을 이동하는 인물과 서브에이전트
- 코드 수정, 테스트, 권한 승인 대기, 응답 완료 상태 표시
- 세션 이름과 관직 지정, 세션 숨김, 최근 작업 기록
- 지도 확대·축소, 밤낮 표현, 선택 가능한 소리와 알림
- 기존 설정을 보존하는 연결·해제와 변경 전 백업

첫 개인용 버전은 **작업 관찰용**입니다. 작업 지시와 권한 승인은 평소 쓰던 Claude Code·Codex에서 진행합니다.

## 지원 범위와 현재 상태

| 대상 | 지원 범위 / 검증 상태 |
| --- | --- |
| macOS | 설치, 연결·해제, 기록기 실행, 로컬 서버와 배포본 검증 완료 |
| Linux | 설치 코드가 지원하지만 실사용 환경 검증은 아직 하지 않음 |
| Windows | 현재 설치 도구가 지원하지 않음 |
| Claude Code | 로컬 명령 훅으로 상태 기록, 기존 운영 세션과 별도로 개인용 연결 가능 |
| Codex CLI | 0.154.0에서 연결 설정 12개 인식 확인 |
| Codex 데스크톱 앱 | 앱의 Hooks 기능을 이용하는 연결 방식. 현재 배포본의 실제 앱 작업 → 지도 반영은 아직 직접 검증하지 않음 |
| 클라우드 작업 / 팀 공동 서버 | 현재 개인용 배포의 연결 범위에 포함하지 않음 |

Node.js **20 이상**이 필요합니다. 실행용 외부 npm 라이브러리는 없습니다.

## 빠른 시작

원하는 위치에서 저장소를 내려받고 프로젝트 폴더로 이동합니다. 이미 내려받았다면 해당 `agent-court` 폴더에서 아래 연결 명령부터 실행하세요.

```bash
git clone https://github.com/Magiof/agent-court.git
cd agent-court
```

연결할 도구를 선택합니다. 셋 중 하나만 실행하세요.

```bash
npm run connect -- claude
npm run connect -- codex
npm run connect -- both
```

연결 설정을 바꾸기 전에 계획만 보고 싶다면:

```bash
npm run connect -- both --dry-run
```

맵을 켭니다.

```bash
npm run local
```

브라우저에서 [http://localhost:4545](http://localhost:4545)를 열고 평소처럼 작업하세요. 새 세션의 작업이 명부와 지도에 나타납니다. 서버를 켠 터미널에서 **Ctrl+C**를 누르면 맵 서버가 꺼집니다.

4545번 포트가 이미 사용 중이면:

```bash
npm run local -- --port 4547
```

이때는 [http://localhost:4547](http://localhost:4547)를 엽니다.

## Claude Code와 Codex에서 연결 마무리하기

### Claude Code

연결 후 새 세션을 시작해 설정을 읽게 합니다. `/hooks`에서 기록기가 등록되어 있는지 확인할 수 있습니다. 기존 권한·모델·다른 훅 설정은 보존합니다.

### Codex 데스크톱 앱

작업을 CLI로 바꿀 필요는 없습니다. 앱의 **Hooks 설정**에서 추가된 기록기를 검토하고 신뢰한 뒤 새 로컬 세션을 시작합니다. 최초 설치 명령은 연결 설정을 추가하는 도구이며, 이후 작업은 앱에서 계속합니다.

### Codex CLI

`/hooks`에서 새 기록기를 검토하고 신뢰한 뒤 새 세션을 시작합니다.

연결 도구는 신뢰 검토를 자동 승인하거나 건너뛰지 않습니다. 설정이나 기록기 정의가 바뀌면 다시 검토할 수 있습니다. 앱의 신뢰 확인 기능은 [공식 앱 변경 안내](https://learn.chatgpt.com/docs/changelog)에, 공통 설정과 로컬 작업 범위는 [Codex Hooks 안내](https://learn.chatgpt.com/docs/hooks)에 설명되어 있습니다. Claude Code는 [공식 Hooks 안내](https://code.claude.com/docs/en/hooks)를 참고하세요.

## 다른 컴퓨터에 설치하기

배포 파일 `agent-court-0.2.0.tgz`를 전달합니다. 받은 컴퓨터에도 Node.js 20 이상과 연결할 도구가 설치되어 있어야 합니다.

```bash
npm install --global ./agent-court-0.2.0.tgz
agent-court connect both
agent-court start
```

한 도구만 쓴다면 `both` 대신 `claude` 또는 `codex`를 지정합니다. 위의 신뢰 검토와 새 세션 시작도 해당 컴퓨터에서 진행합니다.

배포 파일은 로컬에서 다음과 같이 만들 수 있습니다. 이 명령은 npm 레지스트리에 공개하지 않습니다.

```bash
mkdir -p output/release
npm pack --pack-destination output/release
```

처음 사용하는 사람을 위한 별도 안내는 [시작하기](docs/START-HERE.md)에 있습니다.

## 연결 해제

프로젝트 폴더에서:

```bash
npm run disconnect -- claude
npm run disconnect -- codex
npm run disconnect -- both
```

배포본으로 설치했다면:

```bash
agent-court disconnect both
```

이 앱이 추가한 기록기만 제거합니다. 기존 설정, 다른 훅, 이미 저장된 작업 기록은 유지합니다. 서버만 끄면 연결된 기록기는 계속 기록하므로, 기록도 중단하려면 연결을 해제하세요.

## 명령과 설정 위치

| 명령 / 옵션 | 역할 |
| --- | --- |
| `agent-court connect claude\|codex\|both` | 선택한 도구에 관찰용 기록기 추가 |
| `agent-court disconnect claude\|codex\|both` | 이 앱의 기록기만 제거 |
| `agent-court start` | 로컬 맵 서버 실행 |
| `agent-court help` | 전체 사용법 |
| `--dry-run` | 연결·해제 계획만 표시, 파일 변경 없음 |
| `--claude-home /path` | Claude Code 설정 폴더 지정 |
| `--codex-home /path` | Codex 설정 폴더 지정 |
| `--data-dir /path` | 기록 저장 폴더 지정 |
| `start --port 4547` | 서버 포트 지정 |

연결 설정의 기본 위치는 Claude Code의 `~/.claude/settings.json`, Codex의 `~/.codex/hooks.json`입니다. 사용자 지정 설정 폴더와 관련 환경변수도 지원합니다.

기록 폴더는 기본적으로 **`~/.agent-court/data/`**입니다. 이전 버전의 `~/.claude-farm/data/`가 이미 있고 새 기록 폴더가 없다면 이전 기록을 그대로 재사용합니다. 파일을 자동으로 옮기거나 복사하지 않습니다. `--data-dir`를 지정하면 해당 폴더를 사용하며, 연결과 서버 실행에 같은 경로를 지정해야 합니다.

Node.js 설치 위치나 프로젝트 폴더가 바뀌면 `connect`를 다시 실행해 기록기의 실행 경로를 갱신합니다.

## 기록되는 정보와 사용량

개인용 기록기는 시각, 세션 ID, 작업 폴더, 도구 이름, 작업 종류를 저장합니다. **프롬프트·대화 본문·명령 원문·패치·파일 내용·도구 출력은 저장하지 않습니다.** 기록은 자기 컴퓨터에 남습니다.

맵을 보여주기 위한 추가 모델/API 호출이나 자동 추가 대화는 없습니다. 컴퓨터의 CPU·메모리·저장공간은 사용합니다. 원래 Claude Code·Codex에서 수행하는 작업의 사용량은 해당 서비스의 기준대로 계산됩니다.

대시보드는 `127.0.0.1`에서만 열리며 팀 공동 서버로 기록을 전송하지 않습니다. 화면 글꼴은 Google Fonts에서 불러옵니다. Claude Code·Codex 자체의 서비스 통신은 기존과 같습니다.

서버가 꺼진 동안에도 연결된 기록기는 기록을 남깁니다. 다시 켜면 최근 12시간을 복원합니다. 오래 무소식인 세션은 지도에서 사라집니다.

## 관청과 작업 종류

| 관청 | 표시하는 작업 |
| --- | --- |
| 승정원 | 지시 접수, 할 일 정리, 서브에이전트 소환·조율 |
| 규장각 | 문서 조회·검색, 웹 탐색, 외부 도구 조회 |
| 공조 | 코드 수정·작성, 일반 명령 실행 |
| 과거장 | 테스트, 타입 검사, 린트 |
| 사헌부 | 변경 사항·Git 상태 점검 |
| 어전 | 권한 승인과 사용자 답변 대기 |
| 주막 | 응답 완료 후 대기 |

상태는 도구 호출을 분류한 결과입니다. 모든 도구의 의미를 완벽히 판단하는 것은 아니며, 이름을 알 수 없는 도구는 기본 작업 종류로 표시할 수 있습니다.

## 문제가 생겼을 때

- **세션이 안 보임:** 연결 후 새 세션에서 작업을 시작합니다. 연결 전에 끝난 작업은 가져오지 않습니다.
- **Codex가 안 보임:** 앱의 Hooks 설정 또는 CLI `/hooks`에서 기록기를 신뢰했는지, 훅이 활성화되어 있는지 확인합니다. 현재 로컬 작업용입니다.
- **기록은 있는데 맵이 비어 있음:** 연결과 서버 실행이 같은 기록 폴더를 사용하는지 확인합니다.
- **포트가 사용 중:** `--port 4547` 등 다른 포트로 실행합니다.
- **Node.js나 폴더를 옮김:** `connect`를 다시 실행합니다. Codex에서 변경된 기록기를 다시 검토해야 할 수 있습니다.
- **설정 JSON이 잘못됨:** 설치 도구는 파일을 덮어쓰지 않고 중단합니다. 해당 설정을 복구한 뒤 다시 연결합니다.

## 개발과 검증

앱 실행에는 Node.js만 필요합니다. 개발용 PNG 검증에는 Python 3과 Pillow도 필요하므로 처음에는 다음과 같이 준비합니다.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
```

```bash
npm test
npm run test:assets
```

설정 보존·백업·반복 연결·해제·경로 인용·예전 연결 호환성, 두 도구의 상태 구분, 도트 인물 렌더링과 길 이동을 검사합니다.

배포본을 임시 설치해 설치 명령과 생성된 기록기, 서버 반영까지 확인하려면:

```bash
node scripts/validate-personal-package.mjs output/release/agent-court-0.2.0.tgz
```

실제 계정으로 AI 작업을 시작하는 검증은 아닙니다. Codex 데스크톱 앱의 실제 작업 연동은 별도로 확인해야 합니다.

가상 세션으로 화면을 보고 싶다면:

```bash
FARM_NO_AGENTS=1 npm run demo
```

[http://localhost:4546](http://localhost:4546)에 데모가 열립니다. 가상 기록은 프로젝트의 `data-demo/`에 저장합니다.

## 프로젝트 구조

```text
agent-court/
├── bin/agent-court.mjs         # 연결·해제·실행 명령
├── lib/install.mjs            # 설정 보존과 기록기 설치
├── hooks/farm-hook.mjs         # Claude Code·Codex 관찰용 기록기
├── server.mjs                 # 로컬 기록 → 상태 → 브라우저
├── public/                    # 화면, 지도, 인물 에셋
├── docs/START-HERE.md          # 처음 쓰는 사람을 위한 안내
├── tests/                     # 자동 검증
├── scripts/                   # 데모·배포 검증
└── requirements-dev.txt       # 개발용 PNG 검증 의존성
```

Git 저장소의 기본 브랜치는 `main`이며 원격 저장소는 [Magiof/agent-court](https://github.com/Magiof/agent-court)입니다. `.gitignore`에서 로컬 기록·토큰·비밀 파일·생성 결과물을 제외합니다. 배포 패키지도 실행에 필요한 파일만 골라 담습니다.

## 기존 기록과 개발 실행

개발용 실행인 `npm start`는 프로젝트의 `data/`를 읽습니다. 개인용 실행은 `npm run local`로 사용자 기록 폴더를 읽습니다. 두 실행 방법의 기록 폴더를 혼동하지 마세요.

기존 Claude 전용 웹 어명 수신기(`hooks/farm-listen.mjs`)와 자료 진상 도구(`bin/farm-show.mjs`)는 개발 폴더에 보존하지만 개인용 배포에는 포함하지 않습니다. 개인용 연결은 관찰용이며, 이전 연결 표식을 가진 기록기도 갱신·해제할 수 있습니다.

## 에셋

현재 풍경과 인물 7종은 이 프로젝트를 위해 OpenAI ImageGen으로 생성했습니다. 사용하지 않는 이전 이미지·폰트·참고 팩은 정리했으며, 현재 에셋과 외부 글꼴 사용은 [에셋 안내](THIRD-PARTY-NOTICES.md)를 참고하세요.
