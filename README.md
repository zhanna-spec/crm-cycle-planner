# CRM Studio

A visual builder for iGaming CRM conversion cycles, plus competitor research.

**Cycle builder.** Drag channels (email, SMS, push, popup, mission, call) onto a day-by-day timeline, set who gets each step and what offer it carries, and keep several cycles side by side. Start blank or from suggested steps.

**Competitor review.** Organised by casino. Each casino has a profile with an Overview, its Offers, Bonus terms side by side, Gamification (loyalty / VIP, missions, tournaments, store), Market, Payments and Other. **All casinos** compares the main facts in one table.

**Site scanner extension.** Researches a casino's website in your own browser (logged out or logged in, through your VPN): it reads the main pages and footer, opens every promotion, and CRM Studio builds the casino's profile from it. Install: [extension/README.md](extension/README.md).

**Competitor emails.** Register on competitor sites with a research Gmail address. A small Apps Script in that account ([setup guide](inbox-collector/README.md)) shares the emails with the planner, which places each one on "day N after registration", has Claude summarise the sequence, and can add it to the builder as a cycle.

The AI features (reading screenshots, summarising emails) run through the same Google Apps Script, which holds your Anthropic API key in its script properties. The key never reaches the website or the browser. Without it you can still add offers by hand.

**Login and workspaces.** Optional sign-in with an email code, invite-only, with a workspace for your team and one per client, saved in Supabase. Setup: [supabase/README.md](supabase/README.md). Until it's set up, everything is saved in your browser; use Export / Import to back up or share.

`src/app.html` is the source; `./build.sh` builds `index.html` for GitHub Pages.
