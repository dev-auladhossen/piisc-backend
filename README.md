# PIISC School Backend

Backend built with Node.js, Express 5, MongoDB, and Mongoose.

## Notices API

The routes are mounted at `/api/notices`. Send request bodies as JSON with
`Content-Type: application/json`. Replace `:id` with a notice's MongoDB `_id`.

Write routes and the management list require an authenticated administrator.

### Endpoints

| Method | Path | Access | Request body / query | Success response | Error codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/notices` | Public | Optional `page`, `limit`, `category` query parameters | `200`: `{ notices, pagination }`, newest `publishDate` first | `400`: invalid query parameters; `500`: unexpected server error |
| GET | `/api/notices/manage` | Admin | Optional `category`, `isPublished`, `page`, `limit` query parameters | `200`: `{ notices, pagination }`, newest `createdAt` first; includes drafts and creator name | `400`: invalid query parameters; `401`/`403`: not authorized; `500`: unexpected server error |
| GET | `/api/notices/:id` | Public | None | `200`: notice document | `400`: invalid ID; `404`: missing or hidden notice; `500`: unexpected server error |
| POST | `/api/notices` | Admin | Required: `title`, `content`; optional permitted fields below | `201`: created notice document | `400`: invalid fields or malformed JSON; `401`/`403`: not authorized; `500`: unexpected server error |
| PATCH | `/api/notices/:id` | Admin | Any subset of permitted fields below | `200`: updated notice document | `400`: invalid ID, invalid fields, or malformed JSON; `401`/`403`: not authorized; `404`: notice not found; `500`: unexpected server error |
| DELETE | `/api/notices/:id` | Admin | None | `200`: `{"message":"Notice deleted successfully","id":"<deleted notice ID>"}` | `400`: invalid ID; `401`/`403`: not authorized; `404`: notice not found; `500`: unexpected server error |

The management list accepts only single-string query values. `category` must
match a supported category; `isPublished` must be `true` or `false`; `page`
defaults to 1; `limit` defaults to 20 and cannot exceed 50. All supplied numbers
must be positive integers. Unknown parameters and array/object values return 400.
The response is `{ notices, pagination: { page, limit, total, totalPages } }`.

The two public GET endpoints return only notices with `isPublished: true`, a `publishDate`
at or before the current time, and no expiry (missing or null) or an expiry
strictly in the future. Drafts, future publications, and expired notices are hidden.
Older documents missing `isPublished` or `publishDate` will not match these
database filters: schema defaults on reading do not backfill stored documents.
Backfill those fields with verified historical values before deployment.
Unknown routes return a JSON `404` response.

### Reading notices from the frontend

Use `GET /api/notices?page=1&limit=20&category=event`. Category is optional.
Page defaults to 1, limit defaults to 20, and the maximum limit is 100.
Only `page`, `limit`, and `category` query parameters are supported; unknown
parameters return 400. Page and limit must be positive integer strings; the maximum offset
`(page - 1) * limit` is 100000. Unsupported category values return 400.

```json
{
  "notices": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

Read the list from `response.notices` (this replaces the previous bare array).
Request subsequent pages to retrieve all matching notices. An empty or
out-of-range page returns 200 with an empty list. The list and count are separate
queries, so totals may briefly differ if notices change during the request.
Queries have a five-second database execution limit; failures use the safe 500 response.

For details, use `GET /api/notices/<notice._id>` and read the returned document
directly. Both read endpoints omit the internal `__v` field.
Missing or hidden details return 404; malformed IDs return 400.

### Permitted body fields

POST and PATCH copy only these fields. Other fields, including `_id`, `createdAt`,
and `updatedAt`, are ignored.

| Field | Rules and default |
| --- | --- |
| `title` | Required string, trimmed, 3 to 150 characters |
| `content` | Required string, at least 10 characters |
| `category` | `general`, `admission`, `event`, `holiday`, `exam`, or `meeting`; defaults to `general` |
| `isImportant` | Boolean; defaults to `false` |
| `isPublished` | Boolean; defaults to `true` |
| `publishDate` | Date; defaults to the current time |
| `expiryDate` | Optional date; must be strictly after `publishDate` if supplied; `null` removes the expiry |

POST applies model defaults to omitted fields. PATCH preserves fields that were
not sent. An empty PATCH currently saves the existing notice without changing
its editable fields. Send dates as ISO 8601 strings, preferably including `Z`
for UTC or an explicit timezone offset.

PATCH loads the document, sets permitted fields, and calls `save()`. This lets
the model's expiry validator compare both dates on the full document, even if
only the publication date changes.

### Example JSON notice

This is a valid POST body. A successful response also includes `_id`,
`createdAt`, `updatedAt`, and Mongoose's version field `__v`.

```json
{
  "title": "Annual Sports Day",
  "content": "Sports day will be held at the school ground on February 15.",
  "category": "event",
  "isImportant": true,
  "isPublished": true,
  "publishDate": "2027-02-01T00:00:00.000Z",
  "expiryDate": "2027-02-16T00:00:00.000Z"
}
```

### Error responses

Model validation failures return `400` with a list of field messages:

```json
{
  "message": "Notice validation failed",
  "errors": [
    "Title must be at least 3 characters",
    "Content must be at least 10 characters"
  ]
}
```

Invalid IDs return `400` with `{"message":"Invalid notice ID"}`.
Missing notices return `404` with `{"message":"Notice not found"}`.
Casting errors return `400` with an invalid-field message. Malformed JSON
returns `400` with `{"message":"Request body must contain valid JSON"}`.
Unexpected errors return `500` with
`{"message":"An unexpected server error occurred"}`. Stack traces are logged
on the server, not included in these JSON responses.

### Frontend origin

The server uses `process.env.CLIENT_URL` for CORS. Configure it with your
frontend's exact origin, for example `http://localhost:5173`. If it is missing,
the server does not send CORS permission headers. CORS controls browser access;
it does not replace authentication or prevent other clients from calling routes.

### Admission email notifications

After a public admission application is saved, the backend attempts to send a
plain-text and HTML administrator notification through Resend. Configure these
optional variables in the backend environment:

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Resend API credential; keep it private. |
| `ADMISSIONS_NOTIFICATION_EMAIL` | Administrator recipient. |
| `ADMISSIONS_FROM_EMAIL` | Verified Resend sender address. |
| `CLIENT_URL` | Existing frontend origin setting used for CORS. |

The older names `ADMISSIONS_ADMIN_EMAIL` and `RESEND_FROM_EMAIL` are also
accepted as fallbacks.

If an email setting is missing or Resend is unavailable, the application stays
saved and the submission response reports `adminNotification` as `unavailable`
or `failed`. The request to Resend times out after eight seconds. The current
admin admissions view opens application details in a modal and has no direct
per-application URL, so notification emails do not include an unconfirmed link.

## Gallery API

Gallery images are stored in Cloudinary; MongoDB stores their secure URL,
Cloudinary public ID, caption, category, alt text, display order, and timestamps. The
public list is `GET /api/gallery?page=1&limit=20`, sorted by display order and
then newest first. Page defaults to 1 and limit to 20; limit is capped at 100.
The response is `{ items, pagination: { page, limit, total, totalPages } }`.

All gallery changes require an active administrator whose temporary password
has been changed. Send `Authorization: Bearer <token>` for these requests.

| Method | Path | Request | Success response |
| --- | --- | --- | --- |
| GET | `/api/gallery` | Optional `page`, `limit`, `category` query parameters | 200: `{ items, pagination }` |
| POST | `/api/gallery` | `multipart/form-data`: required `image` (PNG, JPEG, GIF, or WebP; max 5 MB), required `caption` and `category`; optional `altText`, `displayOrder` | 201: `{ item }` |
| PATCH | `/api/gallery/:id` | JSON subset of `caption`, `altText`, `displayOrder`, `category` | 200: `{ item }` |
| PATCH | `/api/gallery/:id/image` | `multipart/form-data`: required `image` file only | 200: `{ item }` |
| DELETE | `/api/gallery/:id` | No body | 200: `{ message, id }` |

`caption` is trimmed and limited to 1–300 characters. `altText` is optional,
trimmed, and limited to 300 characters. `displayOrder` is an integer from 0 to
100000 and defaults to 0. `category` must be exactly `Academics`, `Events`,
`Sports`, or `Campus`. The optional list category filter accepts the same values;
omit it to list all items. `All Photos` is a frontend filter label, not a category.
The public groupings are Academics (reading, friends, projects, group), Events
(award, community, friendship), Sports (sports, cricket), and Campus
(classroom, campus-concept, campus-view).
Unknown query/body fields are rejected. Write routes use the existing API rate
limit and administrator authentication.

Older MongoDB records without a category remain in unfiltered lists and are
returned with `category: null`; they are excluded from category-filtered results.
No category is inferred from captions or filenames. Review these records and
assign a category through `PATCH /api/gallery/:id`, or leave them uncategorized
until their category can be confirmed. New uploads must include a category.

Example upload fields (`multipart/form-data`): `image=<file>`,
`caption=Science project day`, `category=Academics`, `altText=Students presenting
a science project`, and `displayOrder=0`.

Example metadata update (`application/json`):

```json
{ "category": "Events", "caption": "Science fair awards" }
```

Errors use JSON with a `message`, and may include `code` or `errors`. Invalid
input or IDs return 400; missing records return 404; unauthorized requests
return 401 or 403; oversized uploads return 413; unavailable or failed image
storage returns 502 or 503; unexpected server errors return 500. If replacement
or deletion updates MongoDB but Cloudinary cleanup fails, the API returns an
explicit cleanup error and `cleanupPublicId` so the orphaned asset can be
removed manually. If creation or replacement fails to save in MongoDB, the
backend tries to remove the newly uploaded asset and reports its ID if cleanup
also fails.

Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
`CLOUDINARY_API_SECRET` in the backend environment. The server loads its `.env`
from the backend directory regardless of the shell's current directory. These
variables are optional at startup, but missing names are logged and gallery
write operations return `503` with code `CLOUDINARY_CONFIG_MISSING`. Restart the
backend after changing `.env`; never expose the API secret to the Vue app.
Uploads are sent by the backend over HTTPS to Cloudinary; image bytes are held
in memory only for the request and are not stored in MongoDB or written to
temporary files.

## Users API (admin)

All endpoints require `Authorization: Bearer <token>`, an active database admin
role, and `mustChangePassword: false`. Send JSON bodies with
`Content-Type: application/json`. No public registration, deletion, or role changes.

| Method | Path | Body | Success response | Error codes |
| --- | --- | --- | --- | --- |
| POST | `/api/users` | `name`, `role`, and `studentId` for students or `email` otherwise | 201: `{ user, temporaryPassword }` | 400 invalid input; 401; 403; 409 duplicate; 500 |
| GET | `/api/users` | None; query options below | 200: `{ users, page, limit, total, totalPages }` | 400 invalid query; 401; 403; 500 |
| PATCH | `/api/users/:id` | Optional `name`, and role-appropriate `email` or `studentId` | 200: `{ user }` | 400 invalid input/ID; 401; 403; 404 missing user; 409 duplicate; 500 |
| PATCH | `/api/users/:id/status` | `isActive`: Boolean | 200: `{ user }` | 400 invalid input/ID or self-status change; 401; 403; 404; 500 |
| POST | `/api/users/:id/reset-password` | None | 200: `{ user, temporaryPassword }` | 400 invalid ID or self-reset; 401; 403; 404; 500 |

List query parameters:

- `role`: admin, teacher, student, or parent.
- `search`: literal, case-insensitive search across name, email, and studentId;
  trimmed and at most 50 characters. Regex special characters are escaped.
- `isActive`: string `true` or `false`.
- `page`: positive integer, default 1.
- `limit`: positive integer, default 20, maximum 50.

Unknown query parameters and array/object values return 400. Results sort by
createdAt descending, then _id descending for ties. Empty pages return an empty
users array. List/count queries are separate; concurrent changes can affect totals.

Creation ignores other body fields and enforces active accounts with a required
password change. Updates ignore role, account status, password fields, and the
identifier that does not apply to the user's role. Responses never include hashes.
Validation errors return 400 with field messages; duplicate identifiers return
409 with `Email already in use` or `Student ID already in use`.

Temporary passwords are returned once on creation/reset and stored only as hashes.
These responses use `Cache-Control: no-store`. If lost, generate a new password
through reset; never recover the previous plaintext.

Reset does not revoke existing JWTs. Strict protection blocks normal routes while
mustChangePassword is true, but `/api/auth/me` and password change remain accessible.
Old tokens can regain normal access after the password is changed. Production
requires token-version or equivalent revocation checks.

Admins cannot change their own status or reset their own passwords. With immutable
roles and no deletion, sequential requests preserve an active admin. Concurrent
mutual deactivation needs additional transaction/serialization protection.

## Security

### Rate limits

| Requests | Limit | Window | Counting behavior |
| --- | ---: | --- | --- |
| All `/api` requests | 300 per IP | 15 minutes | All requests count |
| `POST /api/auth/login` | 20 per IP | 15 minutes | Successful requests are skipped |
| `POST /api/auth/login` | 5 per IP and normalized identifier | 15 minutes | Successful requests are skipped |
| `PATCH /api/auth/change-password` | 5 per IP | 15 minutes | Successful requests are skipped |

Rate limits use an in-memory store. Counts reset when the server restarts, and
each server instance keeps separate counts. A school sharing one public IP may
also share the per-IP limits, so many students or staff could reach them sooner.

### CORS and proxy settings

CORS allows browser origins listed in `CLIENT_URL`, separated by commas. It
allows requests without an `Origin` header, and disallowed origins receive no
CORS permission headers. CORS is not authentication.

Leave `TRUST_PROXY` empty locally. Set it to `1` on Render when the app is behind
Render's hosting proxy; this lets Express use the forwarded client IP for rate
limits. Do not enable proxy trust when the app is directly reachable, because a
client could spoof the forwarded IP header.

### Authentication limits

JWTs cannot be revoked before they expire. The authentication token lives in the
browser's `localStorage`, so scripts running on that site can access it.
