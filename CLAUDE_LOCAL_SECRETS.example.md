# Local Secrets Template (Do Not Commit Real Values)

이 파일은 예시 템플릿입니다.
실제 값은 `CLAUDE_LOCAL_SECRETS.md`로 복사해서 로컬에서만 사용하세요.
`CLAUDE_LOCAL_SECRETS.md`는 `.gitignore`에 포함되어 GitHub에 올라가지 않습니다.

## Cloudflare Worker Secrets
- ADMIN_SESSION_SECRET=
- ADMIN_TOKEN=
- GITHUB_CLIENT_ID=
- GITHUB_CLIENT_SECRET=
- ADMIN_GITHUB_USER=

## Optional
- ALLOWED_ORIGINS=
- MEDIA_PUBLIC_BASE_URL=
- DEBUG_LOGS=0

## Notes
- Callback URL:
  - `https://api.utility-box.org/api/callback`
- Production site:
  - `https://www.utility-box.org`
