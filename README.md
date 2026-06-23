# Emergency Accountability Dashboard

## Requirements

Install the following first:

- Node.js (includes npm)
- PostgreSQL access (database credentials required)
- Git (optional)

---

# Setup

## 1 Install Dependencies

Open terminal in the project folder:

```bash
npm install
```

---

## 2 Configure Environment File

Copy:

```bash
.env.example
```

Create:

```bash
.env
```

Update database settings:

```env
PORT=5000
DB_HOST=your_server
DB_PORT=5432
DB_NAME=your_database
DB_USER=your_user
DB_PASSWORD=your_password
```

---

## 3 Build Application

```bash
npm run build
```

---

## 4 Start Application

```bash
npm start
```

Application runs at:

```txt
http://localhost:5000
```

---

# How to Use

## Login
Open the application and enter the passcode.

---

## Personnel Page
Use to:
- View current personnel
- Search employees
- Filter by department
- Monitor personnel count

---

## Start Emergency
Press **Start** to begin emergency accountability.

System captures current personnel snapshot.

---

## Rescue / Accountability
Use to:
- Mark personnel Safe
- View remaining Not Safe personnel
- Track accountability progress

---

## Analytics
View:
- Total tracked
- Safe count
- Not Safe count
- Emergency summary

---

## History
Use to:
- View past emergency sessions
- Open session details
- Export records to Excel

---

## Stop Emergency
Press **Stop** to close and save the session.

---

## Logout
Press Logout to return to passcode page.

---

# Typical Startup

```bash
npm start
```

If frontend changes were made:

```bash
npm run build
npm start
```

---

# Troubleshooting

## Cannot find package express

Run:

```bash
npm install
```

## Cannot GET /passcode

Run:

```bash
npm run build
npm start
```

## Database connection error
Verify `.env` credentials and PostgreSQL access.
