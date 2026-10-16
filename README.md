# Orca Duo (오르카 모딩)

Claude와 Antigravity(Google Deepmind)를 **하나의 대화창에서 자유롭게 번갈아 가며** 협업시키는 차세대 데스크톱/웹 AI 페어 프로그래밍 도구입니다.

[Orca](https://github.com/stablyai/orca)처럼 터미널 창을 여러 개 분리하여 띄울 필요 없이, Claude 데스크톱 앱과 같은 직관적인 인터페이스에서 수신 대상만 전환하여 매끄러운 핑퐁 협업을 수행할 수 있습니다.

```
나 → Claude      : calc.js 버그 찾아줘
Claude            : 3행 add 함수가 a - b를 반환하고 있습니다 …
나 → Antigravity : Claude가 짚은 버그 고쳐줘        ← Claude와 나눈 대화 맥락이 <shared-context>로 자동 전달
Antigravity       : (view_file → replace_file_content) 버그를 수정했습니다!
⇄ 자동 핑퐁 → Claude : 위 답변을 검토해줘 …          ← 지정한 횟수만큼 교차 검토 자동 수행
```

---

## ⚡ 빠른 시작

| 실행 방법 | 설명 |
|---|---|
| **`Orca Duo 실행.bat`** 더블클릭 | **Electron 데스크톱 앱**으로 실행 (최초 실행 시 필요한 의존성을 확인합니다) |
| **`Orca Duo 웹으로 실행.bat`** 더블클릭 | Electron 설치 없이 **기본 웹 브라우저**로 바로 실행 (Node.js만 필요) |
| CLI 명령어 | `npm start` (데스크톱) 또는 `npm run web` (웹 모드) |

### 사전 요구사항
1. **Node.js 20+**
2. 시스템 `PATH`에 등록된 CLI 도구:
   - **`claude`** (Claude Code CLI)
   - **`agy`** (Antigravity CLI)
   - *두 CLI 모두 사전에 로그인이 완료되어 있어야 합니다. 기본 경로가 다른 경우 앱 우측 상단 **설정**에서 직접 실행 파일 경로를 지정할 수 있습니다.*

---

## 🎮 주요 기능 & 사용법

- **대상 전환**:
  - 입력창 상단의 `Claude | Antigravity` 스위치 클릭 또는 **`Tab`** 키 단축키.
  - 입력창 테두리 색상으로 현재 활성 에이전트 식별 (**주황: Claude**, **파랑: Antigravity**).
- **멘션 호출 (`@claude`, `@agy`)**:
  - 스위치 상태와 무관하게 메시지 시작 부분에 `@claude` 또는 `@agy`를 붙여 즉시 타겟 지정 가능.
- **⇄ 자동 번갈기 (Auto-Alternate)**:
  - 활성화 시 메시지를 전송할 때마다 수신 대상이 자동으로 상대 에이전트로 전환됩니다.
- **⚡ 쿼터 소진 시 자동 바톤터치 (Auto Failover)**:
  - Claude 또는 Antigravity가 작업 도중 **사용량 한도(Rate Limit), 쿼터 초과, 잔액 부족** 등의 사유로 중단되면, 앱이 이를 즉시 감지하여 **상대 에이전트가 이전 맥락을 이어받아 자동으로 작업을 계속 진행**합니다 (설정에서 On/Off 가능).
- **자동 핑퐁 (Auto Relay / Ping-Pong)**:
  - 핑퐁 횟수(1~10회)를 설정하면 에이전트 답변이 끝난 후 상대 에이전트에게 자동으로 대화를 넘겨 교차 검증 및 연속 작업을 수행합니다.
- **↪ ○○에게 넘기기 (Handoff)**:
  - 답변 카드 하단의 넘기기 버튼을 누르면 상대 에이전트 맞춤형 검토 프롬프트가 입력창에 자동으로 채워집니다.
- **모델 · 노력(effort) 선택**:
  - 모델 목록은 각 CLI에서 직접 받아 버전이 붙은 이름으로 보여 줍니다 (`Opus 5.5`, `Sonnet 5.5`, `Gemini 4 Argon` …). 마지막 목록은 `models.json`에 저장해 다음 실행에서 바로 보입니다.
  - **노력**: 기본값 / 낮음 / 중간 / 높음 / 엑스트라 / 최대 — 고른 모델이 지원하는 단계만 나오고, 지원하지 않는 모델(예: Haiku 4.5)에서는 칸이 숨겨집니다.
  - Antigravity는 노력 단계가 모델 ID에 들어 있어(`…-low`·`-medium`·`-high`) 모델 칸에서 계열을, 노력 칸에서 단계를 고릅니다.
- **사용량 · MCP · 플러그인 창** (사이드바 아래 `사용량 · MCP` 버튼 또는 에이전트 이름 클릭):
  - **남은 사용량**: Claude는 5시간·주간 한도와 추가 크레딧(`get_usage` 제어 요청), Antigravity는 모델 그룹별 5시간·주간 한도(`agy -p /usage`). 둘 다 대화를 시작하지 않아 사용량을 쓰지 않습니다.
  - **MCP 서버**: 지금 작업 폴더에서 쓸 수 있는 서버. Claude는 `claude mcp list`로 실제 연결까지 확인(연결됨/연결 실패/인증 필요), Antigravity는 `agy mcp list`의 켜짐/꺼짐 설정 상태.
  - **플러그인 · 스킬**: 양쪽 CLI에 설치된 플러그인과 스킬 목록(`universal-modder` 12 skills, `google-antigravity-sdk` 등)과 활성 상태.
  - 결과는 1분간 기억하고, `새로 고침`을 누르면 다시 확인합니다.
- **세분화된 권한 제어**:
  - **읽기 전용 (Plan)**: 파일 수정 없이 계획 및 분석만 수행
  - **편집 허용 (Edit)**: 파일 편집은 자동 승인, 셸/터미널 명령 실행은 제한
  - **전체 자동 (Full)**: 명령 실행까지 별도 확인 없이 일괄 자동 수행 (주의 필요)
- **공유 작업 폴더 (CWD)**:
  - 우측 상단 폴더 칩을 통해 작업 디렉터리를 지정하며, 두 에이전트가 동일한 작업 공간을 공유합니다.
- **단축키**:
  - `Esc`: 현재 실행 중인 에이전트 프로세스 트리 즉시 강제 중단 (`taskkill /t /f`)
  - `Ctrl + N`: 새 대화 시작
  - 제목 더블클릭: 대화방 제목 변경

---

## 🧠 멀티 에이전트 컨텍스트 동기화 (Handoff)

각 에이전트 CLI는 자체 세션 식별자(`claude --resume <id>`, `agy --conversation <id>`)로 개별 대화 기록을 관리합니다.

Orca Duo는 각 에이전트가 **"상대방의 대화를 어디까지 보았는지(`seenUntil`)"**를 실시간으로 추적하여, 턴이 넘어갈 때 **그 사이에 발생한 상대방의 작업 내용 및 대화만을 선별하여 `<shared-context>` 태그로 포맷팅**해 프롬프트 전면에 주입합니다.

- **Windows 32KB 명령줄 제한 극복**: Antigravity에 긴 공유 컨텍스트를 안정적으로 전송하기 위해 CLI 인자 대신 **stdin NDJSON (`--input-format stream-json`)** 스트림 방식을 채택했습니다.
- **세션 자동 복구**: CLI 세션 캐시가 만료되거나 삭제된 경우, 에러를 자동 감지하여 새 세션을 발급하고 전체 대화 맥락을 즉시 재주입합니다.
- **작업 폴더 연동**: 작업 디렉터리가 변경되면 두 에이전트의 세션을 안전하게 초기화하고 전체 히스토리를 재구성합니다.
- **컨텍스트 최적화**: 메시지당 6,000자, 회차당 최대 30,000자로 안전하게 슬라이싱하여 토큰 낭비를 방지합니다.

---

## 📂 프로젝트 구조

```
orca-modding/
├── electron/          # Electron 데스크톱 창 & 네이티브 다이얼로그 바인딩
├── server/            # 로컬 백엔드 서버 (127.0.0.1 HTTP + SSE)
│   ├── index.js       # 서버 시작, API 라우팅, 토큰 기반 보안 및 호스트 검증
│   ├── http.js        # JSON 응답·요청 본문·정적 파일 도우미
│   ├── desktop.js     # 폴더 선택 창, 탐색기·브라우저로 열기
│   ├── orchestrator.js# 턴 흐름 제어, 세션 관리, 자동 핑퐁·바톤터치 예약
│   ├── handoff.js     # <shared-context> 포맷팅 및 컨텍스트 슬라이싱
│   ├── runner.js      # CLI 프로세스 스폰, 스트림 파싱 및 taskkill 종료
│   ├── store.js       # 대화·설정·모델 목록 저장 (%USERPROFILE%\.orca-duo\)
│   └── agents/
│       ├── index.js   # 에이전트 목록: CLI 찾기, 버전·모델 목록·사용량·MCP 조회
│       ├── shared.js  # 에이전트 이름, 노력 단계, 모델·노력 → CLI 인자 해석
│       ├── binary.js  # 실행 파일 찾기 (npm .cmd 셈 → 실제 exe)
│       ├── claude.js  # Claude Code 어댑터 (list_models로 모델 목록)
│       └── antigravity.js # agy 어댑터 (모델을 노력 단계별 계열로 묶음)
├── public/            # 빌드 도구 없는 바닐라 UI (index.html + ES 모듈)
│   ├── js/
│   │   ├── main.js    # 진입점: 부팅, 전역 단축키, 화면 전체 다시 그리기
│   │   ├── core.js    # 상수·상태·localStorage·API·공통 도우미
│   │   ├── events.js  # SSE 이벤트 스트림 → 화면 반영
│   │   ├── sidebar.js # 대화 목록, 에이전트 설치 상태
│   │   ├── header.js  # 제목(이름 바꾸기), 세션 배지, 작업 폴더 칩
│   │   ├── messages.js# 메시지·도구 블록 렌더링, 스트리밍 갱신
│   │   ├── composer.js# 입력창, 보낼 대상, 보내기/멈추기
│   │   ├── dropdown.js# 모델·권한·핑퐁 펼침 메뉴
│   │   ├── dialogs.js # 작업 폴더·설정 대화상자
│   │   ├── status.js  # 사용량 · MCP 창
│   │   ├── mention.js # `@claude`·`@클로드`·`@agy` 멘션 해석
│   │   └── markdown.js# 의존성 없는 마크다운 렌더러
│   └── css/           # base(토큰·공통) / layout / messages / markdown / composer / dialogs
└── test/              # 녹화된 스트림 기반 파서 및 컨텍스트 전달 단위 테스트
```

---

## 🔒 보안 아키텍처

- **루프백 제한**: 서버는 `127.0.0.1`에만 바인딩되며, 외부 네트워크 인터페이스로 노출되지 않습니다.
- **DNS 리바인딩 방어**: 요청 헤더의 `Host`가 `127.0.0.1` 또는 `localhost`가 아닌 경우 즉시 차단합니다.
- **CSRF / 악성 사이트 접근 차단**: 실행 시 메모리 상에서 생성된 암호학적 난수 토큰(`x-duo-token`)을 모든 API 요청에서 검증하여 악성 웹페이지의 무단 CLI 호출을 원천 차단합니다.

---

## 🧪 테스트 실행

```bash
npm test
```
- 스트림 이벤트 파싱 및 도구 실행 매핑 검증
- Handoff 공유 컨텍스트 중복 방지 및 전체 복구 로직 검증

---

## 📄 라이선스
MIT License
