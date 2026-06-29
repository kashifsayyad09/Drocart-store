#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/drocart-bootstrap.log) 2>&1
echo "=== DROCART Bootstrap started $(date) ==="

TIER="$${INSTANCE_TIER:-app}"
APP_DIR="/home/ec2-user/drocart"
WEB_ROOT="/var/www/drocart"
S3_BACKEND_BUCKET="$${S3_BACKEND_BUCKET:-}"
S3_FRONTEND_BUCKET="$${S3_FRONTEND_BUCKET:-}"
INTERNAL_ALB_DNS="$${INTERNAL_ALB_DNS:-localhost}"
AWS_REGION="$${AWS_REGION:-ap-south-1}"

dnf update -y
dnf install -y wget curl git unzip gcc make

dnf install -y amazon-cloudwatch-agent
systemctl enable amazon-cloudwatch-agent || true

# ════════════════════════════════════════════════════════════
#  WEB TIER — serves the standalone frontend/ build (static)
#  and reverse-proxies everything else to the backend/ API
#  running on the App Tier via the Internal ALB.
# ════════════════════════════════════════════════════════════
if [ "$TIER" = "web" ]; then
  echo "=== Installing Web Tier (Nginx) ==="
  dnf install -y nginx
  systemctl enable nginx
  mkdir -p $WEB_ROOT/css $WEB_ROOT/js
  [ -n "$S3_FRONTEND_BUCKET" ] && aws s3 sync s3://${S3_FRONTEND_BUCKET}/ $WEB_ROOT/ --region $AWS_REGION --delete || true

  cat > /etc/nginx/nginx.conf << NGINXEOF
worker_processes auto;
events { worker_connections 4096; multi_accept on; }
http {
  include mime.types; default_type application/octet-stream;
  sendfile on; tcp_nopush on; keepalive_timeout 65; server_tokens off;
  client_max_body_size 20M; gzip on; gzip_types text/plain text/css application/json application/javascript;
  limit_req_zone \$binary_remote_addr zone=api:20m rate=60r/m;
  limit_req_zone \$binary_remote_addr zone=auth:10m rate=10r/m;

  # Internal ALB → App Tier (backend/ API containers)
  upstream backend_api { server ${INTERNAL_ALB_DNS}:80 max_fails=3 fail_timeout=30s; keepalive 32; }

  server {
    listen 80 default_server;
    server_name _;
    root $WEB_ROOT;

    location /health { access_log off; return 200 '{"status":"ok"}'; add_header Content-Type application/json; }

    # Frontend static assets (built from frontend/css, frontend/js)
    location /css/ { alias $WEB_ROOT/css/; expires 1y; add_header Cache-Control "public,immutable"; }
    location /js/  { alias $WEB_ROOT/js/;  expires 1y; add_header Cache-Control "public,immutable"; }

    # API calls → proxy to backend/ over Internal ALB
    location /api/ {
      limit_req zone=api burst=20 nodelay;
      proxy_pass http://backend_api; proxy_http_version 1.1;
      proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto \$scheme; proxy_set_header Connection "";
      proxy_read_timeout 60s;
      add_header Access-Control-Allow-Origin "\$http_origin" always;
      add_header Access-Control-Allow-Methods "GET,POST,PUT,DELETE,PATCH,OPTIONS" always;
      add_header Access-Control-Allow-Headers "Content-Type,Authorization" always;
      add_header Access-Control-Allow-Credentials "true" always;
      if (\$request_method = OPTIONS) { return 204; }
    }
    location ~ ^/api/auth/(login|register|otp) {
      limit_req zone=auth burst=5 nodelay;
      proxy_pass http://backend_api; proxy_http_version 1.1;
      proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header Connection "";
    }
    location /socket.io/ {
      proxy_pass http://backend_api; proxy_http_version 1.1;
      proxy_set_header Upgrade \$http_upgrade; proxy_set_header Connection "upgrade";
      proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr;
      proxy_read_timeout 86400s; proxy_buffering off;
    }

    # Auth pages — both served from the same auth.html (login/signup)
    location = /login  { try_files /auth.html =404; }
    location = /signup { try_files /auth.html =404; }

    # SPA fallback — everything else serves index.html, client-side
    # router in index.html decides which page to render.
    location / {
      try_files \$uri \$uri/ /index.html;
    }

    location ~ /\.(git|env|htaccess) { deny all; return 404; }
  }
}
NGINXEOF
  nginx -t && systemctl start nginx
  echo "=== Web Tier Nginx started ==="
