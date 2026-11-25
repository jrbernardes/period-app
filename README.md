# Luna – private cycle diary

Mobile-first web app (installable PWA, English + Português) for tracking a menstrual cycle:
daily log (flow, feelings, body, energy, desire, notes), calendar, and predictions of
fertile window, ovulation, "sensitive days" (PMS) and next period, with a daily
"what to expect" guide (more emotional, needy, disappointed, sexy, energetic…).

Zero dependencies: Node ≥ 18 only.

```bash
npm start            # http://localhost:3000
npm test             # prediction-logic unit tests
```

**Test login:** `jenni` / `bonequinha` (created on first start).
Change/add users: `node scripts/set-password.js <user> <password>`.

## How it works
- `public/cycle.js` – prediction engine (avg of last 6 cycles, ovulation ≈ 14 days before next period, late-period handling, hormone-based tendency curves).
- `public/i18n.js` – phase knowledge base and translations.
- `server.js` – login (scrypt, signed HttpOnly cookie, rate-limited) + per-user JSON storage.
- Data is saved on the phone first (works offline) and synced to the server; the newest copy wins, so a free host that wipes its disk is restored from the phone on next open.

## Hosting
Needs a Node host (static-only hosting can't do the login). Free options:
- **Render** (free web service, sleeps when idle ~30–60 s first load): `render.yaml` included, New → Blueprint.
- **Koyeb / Fly.io / Railway**: use the included `Dockerfile`.
- Home PC / Raspberry Pi + Tailscale or Cloudflare Tunnel (free, data stays at home).
Set `SESSION_SECRET` in production, and change the test password.

Not medical advice; not a contraceptive.
