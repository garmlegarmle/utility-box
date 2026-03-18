# Utility Box Claude Code Runbook

이 문서는 Claude Code(또는 다른 코드 에이전트)가 이 저장소를 빠르게 이해하고, 이어서 개발/배포/운영할 수 있도록 만든 작업 안내서입니다.

## 1) 현재 아키텍처 요약
- Frontend: React + Vite (`/src`, build output: `dist`)
- API: VPS Node/Express (`/server/src`)
- DB: PostgreSQL (`posts`, `tags`, `post_tags`, `media`, `media_variants`, `app_settings`)
- Storage: VPS 업로드 볼륨 (`/opt/utility-box/storage/uploads`)
- Reverse proxy: VPS Nginx/Container Nginx

## 2) 소스 오브 트루스(중요)
- 코드/레이아웃: GitHub repository
- 런타임 콘텐츠(글/카드/태그): **PostgreSQL**
- 업로드 이미지/파일: **VPS storage**
- 운영 중 콘텐츠를 MDX/JSON에서 직접 읽지 않음

## 3) 주요 폴더 맵
- `/src`: React 앱 (화면/에디터/UI)
- `/server/src`: VPS API 라우트/인증/DB/helper
- `/server/sql`: PostgreSQL 스키마
- `/deploy/vps`: docker compose, Dockerfile, env 예시, 배포 스크립트
- `/public`: 정적 파일

## 4) 로컬 개발 시작
1. 의존성 설치
   - `npm install`
2. 프런트 실행
   - `npm run dev`
3. API 실행
   - `npm run dev:api`
4. 동시 실행
   - `npm run dev:all`
5. 점검
   - `npm run check`
   - `npm run build`

## 5) 작업 규칙 (에이전트용)
1. UI 수정
   - `src/App.tsx`, `src/components/*`, `src/styles.css` 중심
2. API 수정
   - `server/src/app.js`, `server/src/auth.js`, `server/src/db.js`, `server/src/media.js`
3. DB 스키마 변경
   - `/server/sql/schema.pg.sql`
4. 라우팅/호스트 이슈
   - `/deploy/vps/nginx/default.conf.template` + VPS ingress 확인
5. 다국어 문구
   - `src/lib/site.ts`의 `t(lang, key)` 우선 사용

## 6) 배포 절차
### VPS 배포
1. `main` 브랜치 푸시
2. 서버에서:
   - `cd /opt/utility-box/app && git pull --ff-only`
   - `docker compose -f deploy/vps/docker-compose.utility-box.yml --project-name utility-box up -d --build utility-box-api utility-box-web`

## 7) 운영 체크리스트
1. `https://www.ga-ml.com/en/`, `/ko/` 진입 확인
2. `/api/posts` 호출이 HTML이 아닌 JSON인지 확인
3. 관리자 로컬 로그인 확인
4. 관리자 로그인 후 작성/수정/삭제/상태변경 확인
5. 공개 사용자는 `published`만 보이는지 확인

## 8) 보안/비밀정보 관리 규칙
다음 항목은 **GitHub에 커밋 금지**:
- `.env`, `.env.local`, `.env.*.local`
- 개인 키 파일(`*.pem`, `*.key`)
- 개인 메모 파일: `CLAUDE_LOCAL_SECRETS.md`, `CLAUDE_LOCAL_NOTES.md`

민감정보는 서버 env 또는 로컬 비밀 메모로만 관리:
- `ADMIN_SESSION_SECRET`
- `ADMIN_TOKEN`
- `ADMIN_LOGIN_USER`
- `ADMIN_LOGIN_PASSWORD`

## 9) 로컬 비밀정보 메모(선택)
필요하면 아래 파일을 로컬에서만 생성해서 사용:
- `CLAUDE_LOCAL_SECRETS.md` (gitignore 처리됨)
- 예시는 `CLAUDE_LOCAL_SECRETS.example.md` 참조

## 10) 장애 대응 빠른 점검
1. API가 HTML 반환
   - VPS Nginx 프록시와 `default.conf.template` 확인
2. 호스트 혼합 문제(www/apex)
   - VPS ingress canonical redirect 확인
3. 로그인 실패
   - `ADMIN_LOGIN_USER`, DB의 `app_settings.admin_password_hash`, 세션 쿠키 확인
4. 데이터 불일치
   - PostgreSQL 조회 결과와 UI 응답 비교 (`/api/posts?...`)
