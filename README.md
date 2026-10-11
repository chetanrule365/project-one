# Project One

Paper lab for Nifty, Bank Nifty, and Sensex: live playbook, paper trades, and backtests via Dhan. Shared state is MongoDB Atlas.

```bash
npm install
cp .env.example .env   # fill Dhan + MONGODB_URI
npm run dev            # http://localhost:5173
```

Enter the Dhan PIN on `/login`. Paper sync runs in the Node process.

```bash
npm run build
npm start
```

Railway: see `DEPLOY.md`. Atlas Network Access must allow `0.0.0.0/0`.
