# 개발 및 배포 가이드

## 기술 구성

- 프론트엔드: HTML, CSS, JavaScript
- 실시간 저장소: Firebase Firestore
- 배포 방식: GitHub Pages 정적 배포
- 로컬 보조 서버: Node.js `server.js`

현재 실제 웹앱 동작은 `public/app.js`에서 Firebase Firestore를 직접 사용합니다.

## 로컬 실행

Node.js가 설치되어 있다면 아래 명령으로 로컬 서버를 실행할 수 있습니다.

```bash
npm start
```

기본 주소:

```txt
http://localhost:4173
```

관리자 화면:

```txt
http://localhost:4173/?admin
```

## Firebase 설정

Firebase 설정은 `public/firebase-config.js`에 있습니다.

필수 값:

- `apiKey`
- `authDomain`
- `projectId`
- `storageBucket`
- `messagingSenderId`
- `appId`
- `eventId`

`eventId`는 Firestore에서 이벤트 데이터를 나누는 문서 ID입니다.

```js
export const eventId = "3223-base-hit-event";
```

새 이벤트를 같은 코드로 별도 운영하고 싶으면 `eventId`를 바꾸면 됩니다.

## Firestore 경로

앱은 아래 경로를 사용합니다.

```txt
events/{eventId}
events/{eventId}/users/{userId}
```

자세한 필드 구조는 [데이터 구조](./data-model.md)를 참고하세요.

## 배포

GitHub Pages에는 `public` 폴더의 정적 파일이 올라가면 됩니다.

배포 대상 파일:

- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `public/firebase-config.js`
- `public/map.png`
- `public/CNAME`

## 캐시 갱신

`index.html`에서는 CSS와 JS에 버전 쿼리를 붙여 브라우저 캐시를 피합니다.

```html
<link rel="stylesheet" href="./styles.css?v=20260618-6" />
<script src="./app.js?v=20260618-6" type="module"></script>
```

`app.js` 또는 `styles.css`를 수정한 뒤 배포한다면 이 버전 숫자를 올리는 편이 안전합니다.

## 관리자 비밀번호

관리자 비밀번호는 `public/app.js`에 하드코딩되어 있습니다.

```js
window.prompt("관리자 비밀번호를 입력하세요.") === "3223"
```

이 방식은 간단한 이벤트 운영용입니다. 보안이 중요한 환경에서는 Firebase Auth와 Firestore 보안 규칙으로 관리자 권한을 분리해야 합니다.

## 주요 함수

- `normalizeState`: Firestore에서 받은 상태값 보정
- `render`: 전체 화면 렌더링
- `renderBoard`: 8x8 보드 렌더링
- `renderAdminPanel`: 관리자 패널 상태 반영
- `renderWinner`: 현재 당첨 결과 표시
- `renderWinnerRoster`: 누적 당첨 인원 표시
- `renderHistory`: 발표 기록 표시
- `savePicks`: 사용자 선택 저장
- `updateSettings`: 관리자 설정 저장
- `toggleForbiddenCell`: 선택 금지 칸 토글
- `draw`: 당첨 칸 발표
- `orderedWinnersForCell`: 당첨자 선정 및 당첨 순서 기록
- `resetPicksOnly`: 참여자 선택만 초기화
- `resetWinnerHistoryOnly`: 당첨 내역만 초기화
- `resetAll`: 전체 초기화

## 검증 명령

수정 후 최소한 아래 검사를 실행합니다.

```bash
node --check public/app.js
node --check server.js
git diff --check
```

## 주의 사항

- `public/firebase-config.js`의 Firebase 웹 설정값은 브라우저에서 공개되는 값입니다.
- 공개 설정값 자체보다 Firestore 보안 규칙이 더 중요합니다.
- 현재 예시 규칙은 누구나 읽고 쓸 수 있으므로 운영용으로는 약합니다.
- 관리자 비밀번호는 클라이언트 코드에 있으므로 강한 보안 수단이 아닙니다.
