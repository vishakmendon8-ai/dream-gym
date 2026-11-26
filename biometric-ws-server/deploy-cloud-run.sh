#!/usr/bin/env bash
# Deploy Dedicated Secureye Biometric WebSocket Server to Google Cloud Run
# and verify the live wss://<CLOUD-RUN-URL>/biometric WebSocket handshake.
#
# Run in Google Cloud Shell (https://shell.cloud.google.com/?project=gym001-50a97):
#   rm -rf dream-gym && git clone https://github.com/vishakmendon8-ai/dream-gym.git && cd dream-gym/biometric-ws-server && bash deploy-cloud-run.sh

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-gym001-50a97}"
REGION="${GCP_REGION:-asia-south1}"
SERVICE_NAME="${CLOUD_RUN_SERVICE:-dream-gym-biometric-ws}"

echo "==================================================================="
echo "  Deploying Dedicated Secureye WebSocket Backend to Cloud Run"
echo "  Project : ${PROJECT_ID}"
echo "  Region  : ${REGION}"
echo "  Service : ${SERVICE_NAME}"
echo "==================================================================="

gcloud config set project "${PROJECT_ID}"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --timeout 3600 \
  --session-affinity \
  --min-instances 1 \
  --set-env-vars "FIREBASE_PROJECT_ID=${PROJECT_ID},DEVICE_TIMEZONE_OFFSET=5.5,USE_GCP_ADC=true"

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --format='value(status.url)')"
WSS_URL="${SERVICE_URL/https:\/\//wss:\/\/}/biometric"

echo ""
echo "==================================================================="
echo "  CLOUD RUN DEPLOYMENT COMPLETE!"
echo "  HTTPS Backend URL     : ${SERVICE_URL}"
echo "  Secureye WSS URL      : ${WSS_URL}"
echo "  Health Endpoint       : ${SERVICE_URL}/health"
echo "  Admin Status Endpoint : ${SERVICE_URL}/api/biometric/status"
echo "==================================================================="
echo ""
echo "Running live WebSocket handshake verification against ${WSS_URL}..."
npm install --no-audit --no-fund >/dev/null 2>&1 || true
node src/verifyHandshake.js "${WSS_URL}"
