/**
 * Vercel Function — vercel.json sends every /api/* request here from the same
 * code as the Cloudflare worker (worker/src/index.js).
 *
 * Secrets and settings come from Vercel → Project → Settings → Environment Variables.
 * Required: OPUS_SERVICE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 *           GOOGLE_REFRESH_TOKEN, MANAGER_PASSCODE, TOKEN_SECRET
 * Optional: OPUS_BASE_URL, OUTPUT_MAP, ALLOWED_ORIGINS, PARTICIPANTS, MANAGER_EMAIL
 * Run log:  connect Upstash Redis (Vercel → Storage); it sets KV_REST_API_URL/TOKEN.
 */
import { handle } from "../worker/src/index.js";

const DEFAULTS = {
  OPUS_BASE_URL: "https://operator.opus.com",
  WORKFLOW_ID: "23a4ac11-3fe8-4172-a317-4422e8040de6",
  SPREADSHEET_ID: "1GeML664hQhkxUZIptoNh2SdvzVnaXOLtkURDh6kbQ18",
  MANAGER_EMAIL: "nada.elasraby@aaico.com",
  // Same-origin calls from this Vercel site need no CORS; this also allows the GitHub Pages copy.
  ALLOWED_ORIGINS: "https://moataz-elnoamani.github.io",
  OUTPUT_MAP: "{}",
  PARTICIPANTS: JSON.stringify([
    { Name: "Minu", Email: "minu.bobasn@aaico.com" },
    { Name: "Asem", Email: "asem.elsebasey@aaico.com" },
    { Name: "Soufiane", Email: "soufiane.dosuhaib@aaico.com" },
    { Name: "Mahmoud", Email: "mahmoud.asbdelrahman@aaico.com" },
    { Name: "Moataz", Email: "moataz.elnoamani@aaico.com" },
  ]),
};

function env() {
  const out = { ...DEFAULTS };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && v !== "") out[k] = v;
  return out;
}

// vercel.json rewrites /api/<route> to /api?__path=<route>; restore the original path.
function originalRequest(request) {
  const url = new URL(request.url);
  const p = url.searchParams.get("__path");
  if (p === null || url.pathname.length > 4) return request;
  url.searchParams.delete("__path");
  url.pathname = "/api/" + p.replace(/^\/+/, "");
  return new Request(url, request);
}

const run = (request) => handle(originalRequest(request), env());
export const GET = run;
export const POST = run;
export const DELETE = run;
export const OPTIONS = run;
