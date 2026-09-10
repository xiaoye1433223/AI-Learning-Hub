FROM postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94
RUN apk add --no-cache python3 restic ca-certificates \
    && addgroup -g 1000 aihub-backup && adduser -D -u 1000 -G aihub-backup aihub-backup
WORKDIR /opt/operations
COPY --chmod=0444 backup.py ./
ENV HOME=/tmp RESTIC_CACHE_DIR=/tmp/restic-cache PGCONNECT_TIMEOUT=5
USER 1000:1000
ENTRYPOINT ["python3", "/opt/operations/backup.py"]
