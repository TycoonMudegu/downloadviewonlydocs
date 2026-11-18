#!/usr/bin/env bash
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT to your Google Cloud project ID}"
region="${REGION:-africa-south1}"
service="${SERVICE_NAME:-drive-download-helper}"
repository="${ARTIFACT_REPOSITORY:-cloud-run-source-deploy}"
image="${region}-docker.pkg.dev/${GOOGLE_CLOUD_PROJECT}/${repository}/${service}:$(date -u +%Y%m%d%H%M%S)"

if ! command -v gcloud >/dev/null; then
  echo 'Install the Google Cloud CLI and run gcloud auth login first.' >&2
  exit 1
fi

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project "$GOOGLE_CLOUD_PROJECT"
if ! gcloud artifacts repositories describe "$repository" --location "$region" --project "$GOOGLE_CLOUD_PROJECT" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$repository" --repository-format docker --location "$region" --project "$GOOGLE_CLOUD_PROJECT"
fi
gcloud builds submit . --tag "$image" --project "$GOOGLE_CLOUD_PROJECT"
gcloud run deploy "$service" \
  --image "$image" \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --region "$region" \
  --execution-environment gen2 \
  --port 8080 \
  --cpu 2 \
  --memory 2Gi \
  --concurrency 1 \
  --timeout 600 \
  --min-instances 0 \
  --max-instances 3 \
  --no-allow-unauthenticated \
  --set-env-vars CONVERSION_TIMEOUT_SECONDS=540,MAX_PAGES=300,MAX_PDF_MB=100
