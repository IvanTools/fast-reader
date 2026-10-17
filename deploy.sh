#!/bin/bash
# Deploy Fast Reader to Cloudflare Pages (project fast-reader).
# Wrangler asset upload fails through the sandbox proxy, so index.html is embedded in a Pages _worker.js (worker.template.js).
set -e; cd "$(dirname "$0")"
: "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}" "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
node -e 'const fs=require("fs");fs.writeFileSync("/tmp/_worker.js",fs.readFileSync("worker.template.js","utf8").replace("__HTML__",()=>JSON.stringify(fs.readFileSync("fast-reader/index.html","utf8"))))'
cp /tmp/_worker.js /tmp/_w.mjs && node --check /tmp/_w.mjs
curl -s -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/fast-reader/deployments \
  -F "manifest={}" -F "branch=main" -F "_worker.js=@/tmp/_worker.js;type=application/javascript+module" | jq '{success,errors,url:.result.url}'
