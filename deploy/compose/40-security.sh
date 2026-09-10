#!/bin/sh
set -eu
# 只生成 Nginx 的固定部署边界；所有变量来自部署者的环境文件。
mkdir -p /etc/nginx/snippets
trusted=$(printf '%s' "$EXTERNAL_PROXY_CIDRS" | tr ',' ' ')
admin=$(printf '%s' "$ADMIN_NETWORK_CIDRS" | tr ',' ' ')
for cidr in $trusted $admin; do
  case "$cidr" in *[!0-9a-fA-F:./]*|'') echo '代理或管理网段格式无效' >&2; exit 1 ;; esac
  case "$cidr" in */0) echo '禁止信任或允许全网段' >&2; exit 1 ;; esac
done
if [ -z "$admin" ]; then admin='127.0.0.1/32 ::1/128'; fi
cat > /etc/nginx/conf.d/00-security.conf <<'EOF'
log_format security_safe '$time_iso8601 $request_id $request_method $status $body_bytes_sent $request_time';
error_log /dev/null;
map $uri $static_cache_policy {
    default "no-store";
    ~^/assets/ "public, max-age=31536000, immutable";
}
map $external_scheme $security_hsts {
    default "";
    https "max-age=31536000";
}
EOF
{
  printf 'geo $realip_remote_addr $trusted_peer {\n default 0;\n'
  for cidr in $trusted; do printf ' %s 1;\n' "$cidr"; done
  printf '}\n'
  for cidr in $trusted; do printf 'set_real_ip_from %s;\n' "$cidr"; done
  printf 'real_ip_header X-Forwarded-For;\nreal_ip_recursive on;\n'
  cat <<'EOF'
map "$trusted_peer:$http_x_forwarded_proto" $external_scheme {
    default $scheme;
    "1:https" https;
    "1:http" http;
}
EOF
} >> /etc/nginx/conf.d/00-security.conf
{
  for cidr in $admin; do printf 'allow %s;\n' "$cidr"; done
  printf 'deny all;\n'
} > /etc/nginx/snippets/admin-network.conf
# 拒绝配置注入，允许同主机不同端口；正式 Origin 还须通过 API preflight。
case "$FRONTEND_URL" in *[!a-zA-Z0-9:./_-]*) echo 'FRONTEND_URL 格式无效' >&2; exit 1 ;; esac
case "$ADMIN_WEB_URL" in *[!a-zA-Z0-9:./_-]*) echo 'ADMIN_WEB_URL 格式无效' >&2; exit 1 ;; esac
cat > /etc/nginx/snippets/security-headers.conf <<'EOF'
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Strict-Transport-Security $security_hsts always;
add_header Cache-Control $static_cache_policy always;
EOF
printf 'add_header Content-Security-Policy "default-src '\''self'\''; script-src '\''self'\''; style-src '\''self'\'' '\''unsafe-inline'\''; img-src '\''self'\'' data: blob: https:; media-src '\''self'\'' blob: https:; font-src '\''self'\'' data:; connect-src '\''self'\''; worker-src '\''self'\'' blob:; frame-src '\''self'\'' %s; object-src '\''none'\''; base-uri '\''self'\''; form-action '\''self'\''; frame-ancestors '\''self'\'' %s" always;\n' "$FRONTEND_URL" "$ADMIN_WEB_URL" >> /etc/nginx/snippets/security-headers.conf
nginx -t
