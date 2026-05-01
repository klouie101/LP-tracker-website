# LP Tracker

A liquidity pool profit-and-loss tracker for **Uniswap**, **Aerodrome**, and **Orca**.

Tracks deposits, current value, fees earned, APR, range status (in-range / out-of-range), and net profit per position. Includes portfolio totals, monthly fee estimates, CSV / Excel / PDF export, and CSV import.

## Run it

It's a static site — no build, no server, no install. Two ways:

1. **Open locally** — double-click `index.html`.
2. **Free hosting (GitHub Pages):**
   - Push this repo to GitHub.
   - In the repo on GitHub, go to **Settings → Pages**.
   - Under "Build and deployment" set Source = **Deploy from a branch**, Branch = **main** / root.
   - Your site will be live at `https://<your-username>.github.io/LP-tracker-website/`.

## Features

- Add / edit / delete / close / re-open positions
- Active vs Closed tabs
- Per-position: pair, protocol, chain, entry/exit datetime, deposited, current balance, bottom/top range, token amounts, fees (new + claimed + swap), scalp, notes
- Portfolio cards: Active Totals, Closed Totals, Monthly Estimate, Portfolio Total
- Auto-detected stables ($1) and live prices for non-stables via CoinGecko (no API key)
- Range tracking — flags out-of-range positions
- Import / Export CSV (Excel-compatible)
- PDF export via browser Print
- Local persistence (localStorage) — data stays in your browser

## Files

- `index.html` — markup
- `styles.css` — dark theme
- `app.js` — all logic

## Tokens supported for live prices

Common tokens auto-resolve via CoinGecko: BTC, WBTC, cbBTC, ETH, WETH, cbETH, SOL, ARB, OP, MATIC/POL, AERO, UNI, ORCA, LINK, AAVE, CRV, JUP, JTO, BONK, WIF, PYTH. For unsupported tokens, set the price manually in the position form.

Stables auto-priced at $1: USDC, USDT, DAI, USDe, PYUSD, FRAX, USDbC, USDS, USDC.e.
