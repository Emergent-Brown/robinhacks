# Poster NFC links

Write a different HTTPS URL to each tag: `https://emergenthacks.com/1`, `/2`, `/3`, etc. Numbers 1–99999 work without registration. Use ordinary digits without leading zeroes. Keep a separate list of each poster's number and campus location.

Opening a numbered link sends a request to the server. It increments that poster's Firestore counter, then returns a temporary redirect to `https://emergenthacks.com/`. No sign-in or JavaScript is needed. The number disappears from the address bar. Both the redirect and its response are non-cacheable, so future visits reach the server again.

## Read the counts

Sign in as an approved organizer on the production site, open **Admin → Posters**, and select **Refresh counts**. Each row shows the poster number, NFC URL, visit count and last visit. Rows appear after their first counted visit and are sorted numerically, in pages of 100. The URLs are displayed as text to avoid adding visits by accidentally clicking them in the dashboard. The browser-local demo does not load production statistics.

A count represents a visit, not a unique visitor or verified physical NFC scan. Opening a shared link and revisiting the same tag count again. HEAD requests, declared prefetches and common crawler/link-preview user agents are excluded. This filtering is best effort; other automated traffic can still count.

## Storage and access

`posterVisits/{number}` stores three fields: `number` (integer), `visits` (integer), and `lastVisitedAt` (Firestore server timestamp). It is site-wide and separate from competition state and event exports. Each accepted visit performs one atomic increment/write; simultaneous visits cannot replace each other's counts. No visitor IDs, cookies, IP addresses, user agents or individual visit records are stored in this collection. Standard hosting and function infrastructure may retain request logs.

Clients cannot directly read or write this collection under the existing deny-by-default Firestore rules. The `posterStats` callable checks approved, separate organizer membership in the configured main event before reading any counts. `POSTER_EVENT_ID` defaults to `robinhacks-2026`; an organizer role in another event gives no access.

## Operation

The numeric Hosting rewrite precedes the SPA fallback and routes to `posterVisit` in `us-west1`. Static assets and the regular homepage keep their existing routes. Deploy Functions before or together with Hosting:

```sh
npm run check
npx firebase-tools deploy --only functions:posterVisit,functions:posterStats,hosting --project robinhacks-2026-ajs
```

The public redirect uses zero warm instances and at most two instances. Per-instance limits permit 120 counted requests per IP per minute and 600 total per minute. These are burst controls, not a hard billing cap or unique-visitor measurement. Rate-limited requests still redirect but are not counted. IPs are used only in the temporary in-memory limiter.

If the counter fails or takes more than four seconds, the redirect proceeds. A timed-out write may still complete; it is not retried by the handler. Counts can under-report during outages or heavy bursts. Check function warnings for `Poster counter unavailable` when diagnosing tracking failures. Do not put a permanent redirect or cache in front of numbered paths: that would bypass future counting.

## Validation

Tests cover path validation, repeated visits, write-before-redirect ordering, uncacheable responses, HEAD/preview exclusion, POST rejection, failure/timeout redirects, and organizer authorization. Emulator tests verify concurrent atomic increments, numeric pagination and denied direct reads/writes for every client role. A production smoke check uses an unused high-numbered poster and removes only its own temporary record afterward, preserving real poster counts.
