# Docker usage

Build the image:

```bash
docker build -t emergency-dashboard .
```

Run the container:

```bash
docker run --env-file .env -p 5053:5053 --name emergency-dashboard emergency-dashboard
```

Open in browser:

```text
http://SERVER_IP:5053
```

For local testing:

```text
http://localhost:5053
```

To replace an existing container:

```bash
docker rm -f emergency-dashboard
docker run --env-file .env -p 5053:5053 --name emergency-dashboard emergency-dashboard
```

View logs:

```bash
docker logs -f emergency-dashboard
```

Stop the container:

```bash
docker stop emergency-dashboard
```

Using Docker Compose:

```bash
docker compose up -d --build
```

Stop Docker Compose:

```bash
docker compose down
```
