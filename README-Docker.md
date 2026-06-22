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

To replace an existing container:

```bash
docker rm -f emergency-dashboard
docker run --env-file .env -p 5053:5053 --name emergency-dashboard emergency-dashboard
```

View Logs:

```bash
docker logs -f emergency-dashboard
```

Stop the container:

```bash
docker stop emergency-dashboard
```
