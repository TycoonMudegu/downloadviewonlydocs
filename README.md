# downloadviewonlydocs

Hummingbird Publishers — Google Drive PDF downloader.

A small Node.js service with a web interface for rebuilding publicly viewable Google Drive PDF previews into downloadable PDFs. Designed for Cloud Run, with a CLI for local use.

Built from the idea in [Google-Drive-View-Only-PDF-Script-Downloader](https://github.com/zavierferodova/Google-Drive-View-Only-PDF-Script-Downloader). The original README and browser-console script are preserved in [docs/upstream-README.md](docs/upstream-README.md); the Git history and `upstream` remote are retained.

## How it works

Playwright opens the public Drive preview in a fresh browser context, reads its page count, sets 200% zoom, and visits every page. Each fully loaded page image is embedded in a PDF with its own aspect ratio. Thumbnails are excluded. Missing pages fail the request rather than returning a partial document.

Improvements over the console script:

- Accepts a Drive URL through a paste-link web interface, HTTP, or the command line; no manual scrolling or console pasting.
- Loads lazy pages individually and verifies the final page count.
- Supports mixed portrait and landscape pages and Drive resource-key links.
- Pins dependencies locally instead of injecting a CDN script into Drive.
- Includes request deadlines, cancellation on disconnect, page and size limits, and a single conversion per instance.
- Restricts browser requests to Google viewer hosts and rejects arbitrary URLs.
- Ships a non-root Docker container, optional bearer authentication, health checks, and Cloud Run deployment script.

The output contains page images. Searchable text, links, bookmarks, original PDF metadata, and exact physical paper dimensions are not preserved. It uses the resolution available from Drive's preview, rather than the original file. Private files that require Google sign-in are unsupported; the service has no user login or cookies. Drive viewer changes, quotas, or datacenter traffic restrictions can require adjustments. Use it with documents your office is permitted to copy.

## Local setup

Requires Node.js 22 or later. Chromium's Linux system libraries must be installed; Playwright's command below may request sudo for that step.

```bash
npm ci
npx playwright install --with-deps chromium
npm start
```

Open **http://localhost:8080/** to use the web interface. Paste your link and select **Generate PDF**. The page shows preparation status and elapsed time, supports cancellation, and downloads the finished PDF automatically. A **Download PDF** link remains available if automatic downloading is blocked.

The server listens on `0.0.0.0:8080`, or the `PORT` environment variable. On this Windows/WSL setup, Windows forwards port 8080 to Apache; use a different port for local testing:

```bash
PORT=8090 npm start
```

Then open **http://127.0.0.1:8090/** and use port 8090 in API requests too. To load the example environment file with Node:

```bash
cp .env.example .env
node --env-file=.env src/server.js
```

Convert a file without running a server:

```bash
npm run convert -- \
  'https://drive.google.com/file/d/1ttNvzuQbHUnABVcP-TAoix8-TVmehYph/view' \
  output/mathematics-grade-8.pdf
```

If you omit the destination, the CLI uses the document's title under `output/`.

## Your workspace

The floating logo and frosted glass interface use Hummingbird’s orange and cyan colours. The time avatar, message and palette follow **Africa/Nairobi** time:

| Mood | Nairobi time | Appearance |
| --- | --- | --- |
| Morning | 05:00–11:59 | Bright, warm and light |
| Midday | 12:00–14:59 | Balanced cyan and pearl |
| Afternoon / after hours | 15:00–04:59 | Softer, muted blue and warm orange |

Select **Make it yours** to preview a mood, edit the three daily messages, or add your own footer quote and author. **Auto** follows the clock and updates while the page is open. Preferences are saved in the current browser; **Reset defaults** restores the automatic palette and original messages. Browser storage errors fall back to defaults or apply settings for the current visit.

Footer quotes use Instrument Serif, with Caveat for author names. The included office humour was written for this tool and is credited to “The Hummingbird desk”, rather than attributed to historical figures. Use the arrow controls to change quotes. Display text uses Unbounded and Space Grotesk. Fonts are served locally from `public/fonts/`, with their SIL Open Font License files included. The supplied logo is retained unchanged in `public/images/hummingbird-logo.png`.

To change defaults for everyone, edit `public/workspace-settings.js`; saved browser preferences take priority until reset.

## HTTP API

`POST /convert` accepts JSON with one required field, `url`. Supported links include `/file/d/ID/view`, `/file/d/ID/preview`, `/open?id=ID`, and `/uc?id=ID`. The optional `resourcekey` query parameter is retained.

```bash
curl --fail-with-body --max-time 560 \
  -X POST http://localhost:8080/convert \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://drive.google.com/file/d/1ttNvzuQbHUnABVcP-TAoix8-TVmehYph/view"}' \
  --output mathematics-grade-8.pdf
```

The response is `application/pdf`, with an attachment filename and `X-PDF-Page-Count`. PDF delivery uses chunked streaming so Cloud Run's non-streaming 32 MiB response limit does not apply; conversion itself finishes in memory before delivery starts. Google documents the [streaming exception](https://docs.cloud.google.com/run/quotas).

When `API_KEY` is set, add `Authorization: Bearer <API_KEY>`. Keys are supplied through environment variables, never URL parameters. Leave `API_KEY` unset when using Cloud Run IAM alone. If you use both, send the Cloud Run identity token in `X-Serverless-Authorization` and the application key in `Authorization` ([Cloud Run authentication](https://docs.cloud.google.com/run/docs/authenticating/service-to-service)).

`GET /` serves the web interface. `GET /api` returns API usage information, `GET /api/config` tells the page whether an access key is required, and `GET /healthz` returns `{"status":"ok"}`. When `API_KEY` is configured, the page shows a password field; the key stays in memory and is sent only in the conversion request header.

Errors return JSON:

```json
{"error":{"code":"ACCESS_REQUIRED","message":"This file requires Google sign-in or additional sharing permission."}}
```

| Status | Meaning |
| --- | --- |
| 400 / 415 | Invalid Drive URL, JSON, or content type |
| 401 | Missing or incorrect application bearer token |
| 403 / 404 | Sharing permission required or file not found |
| 413 | Request, page count, or output size exceeds a limit |
| 422 | Unsupported preview or a page failed to load |
| 429 | This instance is busy; retry after the `Retry-After` interval |
| 502 / 503 | Drive/browser failure or service restarting |
| 504 | Conversion exceeded its deadline |

## Cloud Run

The included Dockerfile installs Chromium and its system libraries during the image build. It listens on Cloud Run's `PORT` and runs as the `node` user. No persistent disk, Drive API key, or Google user credentials are needed for conversion.

Install the [Google Cloud CLI](https://docs.cloud.google.com/sdk/docs/install), sign in, and use a Google Cloud project with billing enabled and permission to build images and deploy services:

```bash
gcloud auth login
export GOOGLE_CLOUD_PROJECT='your-project-id'
export REGION='africa-south1'
./scripts/deploy.sh
```

The script enables Cloud Run, Cloud Build, and Artifact Registry, creates a Docker repository if needed, builds the image remotely, and deploys it. Defaults are 2 vCPUs, 2 GiB RAM, concurrency 1, a 600-second request timeout, zero minimum instances, and up to three instances. `SERVICE_NAME` defaults to `drive-download-helper`; `ARTIFACT_REPOSITORY` defaults to `cloud-run-source-deploy`. Resource creation and use are billed to your project.

Deployment requires IAM authentication. Give your office's calling identities the Cloud Run Invoker role. For local testing, use the [authenticated proxy](https://docs.cloud.google.com/sdk/gcloud/reference/run/services/proxy):

```bash
gcloud run services proxy drive-download-helper \
  --project "$GOOGLE_CLOUD_PROJECT" --region "$REGION" --port 8080
```

Then send the same localhost `curl` request shown above. The proxy attaches your Google credentials; your account must be allowed to invoke the service. Your Google identity authorizes the service call, while the Drive file itself must still be publicly viewable.

To build and run the container locally with Docker:

```bash
docker build -t drive-download-helper .
docker run --rm --init -p 8080:8080 --memory=2g drive-download-helper
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listening port |
| `CONVERSION_TIMEOUT_SECONDS` | `540` | Overall conversion deadline, including browser startup |
| `MAX_PAGES` | `300` | Maximum pages in one document |
| `MAX_PDF_MB` | `100` | Maximum accumulated page image bytes and final PDF size, in MiB |
| `API_KEY` | empty | Optional application bearer token |

Keep Cloud Run's request timeout above the conversion deadline and keep concurrency at 1. Large previews use additional browser and PDF memory; increase RAM or lower limits to suit your workload. PDFs are returned directly, without storage or a cache. The server cancels browser work when the caller disconnects. Logs include progress, counts, duration, and error codes; they omit submitted URLs, signed image URLs, and credentials.

## Tests

```bash
npm test             # UI serving, HTTP behavior, authentication, URL validation, limits
npm run check        # syntax checks
npm run test:browser # form, downloads, cancellation, mobile layout, and viewer fixtures
npm run test:live    # explicit live API conversion of the sample Drive file
```

Browser and live tests require Chromium and its system dependencies. Set `LIVE_DRIVE_URL` to use a different public PDF; the default live test expects 64 pages and saves `output/live-result.pdf`.

The sample Mathematics Grade 8 file was successfully converted locally to 64 distinct 1600 × 1133 page images in a 15,873,192-byte PDF. The first, middle, and last page images were visually checked. The API checks, offline browser checks, and full live HTTP conversion passed; the live API conversion took about 19 seconds in this workspace. Cloud Run deployment still requires a Google Cloud project; the container has not been built or deployed from this workspace.

## Repository

Source: [TycoonMudegu/downloadviewonlydocs](https://github.com/TycoonMudegu/downloadviewonlydocs).

`origin` points to this repository. The original project history and `upstream` remote are retained. New work is committed on `main`:

```bash
git add .
git commit -m 'Describe your changes'
git push origin main
```

The upstream repository did not include a license file at the inspected commit (`a3c0db1`). Its original attribution is retained; this project does not assert a new license over the upstream material.
