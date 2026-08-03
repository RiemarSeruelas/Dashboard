# Emergency Accountability Dashboard

The Emergency Accountability Dashboard helps authorized response teams monitor personnel during an emergency or evacuation. It provides one live view of who has been accounted for, who may still be at risk, and how the response is progressing.

## Who Should Use This Dashboard

- Emergency coordinators and incident commanders
- Safety, health, and environment personnel
- Rescue team members
- Authorized personnel responsible for employee accountability

## Main Features

- Live personnel monitoring
- Manual emergency start and stop
- Automatic emergency scheduling
- Safe and Not Safe accountability tracking
- Automatic mustering-scan checking
- Manual status updates for confirmed personnel
- Rescue team monitoring
- Emergency history and analytics
- Session export for reporting
- Passcode-protected access

## Dashboard Pages

| Page | Purpose |
| --- | --- |
| **Personnel** | View, search, and filter personnel currently identified as being inside the building. |
| **Rescue** | Review rescue-team members and their current availability or location status. |
| **Analytics** | View accountability totals, progress, and department-level summaries. |
| **History** | Review completed emergency sessions and export available records. |

## How to Use the Dashboard

### 1. Sign In

Open the dashboard and enter the authorized passcode.

### 2. Review Personnel

Before starting an emergency, confirm that the Personnel page has loaded the current personnel information. Use search or department filters when needed.

### 3. Start or Schedule an Emergency

You may start an emergency immediately or schedule one for a specific Start and Finish time.

When an emergency begins:

1. The system creates a new emergency session.
2. It captures the personnel currently identified as being inside the building.
3. Every tracked person begins as **Not Safe**.
4. The dashboard begins checking for accountability updates.

Only one emergency can be active at a time. Scheduled time ranges cannot overlap, although one schedule may start at the exact time another one finishes.

### 4. Monitor Accountability

During an active emergency:

- **Not Safe** means the person has not yet been confirmed at the mustering location.
- **Safe** means the person has been confirmed through a qualifying mustering scan or has been manually marked Safe by an authorized operator.
- Ordinary entrance scans do not mark a person Safe.
- A person may be manually returned to Not Safe if a correction is required.

The dashboard refreshes automatically, but a newly received scan may take a short time to appear.

### 5. Use the Rescue View

Open the Rescue page to review rescue personnel and support the response team's coordination. The lists and counts update as accountability information changes.

### 6. Stop the Emergency

Stop the active emergency after accountability operations are complete. The completed session remains available in History and Analytics.

### 7. Review the Session

Use History to open a completed session. Use Analytics to review totals and progress, and use the available export function when a report is needed.

## Important Rules

- Everyone starts as **Not Safe** when a new emergency begins.
- Only a qualifying mustering scan during the active emergency can automatically mark a person Safe.
- Entrance scans never count as mustering confirmation.
- Manual Safe or Not Safe changes should only be made after operational confirmation.
- Scheduled emergencies run automatically while the application service is running; the browser does not need to remain open.
- The dashboard uses Manila time.

## Reminders and Useful Facts

- The PostgreSQL server clock is currently approximately four hours behind Manila time. The dashboard compensates for this when checking scheduled emergency Start and Finish times.
- This compensation does not change the database clock. Some timestamps created directly by PostgreSQL may still appear approximately four hours earlier than Manila time.
- Scheduled emergencies can start and finish automatically even when the dashboard is closed, as long as the application is running in Docker.
- A qualifying mustering scan may take a short time to appear because the source system and dashboard synchronize periodically.
- Every new emergency begins with all tracked personnel marked **Not Safe**. Only a qualifying mustering scan or an authorized manual update can mark someone **Safe**.
- Entrance scans never count as mustering confirmation.

## Running the Dashboard with Docker

This section is for the person responsible for starting the dashboard computer.

### Requirements

- Docker Desktop
- Access to the PostgreSQL database used by the application
- The project folder, including `docker-compose.yml`
- A configured `.env` file

### Configure `.env`

Create `.env` in the main project folder and enter the deployment values provided by the system owner:

```env
DB_HOST=host.docker.internal
DB_PORT=your_database_port
DB_NAME=your_database_name
DB_USER=your_database_user
DB_PASSWORD=your_database_password
PORT=your_app_port
APP_PORT=your_app_port
APP_PASSWORD=your_dashboard_passcode
TZ=Asia/Manila
```

### Start the Application

Open PowerShell or Command Prompt in the project folder, then run:

```powershell
docker compose up -d --build
```

### Open the Dashboard

On the computer running Docker:

```text
http://localhost:your_app_port
```

From another computer on the same network:

```text
http://SERVER_IP:your_app_port
```

Replace `SERVER_IP` with the IP address of the computer running Docker and `your_app_port` with the configured application port.

### Check the Application

```powershell
docker compose ps
```

The application should show as running or healthy.

### Restart the Application

Use this after changing `.env` or replacing application files:

```powershell
docker compose down
docker compose up -d --build --force-recreate
```

### Stop the Application

```powershell
docker compose down
```

## Basic Troubleshooting

### The Dashboard Does Not Open

Check whether the application is running:

```powershell
docker compose ps
```

View the latest application messages:

```powershell
docker compose logs --tail=100
```

### A Scheduled Emergency Does Not Start

- Confirm that the application is running.
- Confirm that the scheduled time has not already passed.
- Confirm that its time range does not overlap another schedule.

### A Mustering Scan Does Not Mark Someone Safe

- Confirm that an emergency is active.
- Confirm that it was a mustering scan, not an entrance scan.
- Wait briefly for the source system and dashboard to synchronize.
- Confirm that the scanned employee matches the person in the emergency list.

### Database Connection Error

Contact the system owner or database administrator to verify the database connection details in `.env` and confirm that the database is reachable.

## Security

- Share the dashboard passcode only with authorized personnel.
- Do not expose the database directly to untrusted networks.
- Sign out when the dashboard is no longer being used.
