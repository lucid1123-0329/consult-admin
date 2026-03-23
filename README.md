# 명불허전학원 통합 상담 관리 포털 — 배포 가이드

## 📁 파일 구조

```
counsel-admin/
├── index.html              ← 프론트엔드 SPA (전체 UI)
├── vercel.json             ← Vercel 라우팅 설정
└── README.md               ← 이 파일
```

```
Apps Script (기존 프로젝트에 추가)
└── ConsultPortalAPI.gs     ← 백엔드 API (cp_ 접두어)
```

---

## 🚀 배포 순서

### 1단계: Apps Script 백엔드 설정

#### 1-1. ConsultPortalAPI.gs 추가
1. 기존 Apps Script 프로젝트 열기
2. 파일 추가 → `ConsultPortalAPI.gs` 이름으로 새 파일 생성
3. `ConsultPortalAPI.gs` 내용 전체 복사-붙여넣기

#### 1-2. doGet() 분기 추가
`ReportGenerator.gs`의 `doGet()` 함수에서, go 파라미터 분기 바로 아래에 추가:

```javascript
// ★ 상담 포털 API 분기 (기존 go 분기 아래에 삽입)
var cpAction = (e.parameter.action || '').trim();
if (cpAction.indexOf('cp_') === 0) {
  return cpHandleGet_(e);
}
```

#### 1-3. doPost() 분기 추가
`doPost()` 함수 맨 앞에 추가:

```javascript
// ★ 상담 포털 API 분기
try {
  var postBody = JSON.parse(e.postData.contents);
  if (postBody.action && String(postBody.action).indexOf('cp_') === 0) {
    return cpHandlePost_(e);
  }
} catch (err) {
  // cp_ 접두어가 아니면 기존 로직으로 통과
}
```

#### 1-4. [CONFIG] 시트에 관리자 계정 추가

**방법 A: 단일 비밀번호 (간단)**
| A열 (키) | B열 (값) |
|----------|----------|
| CP_ADMIN_PASSWORD | 원하는비밀번호 |

→ 이름에 상관없이 비밀번호만 맞으면 관리자로 로그인

**방법 B: 계정 목록 (권장)**
| A열 (키) | B열 (값) |
|----------|----------|
| CP_ACCOUNTS | `[{"name":"손정화","password":"1234","role":"counselor"},{"name":"박건영","password":"5678","role":"counselor"},{"name":"원장","password":"admin123","role":"admin"}]` |

→ 이름 + 비밀번호 조합으로 로그인, 역할별 권한 분리 가능

#### 1-5. 웹앱 재배포
1. Apps Script 에디터 → 배포 → 배포 관리
2. 새 버전 만들기 (또는 기존 배포 업데이트)
3. 실행 대상: "나" / 액세스: "모든 사용자"
4. 배포 URL 복사 (다음 단계에서 사용)

---

### 2단계: 프론트엔드 배포

#### 2-1. index.html에 API URL 설정
`index.html` 파일을 열고 아래 부분을 수정:

```javascript
// ⚠️ 아래 URL을 실제 Apps Script 웹앱 URL로 교체하세요
const API_BASE = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
```

#### 2-2. GitHub 레포 생성
```
레포 이름: counsel-admin (또는 consult-portal)
계정: lucid1123-0329
공개 설정: Public (Vercel Hobby 플랜 필요)
```

#### 2-3. 파일 업로드
- `index.html`
- `vercel.json`

#### 2-4. Vercel 배포
1. vercel.com → Import Project → GitHub 레포 선택
2. Framework: Other
3. 배포 실행

#### 2-5. 커스텀 도메인 연결
1. Vercel 프로젝트 → Settings → Domains
2. `consult-admin.trueasheard.com` 추가
3. 후이즈 DNS에 CNAME 추가:
   ```
   호스트: consult-admin
   타입: CNAME
   값: cname.vercel-dns.com
   ```
4. SSL 자동 발급 대기 (5~10분)

---

## 🔧 [DASHBOARD] 상담 주기 관리 시트 컬럼 매핑

대시보드가 올바르게 작동하려면 `[DASHBOARD] 상담 주기 관리` 시트의 컬럼에 아래 키워드가 포함되어야 합니다:

| 기능 | 컬럼 헤더에 포함되어야 할 키워드 |
|------|-------------------------------|
| 학생 이름 | A열 (첫 번째 컬럼) |
| 최근 2주 상담일 | "최근상담일" 또는 "2주상담일" |
| 학부모 상담일 | "학부모최근상담일" 또는 "학부모상담일" |
| 상담 회차 | "상담회차" 또는 "상담횟수" |

> 기존 시트 구조와 다를 경우 `index.html`의 `findKey()` 함수에 키워드를 추가하면 됩니다.

---

## 📊 상담 상태 판별 기준

| 상태 | 조건 | 표시 |
|------|------|------|
| 🟢 정상 | 최근 상담 12일 이내 | 녹색 |
| 🟡 예정 | 12~16일 경과 | 주황색 |
| 🔴 지연 | 16일 초과 | 빨간색 |
| 🟣 신규 | 상담 기록 없음 | 보라색 |

> 기준일은 `getStudentStatus()` 함수에서 조정 가능합니다.

---

## 🔐 보안 참고사항

- 토큰은 Apps Script의 `PropertiesService.getScriptProperties()`에 저장
- 토큰 만료: 24시간 (CP_TOKEN_EXPIRY_HOURS 변수로 조정)
- 브라우저 localStorage에 토큰 캐싱 (자동 로그인)
- 로그아웃 시 localStorage 초기화

---

## 🛣️ 다음 단계 (2순위~)

| 우선순위 | 기능 | 상태 |
|---------|------|------|
| ✅ 1순위 | 상담 주기 대시보드 | 완료 |
| ⬜ 2순위 | 2주 상담 세션 (AI 브리핑 → 체크리스트 → 완료) | 예정 |
| ⬜ 3순위 | 2주 리포트 관리 (목록 + 단축 URL + 공유) | 예정 |
| ⬜ 4순위 | 학부모 리포트 생성/관리 | 예정 |
| ⬜ 5순위 | 학부모 상담 기록 (입력/수정/이력) | 예정 |
| ⬜ 6순위 | 대기열 관리 (모니터링 + 강제처리) | 예정 |
