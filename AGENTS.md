# orca-modding — 인수인계 문서 (AGENTS.md)

> 작성일 2026-11-15. 폴더의 코드·프로젝트 파일·기존 문서와 실제 게임 설치 폴더(Steam `.acf`, `UnityPlayer.dll`, `MelonLoader.dll`)를 읽어 정리했다.
> 이 문서 작성 시점에 인게임 재검증은 하지 않았다. **"실측"** 표시는 디스크에서 직접 읽은 값, **"미확인"**은 다음 세션에서 확인할 항목이다.

## 0. 프로젝트 개요

- **무엇인가:** Orca Duo: Claude와 Antigravity를 한 대화창에서 번갈아 부르는 Electron 데스크톱/웹 앱(Orca 에이전트 코어 이식). 서버 `server/`, 프론트 `public/`, 테스트 `test/`.
- **종류:** 게임 모드가 아닌 앱/도구
- **최근 수정일(파일 기준):** 2026-11-05
- **git 원격:** `H:\local-repos\orca-modding.git`
- **최근 커밋:**
  - `812c45d Add GitHub Sponsors funding configuration`
  - `60cd624 Merge branch 'chore/remove-cleanup-bat'`
  - `0c355e0 chore: 세션 및 캐시 정리 bat 제거 및 관련 안내 문구 삭제`
  - `71d2a26 Merge branch 'fix/relay-double-finish'`
  - `05522e3 refactor: bat 본문 안내 문구를 영어로 통일`
- **먼저 읽을 기존 문서:**
  - [README.md](README.md)

## 1. 게임 버전 및 고정 여부

- 게임 모드가 아니므로 해당 없음.

## 2. 런타임 백엔드 및 디컴파일 경로

- 게임 모드가 아님. 런타임/언어: Node.js (`package.json`)

## 3. 설계 의도와 우회 사유 (Rationale)

코드 주석과 기존 문서에서 작성자가 남긴 의도·주의 문장을 그대로 옮겼다(파일:줄).

- `README.md:61` — 전체 자동 (Full)**: 명령 실행까지 별도 확인 없이 일괄 자동 수행 (주의 필요)
- `README.md:77` — Windows 32KB 명령줄 제한 극복**: Antigravity에 긴 공유 컨텍스트를 안정적으로 전송하기 위해 CLI 인자 대신 **stdin NDJSON (`--input-format stream-json`)** 스트림 방식을 채택했습니다.

## 4. 핵심 훅 시그니처와 주입 파이프라인

- **주요 소스 파일(큰 순):**
  - `test\core.test.js`
  - `public\js\composer.js`
  - `server\orchestrator.js`
  - `server\agents\claude.js`
  - `server\index.js`
  - `public\js\messages.js`
  - `public\index.html`
  - `server\agents\antigravity.js`
  - `public\js\markdown.js`
  - `server\agents\index.js`
  - `public\js\status.js`
  - `public\js\core.js`

## 5. 시도했다가 실패한 것들 (Dead Ends)

코드 주석과 기존 문서에서 실패·크래시·금지 관련 문장을 그대로 옮겼다(파일:줄). 같은 방법을 다시 시도하기 전에 해당 위치를 읽을 것.

- `README.md:55` — MCP 서버**: 지금 작업 폴더에서 쓸 수 있는 서버. Claude는 `claude mcp list`로 실제 연결까지 확인(연결됨/연결 실패/인증 필요), Antigravity는 `agy mcp list`의 켜짐/꺼짐 설정 상태.
- `README.md:78` — 세션 자동 복구**: CLI 세션 캐시가 만료되거나 삭제된 경우, 에러를 자동 감지하여 새 세션을 발급하고 전체 대화 맥락을 즉시 재주입합니다.

## 6. 빌드 명령 및 배포 경로

- Node: `npm install` 후 `package.json`의 scripts 사용
- `public\js\package.json`: 해당 폴더에서 `npm install` 후 scripts 사용
- 빌드/배포 스크립트: `Orca Duo 실행.bat`, `Orca Duo 웹으로 실행.bat`

## 7. 다음 작업자에게

- 작업 전 기존 문서(0절)부터 읽는다.
- 인게임 동작을 확인하면 3·5절의 **미확인** 항목을 실제 내용으로 바꾼다.
