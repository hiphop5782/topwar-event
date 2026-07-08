# 실시간 OX 퀴즈 사용 안내

## 실행

`index.html`을 브라우저에서 열면 됩니다. 인터넷 연결이 필요합니다.

## 준비

1. Firebase 콘솔에서 웹 앱을 만들고 앱 설정 JSON을 복사합니다.
2. Firebase 콘솔에서 데이터베이스를 생성합니다.
3. Authentication에서 익명 로그인을 활성화합니다.
4. `firebase.json` 파일에 Firebase 웹 앱 설정 JSON을 넣습니다.
5. 데이터베이스 규칙은 아래처럼 설정할 수 있습니다.

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /oxQuiz/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

익명 로그인을 쓰지 않고 테스트만 할 경우에는 아래 규칙을 임시로 사용할 수 있습니다.

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /oxQuiz/{document=**} {
      allow read, write: if true;
    }
  }
}
```

관리자 모드 비밀번호는 `kid`입니다. 이 비밀번호는 행사용 간단 보호 장치입니다.

## 설정 파일

앱은 설정을 아래 순서로 찾습니다.

1. `firebase.json`
2. `firebase-config.js`

행사장에서 매번 붙여 넣기 싫다면 `firebase.json`에 Firebase 웹 앱 설정 JSON을 넣어두면 됩니다.

```json
{
  "apiKey": "...",
  "authDomain": "...",
  "projectId": "...",
  "storageBucket": "...",
  "messagingSenderId": "...",
  "appId": "..."
}
```

## 주요 기능

- 참여자 모드: 닉네임 입력 후 O/X 선택
- 관리자 모드: 질문, 정답, 제한시간, 최대 당첨 인원, 참고 이미지 설정
- 관리자 차단: 잘못된 닉네임 참여자를 차단하고 선택 목록에서 제거
- 자동 마감: 제한시간이 끝나면 자동으로 결과 저장
- 결과 유지: 다음 문제 출제 전까지 정답과 당첨자 표시
- 실시간 채팅: 기록 저장 없이 임시 메시지만 표시
- CSV 다운로드: 관리자 기록을 CSV로 저장
