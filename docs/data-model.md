# 데이터 구조

이 앱은 Firebase Firestore에 이벤트 상태와 사용자 선택을 저장합니다.

## 전체 경로

```txt
events/{eventId}
events/{eventId}/users/{userId}
```

현재 `eventId`는 `public/firebase-config.js`에서 관리합니다.

## 이벤트 문서

경로:

```txt
events/{eventId}
```

예시:

```json
{
  "phase": "ready",
  "picksPerUser": 3,
  "winnerLimit": 1,
  "winnerCell": null,
  "boardImageUrl": "map.png",
  "drawHistory": [],
  "forbiddenCells": [],
  "allowDuplicateWinners": true,
  "resetId": "initial",
  "updatedAt": "serverTimestamp"
}
```

## 이벤트 필드

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `phase` | string | 이벤트 상태입니다. `ready`, `locked`, `drawn` 중 하나입니다. |
| `picksPerUser` | number | 사용자당 선택 가능한 칸 수입니다. |
| `winnerLimit` | number | 한 번 발표할 때 당첨자로 선정할 최대 인원입니다. |
| `winnerCell` | number 또는 null | 현재 발표된 당첨 칸입니다. 0부터 63까지 사용합니다. |
| `boardImageUrl` | string | 보드 배경 이미지 경로입니다. |
| `drawHistory` | array | 당첨 발표 기록입니다. 최신 기록이 앞에 옵니다. |
| `forbiddenCells` | number[] | 선택 금지 칸 목록입니다. |
| `allowDuplicateWinners` | boolean | 이전 당첨자의 중복 당첨 허용 여부입니다. |
| `resetId` | string | 선택 초기화 시 사용자 로컬 선택을 동기화하기 위한 값입니다. |
| `updatedAt` | timestamp | 마지막 수정 시각입니다. |

## 상태값

### ready

참여자가 선택을 저장할 수 있는 상태입니다.

### locked

참여자 선택이 마감된 상태입니다. 관리자는 보드에서 당첨 칸을 발표할 수 있습니다.

### drawn

당첨 칸이 발표된 상태입니다. 당첨 배너와 당첨 내역이 표시됩니다.

## 당첨 기록

`drawHistory`의 각 항목 구조입니다.

```json
{
  "id": "generated-id",
  "cell": 12,
  "winners": [
    {
      "id": "user-id",
      "name": "닉네임",
      "winningOrder": 1,
      "selectedAt": 1718700000000
    }
  ],
  "winnerLimit": 3,
  "allowDuplicateWinners": true,
  "drawnAt": "2026-06-18T12:00:00.000Z"
}
```

`winningOrder`는 한 번의 발표 안에서 몇 번째 당첨자로 기록되었는지를 의미합니다.

화면에는 순위나 당첨 순서를 표시하지 않고 닉네임만 표시합니다. 예전 데이터에 일부 필드가 없어도 화면에는 닉네임만 안전하게 표시됩니다.

## 사용자 문서

경로:

```txt
events/{eventId}/users/{userId}
```

예시:

```json
{
  "id": "user-id",
  "name": "닉네임",
  "picks": [0, 7, 12],
  "submittedAt": 1718700000000,
  "updatedAt": "serverTimestamp"
}
```

## 사용자 필드

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `id` | string | 사용자 식별자입니다. 브라우저 localStorage에 저장됩니다. |
| `name` | string | 화면에 표시할 닉네임입니다. |
| `picks` | number[] | 사용자가 선택한 칸 목록입니다. |
| `submittedAt` | number | 사용자가 선택 저장을 누른 시각입니다. 당첨자 정렬에 사용됩니다. |
| `updatedAt` | timestamp | Firestore 서버 기준 수정 시각입니다. |

## 칸 번호 규칙

보드는 8x8이며 칸 번호는 0부터 63까지입니다.

화면 표시 형식은 `행-열`입니다.

예시:

| 내부 번호 | 화면 표시 |
| --- | --- |
| `0` | `1-1` |
| `7` | `1-8` |
| `8` | `2-1` |
| `63` | `8-8` |

## 초기화 동작

### 선택만 초기화

삭제되는 것:

- `users` 하위 문서
- 현재 당첨 칸

유지되는 것:

- 당첨 내역
- 선택 금지 칸
- 설정값

### 당첨 내역만 초기화

삭제되는 것:

- `drawHistory`
- 현재 당첨 칸

유지되는 것:

- 참여자 선택
- 선택 금지 칸
- 설정값

초기화 후 상태는 `locked`가 됩니다.

### 모든 내역 초기화

삭제되거나 초기화되는 것:

- 참여자 선택
- 당첨 내역
- 선택 금지 칸
- 현재 당첨 칸
- 설정값
