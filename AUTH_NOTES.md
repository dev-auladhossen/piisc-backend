# Feature 2: Authentication and Roles

> Draft plan. Edit anything you disagree with, then paste it into NOTES.md
> (or keep it as AUTH_NOTES.md). After the AI planning step, fill in the
> "Final agreed plan" section at the bottom.

---

## 1. Goal

Public visitors see the website. A "Login" button in the navbar opens a modal.
After logging in, the user is redirected to a dashboard that matches their role.

## 2. Roles (exactly 4 for the demo)

| Role    | Who                           | Logs in with                         |
| ------- | ----------------------------- | ------------------------------------ |
| admin   | Office / administration staff | Email                                |
| teacher | Teaching staff                | Email                                |
| student | Enrolled students             | Student ID (example: PIISC-2027-001) |
| parent  | Parents / guardians           | Email                                |

- One role per user (no multiple roles for now).
- Principal and accountant roles can be added later by adding a role value.

## 3. Account rules

- **No public registration.** Only an admin creates accounts.
- The admin creates a user, and the system generates a temporary password
  (shown to the admin once).
- On first login the user must change the password (`mustChangePassword: true`).
- Admin can deactivate a user (`isActive: false`). Deactivated users cannot log in
  and are blocked immediately on their next request.
- The first admin is created by a seed script, with email and password from `.env`.

## 4. Login rules

- The login form has one field: "Email or Student ID", plus a password.
- Backend finds the user by email (lowercased) or studentId (uppercased).
- Any failure (unknown user, wrong password) returns the same message:
  "Invalid credentials".
- Inactive user: cannot log in.
- Response: JWT token + user object (never the password hash).

## 5. Token rules

- JWT payload: user id and role only.
- Expiry: 1 day.
- Frontend sends: `Authorization: Bearer <token>`.
- The `protect` middleware verifies the token AND reloads the user from the
  database (so deactivated users are blocked at once).
- Frontend storage for the demo: localStorage. (Production upgrade: httpOnly cookie.)

## 6. User data (User collection)

| Field              | Type    | Notes                                                  |
| ------------------ | ------- | ------------------------------------------------------ |
| name               | String  | required                                               |
| role               | String  | admin / teacher / student / parent                     |
| email              | String  | required for admin, teacher, parent; unique; lowercase |
| studentId          | String  | required for student; unique; uppercase, trimmed       |
| passwordHash       | String  | bcrypt hash; never returned in responses               |
| isActive           | Boolean | default true                                           |
| mustChangePassword | Boolean | default true for admin-created users                   |
| lastLogin          | Date    | updated on login                                       |
| timestamps         | auto    | createdAt, updatedAt                                   |

Role-specific profile data (class, subjects, children) goes in separate
collections later, not in User.

## 7. Endpoints (draft)

| Method | Path                          | Access    | Purpose                                           |
| ------ | ----------------------------- | --------- | ------------------------------------------------- |
| POST   | /api/auth/login               | Public    | Log in, get token                                 |
| GET    | /api/auth/me                  | Logged in | Current user (used to restore session on refresh) |
| PATCH  | /api/auth/change-password     | Logged in | Change own password                               |
| POST   | /api/users                    | Admin     | Create user (returns temporary password once)     |
| GET    | /api/users                    | Admin     | List users (filter by role, search)               |
| PATCH  | /api/users/:id                | Admin     | Update user details                               |
| PATCH  | /api/users/:id/status         | Admin     | Activate or deactivate                            |
| POST   | /api/users/:id/reset-password | Admin     | New temporary password                            |

Rules: admin cannot deactivate themselves. No endpoint ever returns passwordHash.

## 8. Frontend flow

1. Navbar shows "Login" when logged out, or the user's name + Logout when logged in.
2. Login opens a modal. On success, redirect by role:
   - admin -> /dashboard/admin
   - teacher -> /dashboard/teacher
   - student -> /dashboard/student
   - parent -> /dashboard/parent
3. Protected route without a token: go to home with `?login=1&redirect=<path>`
   so the modal opens, then return to that path after login.
4. If `mustChangePassword` is true, show a change-password modal that cannot
   be dismissed until done.
5. On page refresh, call `/auth/me` to restore the session.
6. On a 401 response: clear the session and open the login modal.
7. Vue route guards are for user experience only. The backend enforces security.

## 9. Security checklist

- [ ] Passwords hashed with bcrypt, never stored or returned in plain text
- [ ] Same error message for wrong ID and wrong password
- [ ] Login route rate-limited
- [ ] JWT_SECRET is long, random, and only in .env
- [ ] isActive checked on login and on every protected request
- [ ] Admin routes behind protect + authorize('admin')
- [ ] No stack traces sent to the client
- [ ] CORS limited to CLIENT_URL

## 10. Build order

B1 User model -> B2 seed admin -> B3 login -> B4 middleware + /me ->
B5 change password -> (frontend F1-F5) -> B6 admin user routes -> F6 admin users page ->
B7 hardening -> B8 protect other features -> F7 polish.

## 11. Decisions I made

- Parents log in with email.
- Student ID format: PIISC-YYYY-NNN (example: PIISC-2027-001)
- Admin seed email: (set in .env as SEED_ADMIN_EMAIL)

---

## Final agreed plan (fill this in after the AI planning step)

### Final User schema

(paste here)

### Final endpoints

(paste here)

### Changes I made to the draft and why

-
-

### Things I don't understand yet

-
-
