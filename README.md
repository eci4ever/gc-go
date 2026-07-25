# gc-go

Go Fiber v3 API and React web app in one repository.

## Development

```sh
npm install
cd api && go mod download && cd ..
npm run dev
```

- API: `http://localhost:3000`
- Web: `http://localhost:5173`
- Browser API calls use `/api` and are proxied by Vite.

## Production

Build the web app and copy its output to the Caddy web root:

```sh
npm run build
sudo mkdir -p /var/www/gc-go
sudo cp -a web/dist/. /var/www/gc-go/
```

The included Caddyfile serves the static web build and proxies `/api/*` to
Fiber on `127.0.0.1:3000`.
