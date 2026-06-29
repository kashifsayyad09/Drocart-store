# ============================================================
#  DROCART FRONTEND — Static SPA served by Nginx
#  Completely standalone container — no Python, no backend code.
# ============================================================
FROM nginx:alpine
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY index.html /usr/share/nginx/html/index.html
COPY auth.html  /usr/share/nginx/html/auth.html
COPY css/       /usr/share/nginx/html/css/
COPY js/        /usr/share/nginx/html/js/
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost/health || exit 1
