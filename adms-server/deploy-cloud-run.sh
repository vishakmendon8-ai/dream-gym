#!/usr/bin/env bash
# Deploy Dream Gym Secureye WebSocket + ADMS Server to Google Cloud Run
# and automatically verify the live wss://<CLOUD-RUN-URL>/biometric handshake.
#
# Run directly inside Google Cloud Shell (https://shell.cloud.google.com):
#   git clone https://github.com/vishakmendon8-ai/dream-gym.git && cd dream-gym/adms-server && bash deploy-cloud-run.sh

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-gym001-50a97}"
REGION="${GCP_REGION:-asia-south1}"
SERVICE_NAME="${CLOUD_RUN_SERVICE:-dream-gym-biometric-ws}"

echo "==================================================================="
echo "  Deploying ${SERVICE_NAME} to Google Cloud Run"
echo "  Project : ${PROJECT_ID}"
echo "  Region  : ${REGION}"
echo "==================================================================="

gcloud config set project "${PROJECT_ID}"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --timeout 3600 \
  --session-affinity \
  --min-instances 1 \
  --set-env-vars "FIREBASE_PROJECT_ID=${PROJECT_ID},ADMS_TIMEZONE=5.5,USE_GCP_ADC=true"

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --format='value(status.url)')"
WSS_URL="${SERVICE_URL/https:\/\//wss:\/\/}/biometric"

echo ""
echo "==================================================================="
echo "  DEPLOYED SUCCESSFULLY!"
echo "  HTTPS Base URL        : ${SERVICE_URL}"
echo "  Secureye WSS Endpoint : ${WSS_URL}"
echo "  Live Dashboard        : ${SERVICE_URL}/"
echo "  Health Check          : ${SERVICE_URL}/health"
echo "==================================================================="
echo ""
echo "Verifying live WSS handshake on ${WSS_URL}..."

node -e '
const wssUrl = process.argv[1];
const ws = new WebSocket(wssUrl);
const timer = setTimeout(() => { console.error("Handshake timed out"); process.exit(1); }, 10000);
ws.addEventListener("open", () => {
  console.log("[OK] WSS Handshake (HTTP 101 Switching Protocols) verified:", wssUrl);
  ws.send(JSON.stringify({ cmd: "reg", sn: "102026020002110" }));
});
ws.addEventListener("message", (ev) => {
  console.log("[OK] Server replied to Secureye reg:", ev.data);
  clearTimeout(timer);
  ws.close();
  process.exit(0);
});
ws.addEventListener("error", (err) => {
  console.error("[ERROR] WSS failed:", err);
  process.exit(1);
});
' "${WSS_URL}"
