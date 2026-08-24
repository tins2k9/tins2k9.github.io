name: Scrape Shopee GPU prices

# GitHub Pages only serves static files — it can't run scrape-shopee.js on
# its own. This workflow is what actually runs it: on a schedule, GitHub
# spins up a temporary Linux runner, executes the script with Node, and if
# gpu-prices.json changed, commits it back into this repo. Once it's in the
# repo, GitHub Pages serves it like any other file and index.html can fetch
# it as usual.

on:
  schedule:
    # Runs every 3 hours. Cron is in UTC — adjust if you want a different
    # cadence, but keep it infrequent (see the caveats in scrape-shopee.js).
    - cron: "0 */3 * * *"
  workflow_dispatch: {} # lets you click "Run workflow" manually on GitHub to test

permissions:
  contents: write # needed so the workflow can commit gpu-prices.json back

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repo
        uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Run scraper
        run: node scrape-shopee.js

      - name: Commit gpu-prices.json if it changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add gpu-prices.json
          git diff --quiet --cached || git commit -m "chore: update gpu-prices.json [skip ci]"
          git push
