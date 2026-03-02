# Utility Box Claude Code Runbook

이 문서는 Claude Code(또는 다른 코드 에이전트)가 이 저장소를 빠르게 이해하고, 이어서 개발/배포/운영할 수 있도록 만든 작업 안내서입니다.

## 1) 현재 아키텍처 요약
- Frontend: React + Vite (`/src`, build output: `dist`)
- API: Cloudflare Worker (`/worker/src`)
- DB: Cloudflare D1 (`posts`, `tags`, `post_tags`, `media`, `media_variants`)
- Storage: Cloudflare R2 (업로드 파일)
- Pages Functions:
  - `functions/api/[[path]].js`: `/api/*`를 `https://api.utility-box.org`로 프록시
  - `functions/_middleware.js`: 호스트 정규화 + SPA 라우팅 보정

## 2) 소스 오브 트루스(중요)
- 코드/레이아웃: GitHub repository
- 런타임 콘텐츠(글/카드/태그): **D1**
- 업로드 이미지/파일: **R2**
- 운영 중 콘텐츠를 MDX/JSON에서 직접 읽지 않음

## 3) 주요 폴더 맵
- `/src`: React 앱 (화면/에디터/UI)
- `/worker/src/routes`: API 라우트 (`posts`, `upload`, `media`, `tags`, `auth`)
- `/worker/src/lib`: auth/cors/db/helper 유틸
- `/functions`: Pages 레이어 프록시/리다이렉트
- `/db`: D1 스키마/마이그레이션/시드
- `/public`: 정적 파일

## 4) 로컬 개발 시작
1. 의존성 설치
   - `npm install`
2. 프런트 실행
   - `npm run dev`
3. 워커 실행
   - `npm run dev:worker`
4. 동시 실행
   - `npm run dev:all`
5. 점검
   - `npm run check`
   - `npm run build`

## 5) 작업 규칙 (에이전트용)
1. UI 수정
   - `src/App.tsx`, `src/components/*`, `src/styles.css` 중심
2. API 수정
   - `worker/src/routes/*.ts` + 필요 시 `worker/src/lib/*.ts`
3. DB 스키마 변경
   - `/db/schema.sql` 또는 마이그레이션 SQL 추가
4. 라우팅/호스트 이슈
   - `functions/_middleware.js` + `functions/api/[[path]].js` 확인
5. 다국어 문구
   - `src/lib/site.ts`의 `t(lang, key)` 우선 사용

## 6) 배포 절차
### Worker 배포
1. 로그인
   - `wrangler login`
2. 배포
   - `wrangler deploy`

### Pages 배포
1. `main` 브랜치 푸시
2. Cloudflare Pages가 자동 빌드/배포
3. 빌드 설정
   - Build command: `npm ci && npm run build`
   - Output directory: `dist`

## 7) 운영 체크리스트
1. `https://www.utility-box.org/en/`, `/ko/` 진입 확인
2. 새로고침 시 레거시 화면으로 돌아가지 않는지 확인
3. `/api/posts` 호출이 HTML이 아닌 JSON인지 확인
4. 관리자 로그인 후 작성/수정/삭제/상태변경 확인
5. 공개 사용자는 `published`만 보이는지 확인

## 8) 보안/비밀정보 관리 규칙
다음 항목은 **GitHub에 커밋 금지**:
- `.env`, `.env.local`, `.env.*.local`
- `.wrangler/`
- 개인 키 파일(`*.pem`, `*.key`)
- 개인 메모 파일: `CLAUDE_LOCAL_SECRETS.md`, `CLAUDE_LOCAL_NOTES.md`

민감정보는 Cloudflare Secrets로만 관리:
- `ADMIN_SESSION_SECRET`
- `ADMIN_TOKEN`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `ADMIN_GITHUB_USER`

## 9) 로컬 비밀정보 메모(선택)
필요하면 아래 파일을 로컬에서만 생성해서 사용:
- `CLAUDE_LOCAL_SECRETS.md` (gitignore 처리됨)
- 예시는 `CLAUDE_LOCAL_SECRETS.example.md` 참조

## 10) 장애 대응 빠른 점검
1. API가 HTML 반환
   - Pages Functions 라우팅/프록시 확인 (`functions/api/[[path]].js`)
2. 호스트 혼합 문제(www/apex)
   - `functions/_middleware.js`의 canonical redirect 확인
3. 로그인 실패
   - Worker secrets + GitHub OAuth callback URL 확인
4. 데이터 불일치
   - D1 조회 결과와 UI 응답 비교 (`/api/posts?...`)
