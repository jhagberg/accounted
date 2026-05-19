#!/bin/sh
set -e

# ─── Validate required environment variables ───
missing=""
for var in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_APP_URL CRON_SECRET; do
  eval val=\$$var
  if [ -z "$val" ]; then
    missing="$missing  - $var\n"
  fi
done

if [ -n "$missing" ]; then
  printf "ERROR: Missing required environment variables:\n%b\nSee .env.docker.example for reference.\n" "$missing" >&2
  exit 1
fi

# Warn if placeholder values are still set
placeholders_found=""
case "$NEXT_PUBLIC_SUPABASE_ANON_KEY" in *your-anon-key*) placeholders_found="$placeholders_found  - NEXT_PUBLIC_SUPABASE_ANON_KEY\n" ;; esac
case "$SUPABASE_SERVICE_ROLE_KEY" in *your-service-role-key*) placeholders_found="$placeholders_found  - SUPABASE_SERVICE_ROLE_KEY\n" ;; esac
case "$NEXT_PUBLIC_SUPABASE_URL" in *your-project*) placeholders_found="$placeholders_found  - NEXT_PUBLIC_SUPABASE_URL\n" ;; esac
case "$NEXT_PUBLIC_APP_URL" in *your-domain*) placeholders_found="$placeholders_found  - NEXT_PUBLIC_APP_URL\n" ;; esac
case "$CRON_SECRET" in *generate-a-random-secret*) placeholders_found="$placeholders_found  - CRON_SECRET\n" ;; esac

if [ -n "$placeholders_found" ]; then
  printf "WARNING: These variables appear to contain placeholder values:\n%bPlease set them to real values before running in production.\n" "$placeholders_found" >&2
fi

# Replace build-time placeholder sentinels with runtime env vars across:
#   - /app/.next  (client static + server bundles + manifests; the manifests
#                  at .next/ root hold the CSP/headers from next.config.ts)
#   - /app/server.js  (standalone entrypoint)
#   - /app/public  (sw.js — service worker is served raw, not bundled, so
#                   Next's build-time inlining doesn't reach it)
#
# `sed -i` triggers a Docker overlay copy-up on every file it touches, so we
# prefilter with `grep -l` and only sed the files that actually contain a
# placeholder. busybox grep does not support -Z, so we rely on Next.js build
# outputs not having newlines in filenames (true for generated artifacts).
SUBST_PATHS=""
[ -d /app/.next ]     && SUBST_PATHS="$SUBST_PATHS /app/.next"
[ -d /app/public ]    && SUBST_PATHS="$SUBST_PATHS /app/public"
[ -f /app/server.js ] && SUBST_PATHS="$SUBST_PATHS /app/server.js"

if [ -n "$SUBST_PATHS" ]; then
  # File-type coverage:
  #   *.js   — client + server bundles
  #   *.json — routes-manifest.json (CSP/headers), build-manifest.json, etc.
  #   *.html — prerendered pages (e.g. /login title contains BRANDING_APP_NAME)
  #   *.rsc  — RSC payloads with the same inlined values
  #   *.body — metadata-route bodies, e.g. manifest.webmanifest.body (PWA name)
  # shellcheck disable=SC2086
  find $SUBST_PATHS -type f \
        \( -name '*.js' -o -name '*.json' -o -name '*.html' -o -name '*.rsc' -o -name '*.body' \) \
        -exec grep -l "__NEXT_PUBLIC_" {} + 2>/dev/null \
    | xargs -r sed -i \
        -e "s|__NEXT_PUBLIC_SUPABASE_URL__|${NEXT_PUBLIC_SUPABASE_URL}|g" \
        -e "s|__NEXT_PUBLIC_SUPABASE_ANON_KEY__|${NEXT_PUBLIC_SUPABASE_ANON_KEY}|g" \
        -e "s|__NEXT_PUBLIC_APP_URL__|${NEXT_PUBLIC_APP_URL}|g" \
        -e "s|__NEXT_PUBLIC_VAPID_PUBLIC_KEY__|${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-}|g" \
        -e "s|__NEXT_PUBLIC_SELF_HOSTED__|${NEXT_PUBLIC_SELF_HOSTED:-true}|g" \
        -e "s|__NEXT_PUBLIC_REQUIRE_MFA__|${NEXT_PUBLIC_REQUIRE_MFA:-false}|g" \
        -e "s|__NEXT_PUBLIC_BRANDING_APP_NAME__|${NEXT_PUBLIC_BRANDING_APP_NAME:-Gnubok}|g"
fi

exec "$@"
