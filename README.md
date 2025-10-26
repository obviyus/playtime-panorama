# playtime-panorama

![Screenshot of playtime-panorama](screenshot.jpg)

Generate a dense, responsive collage of your Steam library where each header image tile is sized by the playtime.

## What the app does
- Fetches publicly visible Steam playtime data from `IPlayerService/GetOwnedGames`.
- Scales every game's header image by actual hours played, so long-haul favorites dominate the collage.
- Arranges the artwork into a responsive CSS grid that reflows to match any viewport size.
- Generates a [leaderboard](https://playtime-panorama.superserio.us/leaderboard) of the top profiles (game count, hours played, hours / game average).

## Quick start

Grab a Steam API key from https://steamcommunity.com/dev/apikey.

```bash
bun install
STEAM_API_KEY=ABCDEFGH... bun run dev
```

Visit `http://localhost:3000/<your-steam-id>` and the server will fetch, normalize, and render the responsive grid layout on the fly.

The server caches responses for up to 24 hours for playtime data and indefinitely for `ISteamUser/ResolveVanityURL` to avoid hitting the API repeatedly (Steam provides [100K req/day](https://steamcommunity.com/dev/apiterms))


## How the packing logic works
The collage is laid out by `computeGridLayout` in `templates/profile.html`, and it behaves like a self-tuning CSS Grid packer:

- **Hours drive span weights.** Each game’s hours are transformed into an area weight using a softened power curve (`(hours + 0.1)^0.62`) so outliers still feel big without flattening mid-tier favorites. The largest weight sets the scale for every other tile.
- **Span-first sizing.** The algorithm starts with a target column count (based on viewport width and desired card width), computes a column width, and then converts the weighted area into square grid spans (from 1×1 up to a capped 12×12 tile). High-playtime titles claim larger spans; the top few entries are boosted to anchor the grid.
- **Height-aware column search.** Before locking a layout, the code estimates overall grid height. If the grid would overflow the viewport, it increases the column count; if it leaves too much empty space, it trims columns. This loop runs a handful of times so the final grid sits neatly in the visible stage.
- **Row sizing + CSS handoff.** With the chosen column count, `--columns` and `--row-size` are written to CSS variables, and the DOM simply flows cards into place. Hover states and tooltips are handled purely in CSS for smooth rendering.

Apart from a few type packages, this app uses no external dependencies. Everything runs off of Bun's in-built APIs on the server and the frontend is intentionally a simple, HTML file without React or Tailwind. I wanted a performant, minimal dependency approach for this project.

## Limitations & quirks
- Games with less than 10 minutes of lifetime playtime are skipped.
- Family sharing libraries are not exposed by Steam's API in `GetOwnedGames`.
- Dota 2 has an unusual licens. It _seems_ to only appears in the API response when the game is currently installed but I couldn't verify it thoroughly.

## Why I built this
I was reading the patch notes for [Bun 1.3](https://bun.com/blog/bun-v1.3) (♥) where they talk about Bun being a "Full‑stack JavaScript runtime". I really wanted to see how far I can get with only Bun's in-built APIs.

Plus, it's fun.

Contributions are welcome!
