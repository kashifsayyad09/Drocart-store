# 🛒 Drocart — Split Frontend / Backend Architecture

Frontend and backend are **two completely separate codebases**, each with
their own Dockerfile, deployable independently. `docker-compose.yml` lives
at the project root, outside both, and wires them together over a shared
Docker network — neither folder depends on the other at build time.

```
drocart/
├── docker-compose.yml      ← orchestrates db + backend + frontend (root level)
├── deploy.sh               ← AWS deployment CLI
├── backend/                ← standalone Flask JSON API + Socket.IO
│   ├── app.py
│   ├── database.sql
│   ├── requirements.txt
│   ├── gunicorn.conf.py
│   ├── Dockerfile
│   └── .env.example
├── frontend/                ← standalone static SPA (Nginx-served)
│   ├── index.html
│   ├── auth.html
│   ├── css/{style.css,otp.css}
│   ├── js/{api.js,app.js,pages.js,otp.js}
│   ├── nginx/nginx.conf
│   └── Dockerfile
├── terraform/                AWS three-tier infra (VPC, dual ALBs, RDS, ASGs)
├── scripts/userdata.sh        EC2 bootstrap (web tier = frontend, app tier = backend)
└── configs/drocart.service     systemd unit reference
```

## Architecture

```
Internet
   │
[External ALB] → [EC2 Web Tier: Nginx serving frontend/]
                         │  /api/*, /socket.io/ → proxied to:
                         ▼
                  [Internal ALB] → [EC2 App Tier: backend/ Flask API]
                                          │
                                          ▼
                                   [RDS MySQL Multi-AZ]
```

The browser talks **directly** to the backend's own URL for all `/api/*`
calls and Socket.IO — set via `window.DROCART_API_BASE` in
`frontend/index.html` and `frontend/auth.html`. In production this should
be your backend's public domain (e.g. `https://api.drocart.com`); the Nginx
web tier also proxies `/api/*` so either path works.

## Why split

- **Independent deploys** — ship a frontend bug fix without touching the API, or scale the backend without rebuilding static assets.
- **Independent scaling** — Nginx (cheap, stateless) and Flask (CPU/DB-bound) scale on different curves.
- **Separate teams/repos** — each folder is a complete, self-contained project that could live in its own git repo.
- **CORS-aware by design** — the backend explicitly allows the frontend's origin (`ALLOWED_ORIGINS`) rather than assuming same-origin.

## Local Dev (Docker Compose)

```bash
cp backend/.env.example backend/.env
# edit backend/.env — set GMAIL_ADDRESS, GMAIL_APP_PASSWORD

docker-compose up -d --build
open http://localhost:8080        # frontend
curl  http://localhost:5000/health # backend
```

Compose wires three services:
- `db` — MySQL 8.0, seeded from `backend/database.sql`
- `backend` — Flask API on port 5000, in network `backend_net` (with db, isolated) + `app_net` (reachable from frontend)
- `frontend` — Nginx static SPA on port 8080, in `app_net` only — cannot reach the database directly

## AWS Deployment

```bash
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
# edit terraform.tfvars

./deploy.sh upload      # sync backend/ and frontend/ to their own S3 buckets
./deploy.sh apply        # create infra (~15 min for RDS)
./deploy.sh seed-db      # seed MySQL schema + data
./deploy.sh roll         # rolling deploy
./deploy.sh status       # health check
```

Or run the whole pipeline: `./deploy.sh full`

EC2 Web Tier instances pull from the frontend S3 bucket; EC2 App Tier
instances pull from the backend S3 bucket — each tier only ever sees its
own half of the codebase.

## Google App Password Setup (OTP Email Delivery)

1. Enable 2-Step Verification: https://myaccount.google.com/security
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Select app "Mail", copy the 16-character password
4. Set in `backend/.env`:
   ```
   GMAIL_ADDRESS=yourname@gmail.com
   GMAIL_APP_PASSWORD=abcdefghijklmnop
   ```

## CORS / Cookies Note

Because frontend and backend are different origins, the backend sets
`ALLOWED_ORIGINS` to the frontend's exact URL (wildcards don't work with
credentialed cookies). For HTTPS production, also set:
```
COOKIE_SAMESITE=None
COOKIE_SECURE=true
```
For local HTTP dev, `COOKIE_SAMESITE=Lax` and `COOKIE_SECURE=false` (the
defaults) work fine on `localhost`.

## Default Credentials

| Role | Email | Password |
|---|---|---|
| Admin | admin@drocart.com | Admin@123 |
| Support | agent@drocart.com | Admin@123 |
| Customer | aanya@example.com | Admin@123 |

> Change all passwords before production.

## deploy.sh commands

```
plan              Terraform dry run
apply             Create/update AWS infrastructure
upload            Sync backend/ + frontend/ to their S3 buckets
upload-backend    Sync only backend/
upload-frontend   Sync only frontend/
seed-db           Run database.sql against RDS
roll              ASG rolling instance refresh
status            Health check + ASG status
rollback          Revert to previous launch template
full              upload + apply + seed-db + roll
destroy           Tear down all infrastructure
```