fi

# ════════════════════════════════════════════════════════════
#  APP TIER — runs the standalone backend/ Flask API
# ════════════════════════════════════════════════════════════
if [ "$TIER" = "app" ]; then
  echo "=== Installing App Tier (Flask backend) ==="
  dnf install -y python3.11 python3.11-pip python3.11-devel mysql-devel gcc make
  mkdir -p $APP_DIR /var/log/drocart /var/run/drocart
  chown -R ec2-user:ec2-user $APP_DIR /var/log/drocart /var/run/drocart
  [ -n "$S3_BACKEND_BUCKET" ] && aws s3 sync s3://${S3_BACKEND_BUCKET}/ $APP_DIR/backend/ --region $AWS_REGION --delete || mkdir -p $APP_DIR/backend
  python3.11 -m venv $APP_DIR/venv
  source $APP_DIR/venv/bin/activate
  pip install --upgrade pip
  pip install -r $APP_DIR/backend/requirements.txt

  cat > $APP_DIR/backend/.env << ENVEOF
APP_ENV=production
SECRET_KEY=$${SECRET_KEY:-change-me}
MYSQL_HOST=$${MYSQL_HOST:-localhost}
MYSQL_USER=$${MYSQL_USER:-root}
MYSQL_PASSWORD=$${MYSQL_PASSWORD:-}
MYSQL_DB=$${MYSQL_DB:-drocart}
ALLOWED_ORIGINS=$${ALLOWED_ORIGINS:-https://drocart.com}
COOKIE_SAMESITE=None
COOKIE_SECURE=true
GMAIL_ADDRESS=$${GMAIL_ADDRESS:-}
GMAIL_APP_PASSWORD=$${GMAIL_APP_PASSWORD:-}
GOOGLE_CLIENT_ID=$${GOOGLE_CLIENT_ID:-}
GOOGLE_CLIENT_SECRET=$${GOOGLE_CLIENT_SECRET:-}
GOOGLE_REDIRECT_URI=$${GOOGLE_REDIRECT_URI:-https://drocart.com/auth/google/callback}
AWS_REGION=$${AWS_REGION:-ap-south-1}
ENVEOF
  chown ec2-user:ec2-user $APP_DIR/backend/.env
  chmod 600 $APP_DIR/backend/.env

  cat > /etc/systemd/system/drocart.service << SVCEOF
[Unit]
Description=Drocart Flask Backend API (Gunicorn)
After=network.target
[Service]
Type=simple
User=ec2-user
Group=ec2-user
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$APP_DIR/backend/.env
ExecStart=$APP_DIR/venv/bin/gunicorn -c $APP_DIR/backend/gunicorn.conf.py app:app
Restart=always
RestartSec=5
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=30
StandardOutput=journal
StandardError=journal
SyslogIdentifier=drocart
NoNewPrivileges=yes
PrivateTmp=yes
[Install]
WantedBy=multi-user.target
SVCEOF
  systemctl daemon-reload
  systemctl enable drocart
  systemctl start drocart
  sleep 5
  systemctl is-active --quiet drocart && echo "=== Drocart backend RUNNING ===" || { echo "=== Drocart backend FAILED ==="; journalctl -u drocart --no-pager -n 30; }
fi

aws cloudwatch put-metric-data --namespace "Drocart/Bootstrap" --metric-name "BootstrapSuccess" --value 1 --dimensions Tier=$TIER --region $AWS_REGION 2>/dev/null || true
echo "=== Bootstrap completed $(date) ==="
