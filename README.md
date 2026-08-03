# Emergency Accountability Dashboard

## Requirements

- Docker Desktop
- Access to the PostgreSQL database used by the application

The PostgreSQL database and required tables in the `app` schema must already exist before starting the dashboard.

## 1. Configure the Environment File

Create a file named `.env` in the main project folder:

```env
DB_HOST=host.docker.internal
PORT=your_app_port
DB_NAME=your_database_name
DB_PASSWORD=your_database_password
DB_USER=postgres
DB_PORT=your_database_port
APP_PORT=your_app_port
APP_PASSWORD=your_dashboard_passcode
TZ=Asia/Manila


```

Replace the example database values with the correct credentials. Do not add spaces around the `=` signs.

## 2. Start the Application

Open PowerShell or Command Prompt in the project folder, then run:

```powershell
docker compose up -d --build
```

Wait for Docker to finish building and starting the application.

## 3. Open the Dashboard

On the computer running Docker:

```text
http://localhost:5053
```

From another computer on the same network:

```text
http://SERVER_IP:5053
```

Replace `SERVER_IP` with the IP address of the computer running Docker.

## Check Application Status

```powershell
docker compose ps
```

## View Application Logs

```powershell
docker compose logs -f
```

Press `Ctrl + C` to stop viewing the logs. This does not stop the application.

## Restart After Making Changes

Use these commands after changing `.env` or replacing application files:

```powershell
docker compose down
docker compose up -d --build --force-recreate
```

## Stop the Application

```powershell
docker compose down
```
