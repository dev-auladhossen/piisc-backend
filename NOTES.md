# PIISC School Backend: Project Notes

> Draft plan written before using AI. Edit anything you disagree with.
> After the AI planning step, update the "Final agreed plan" section at the bottom.

---

## Feature 1: Notices

### 1. Goal

Let the school publish notices (admission, events, holidays, exams, meetings)
and show them to visitors on the website.

### 2. Who can do what

| Role              | Read notices | Create | Edit | Delete |
| ----------------- | ------------ | ------ | ---- | ------ |
| Public visitor    | Yes          | No     | No   | No     |
| Student / Teacher | Yes          | No     | No   | No     |
| Admin             | Yes          | Yes    | Yes  | Yes    |

**Note:** Authentication is not built yet. For now, create/edit/delete routes
stay open. They will be protected with JWT + admin role in the auth step.
Mark these routes with a `TODO: protect with admin middleware` comment.

### 3. Data a notice needs

| Field                 | Type    | Required | Default   | Why it exists                                                     |
| --------------------- | ------- | -------- | --------- | ----------------------------------------------------------------- |
| title                 | String  | Yes      | n/a       | Headline shown in lists                                           |
| content               | String  | Yes      | n/a       | Full notice text                                                  |
| category              | String  | No       | "general" | For filtering (admission, event, holiday, exam, meeting, general) |
| isImportant           | Boolean | No       | false     | Highlight urgent notices on the home page                         |
| isPublished           | Boolean | No       | true      | Admin can save a draft without showing it publicly                |
| publishDate           | Date    | No       | now       | Date shown on the notice and used for sorting                     |
| expiryDate            | Date    | No       | null      | Hide old notices automatically (optional)                         |
| createdAt / updatedAt | Date    | Auto     | auto      | Added by Mongoose timestamps                                      |

**Later (not now):** attachment (PDF upload), createdBy (admin user id).

### 4. API endpoints (draft)

| Method | Path             | Purpose                              | Access (now) | Access (later) |
| ------ | ---------------- | ------------------------------------ | ------------ | -------------- |
| GET    | /api/notices     | List published notices, newest first | Public       | Public         |
| GET    | /api/notices/:id | Get one notice                       | Public       | Public         |
| POST   | /api/notices     | Create a notice                      | Open         | Admin          |
| PATCH  | /api/notices/:id | Update a notice                      | Open         | Admin          |
| DELETE | /api/notices/:id | Delete a notice                      | Open         | Admin          |

**Optional extras (only if time allows):**

- Filter by category: `GET /api/notices?category=event`
- Limit results: `GET /api/notices?limit=5` (for the home page)
- Pagination: `?page=1&limit=10`

### 5. Validation rules (draft)

- `title`: required, trimmed, 3 to 150 characters
- `content`: required, minimum 10 characters
- `category`: must be one of: general, admission, event, holiday, exam, meeting
- `expiryDate`: if given, must be after `publishDate`
- Invalid MongoDB `:id` should return 400, not crash the server

### 6. Edge cases to handle

- Invalid ID format -> 400 with a clear message
- Notice not found -> 404
- Empty or missing body on POST -> 400
- Database down or other error -> 500 with a safe message (no stack trace shown to users)
- Unknown fields in the body should be ignored

### 7. What the Vue pages will show

- **Home page:** latest 5 notices, important ones highlighted
- **Notices page:** full list with category filter buttons
- **Notice detail page:** full title, date, and content
- **Admin page (later):** form to create, edit, and delete notices

### 8. Build order (small steps, each tested in Postman)

1. Update the Notice model with the new fields
2. Improve GET all (sort, hide drafts and expired)
3. Add GET one by id
4. Improve POST with validation
5. Add PATCH update
6. Improve DELETE with 404 handling
7. Add a global error handler
8. Test everything in Postman
9. Connect the Vue pages
10. Update the README API docs

---

## Final agreed plan (fill this in after the AI planning step)

### Final schema

(paste here)

### Final endpoints

(paste here)

### Final build order

(paste here)

### Decisions I made and why

-
-

### Things I don't understand yet

-
-
