# Feature 3: Admissions

> Draft plan. Fields marked (CONFIRM) must be checked against the real
> form in ApplicationPortalView.vue (see the audit step). Edit anything you
> disagree with, then paste this into your backend notes. After the AI
> planning step, fill in the "Final agreed plan" section at the bottom.

---

## 1. Goal

Replace the `mailto:` admission form with a real application that is saved in
MongoDB. Admins review applications in the dashboard and track each one
through a simple status workflow.

## 2. Scope of the first version

| In scope                                               | Out of scope (later)                                  |
| ------------------------------------------------------ | ----------------------------------------------------- |
| Online admission application (public form)             | Recruitment / job applications (needs CV file upload) |
| Reference number shown after submitting                | File uploads (birth certificate, photo)               |
| Admin list, detail view, status change, internal notes | Public "check my application status" page             |
| New-application count on the admin overview            | Online payment of admission fees                      |
|                                                        | Email or SMS notification (optional step BA4)         |

## 3. Who can do what

| Role                     | Submit         | View list / detail | Change status, add notes |
| ------------------------ | -------------- | ------------------ | ------------------------ |
| Public visitor           | Yes (no login) | No                 | No                       |
| Admin                    | n/a            | Yes                | Yes                      |
| Teacher, student, parent | n/a            | No                 | No                       |

An "admission officer" role can be added later by adding a role value.

## 4. Data an application needs (CONFIRM against the real form)

**Applicant**
| Field | Type | Required | Notes |
|---|---|---|---|
| studentName | String | Yes | 2 to 100 characters |
| dateOfBirth | Date | Yes | Must be a past date and a plausible age (3 to 25 years) |
| gender | String | No | male / female / other |
| applyingForClass | String | Yes | One of the class values the form offers (Class 1 to 12) |
| academicSession | String | Yes | Example: "2027" |
| previousSchool | String | No | Max 150 characters |

**Guardian**
| Field | Type | Required | Notes |
|---|---|---|---|
| guardianName | String | Yes | 2 to 100 characters |
| relationship | String | Yes | father / mother / other |
| phone | String | Yes | Bangladesh mobile, normalised to `01XXXXXXXXX` (11 digits) |
| email | String | No | Lowercased, must look like an email |
| address | String | No | Max 300 characters |

**Other**
| Field | Type | Notes |
|---|---|---|
| message | String | Optional, max 1000 characters |
| consent | Boolean | Must be true. Stored with the date. |
| language | String | "en" or "bn", the language the form was filled in |
| reference | String | Generated, unique, random (example `ADM-2027-K7M3Q9`). Never sequential. |
| status | String | See section 6 |
| internalNotes | Array | Each: text, author (User), createdAt. Admin only. |
| statusHistory | Array | Each: status, changedBy (User), changedAt |
| createdAt / updatedAt | Date | Automatic |

## 5. Endpoints (draft)

| Method | Path                         | Access | Purpose                                                             |
| ------ | ---------------------------- | ------ | ------------------------------------------------------------------- |
| POST   | /api/applications            | Public | Submit an application. Returns only `{ reference }`.                |
| GET    | /api/applications/stats      | Admin  | Counts by status (for the overview tile). Registered before `/:id`. |
| GET    | /api/applications            | Admin  | List with filters: status, class, session, search, page, limit      |
| GET    | /api/applications/:id        | Admin  | Full detail                                                         |
| PATCH  | /api/applications/:id/status | Admin  | Change status                                                       |
| POST   | /api/applications/:id/notes  | Admin  | Add an internal note                                                |

No delete endpoint in version 1. A withdrawn or rejected application keeps
its record.

## 6. Status workflow

```
new -> contacted -> test_scheduled -> accepted
                                   -> waitlisted
                                   -> rejected
(any status) -> withdrawn
```

For the demo, an admin may move an application to any status. Every change is
saved in `statusHistory`.

## 7. Public submission rules (this is an open door, so be strict)

- Validate every field on the server, with types checked (strings only).
- Honeypot field: a hidden field that humans leave empty. If it is filled,
  return a fake success and save nothing.
- Rate limit: 5 submissions per hour per IP (a school Wi-Fi shares one IP, so
  keep it generous enough for a real family).
- Duplicate guard: same phone + student name + class + session within 24 hours
  returns the existing reference instead of creating a second record.
- Body size stays under the global 50 kb limit.
- The response never repeats personal data.
- Phone numbers and dates are normalised on the server.
- Consent must be `true`.

## 8. Privacy (this is data about children)

- Collect only what the school needs to process an application.
- Only admins can read applications. Never log request bodies.
- Do not show date of birth or address in the list, only in the detail view.
- A consent checkbox links to the Privacy Policy page.
- Decide a retention period (example: delete unaccepted applications after 12
  months) and write it in the Privacy Policy.
- Use HTTPS in production, and a strong admin password.

## 9. Frontend plan

1. `ApplicationPortalView.vue` (admission mode) submits to the API instead of
   building a `mailto:` link. Keep the existing look, fields, and translations.
   Show the reference number on success, with loading, validation, and error
   states.
2. Admin page `/dashboard/applications`: filters, table (cards on mobile),
   pagination, a detail dialog, status change, internal notes.
3. Admin overview shows the number of "new" applications.
4. Recruitment mode keeps the `mailto:` flow until a later feature.

## 10. Notification gap (important)

With `mailto:` the school received an email. After this change the school
only sees an application if an admin opens the dashboard. Plan:

- Version 1: a "New" count on the admin overview and sidebar.
- Optional step BA4: an email to the school office for each new application.
  This needs an email service and a new package, so it is a separate step.

## 11. Build order

Backend (branch `feature/admissions`):
BA1 model -> BA2 public submit endpoint -> BA3 admin endpoints -> (BA4 optional email)

Frontend (branch `feature/admissions-ui`):
FA1 connect the public form -> FA2 admin applications page -> FA3 overview count and polish

## 12. Decisions I made

- Admissions only in version 1. Recruitment later.
- No file uploads in version 1.
- No delete endpoint. Retention period: (decide)
- Status check page for families: not in version 1.

---

## Final agreed plan (fill this in after the AI planning step)

### Final schema

(paste here)

### Final endpoints

(paste here)

### Changes I made to the draft and why

-
-

### Things I don't understand yet

-
-
