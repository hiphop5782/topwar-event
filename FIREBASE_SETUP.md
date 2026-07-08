# Firebase 설정

이 앱은 GitHub Pages에 정적 파일로 올리고, Firebase Firestore를 실시간 저장소로 사용합니다.

## 1. Firebase 프로젝트 만들기

1. Firebase Console에서 새 프로젝트를 만듭니다.
2. 웹 앱을 추가합니다.
3. Firebase가 보여주는 `firebaseConfig` 값을 복사합니다.
4. `public/firebase-config.js`의 빈 값에 붙여 넣습니다.

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

## 2. Firestore 만들기

Firebase Console에서 Firestore Database를 생성합니다.

프로토타입 테스트용 규칙은 아래처럼 둘 수 있습니다.

```txt
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /events/{eventId} {
      allow read, write: if true;

      match /users/{userId} {
        allow read, write: if true;
      }
    }
  }
}
```

이 규칙은 누구나 읽고 쓸 수 있어서 운영용으로는 약합니다. 실제 운영에서는 Firebase Auth와 관리자 권한 규칙을 붙이는 편이 안전합니다.

## 3. GitHub Pages

GitHub Pages에는 `public` 폴더 안의 파일을 올리면 됩니다.

- 사용자: `https://.../`
- 관리자: `https://.../?admin`

관리자 화면은 `window.prompt`에 `3223`을 입력하면 열립니다.
