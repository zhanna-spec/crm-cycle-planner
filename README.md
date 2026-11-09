# Conversion Cycle Planner

A visual builder for iGaming CRM conversion cycles, plus a competitor offer tracker.

**Cycle builder.** Drag channels (email, SMS, push, popup, mission, call) onto a day-by-day timeline, set who gets each step and what offer it carries, and keep several cycles side by side. Start blank or from suggested steps.

**Competitor offers.** Drop screenshots of a competitor's welcome offer and terms. Claude reads them and fills in the match, max bonus, free spins, wagering, minimum deposit, max bet, expiry and other conditions, and flags anything it couldn't read clearly. Offers are compared side by side with your own.

Reading screenshots needs your own Anthropic API key, entered on the page. It is stored only in your browser and sent only to Anthropic. Without a key you can still add offers by hand.

Everything is saved in your browser; use Export / Import to back up or share.

`src/app.html` is the source; `./build.sh` builds `index.html` for GitHub Pages.
