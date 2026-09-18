# Emergency package

This ZIP is the **Emergency Accountability dashboard**.

Your existing Emergency UI, local `app` tables, emergency sessions, rescue-team
records, and logs remain in this project. The backend source-data reads in
`server.js` now call these People Accounting endpoints instead of querying the
personnel-source database directly:

- `GET /api/v1/emergency/population`
- `GET /api/v1/emergency/mustering`
- `GET /api/v1/emergency/personnel`

Before starting this app, copy `.env.example` to `.env` and set
`PEOPLE_API_BASE_URL` and `PEOPLE_API_KEY`. The key is used only by `server.js`
and is never sent to the browser.
