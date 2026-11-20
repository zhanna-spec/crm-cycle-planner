# Site scanner extension

Scans a competitor's website in your own browser and sends the screenshots to CRM Studio. Claude then sorts every page into offers (welcome, 2nd deposit, reload…), tournaments and website content (homepage, registration, promotions, VIP…) and reads them, creating the cards for you.

Because it runs in your browser, it sees what you see: your VPN's country, and your login when you run it logged in. Nothing is sent anywhere except to the planner.

Works in Chrome, Edge and Brave. Only people who run scans need it; everyone in the workspace sees the results.

## Install (2 minutes)

1. Download **[scanner-extension.zip](https://zhanna-spec.github.io/crm-cycle-planner/scanner-extension.zip)** and unzip it. Keep the folder somewhere permanent, for example in Documents; the browser loads it from there.
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Switch on **Developer mode** (top right in Chrome, left side in Edge).
4. Click **Load unpacked** and choose the unzipped folder.
5. Click the puzzle icon in the toolbar and pin **CRM Studio Scanner**.

## Scan a site

1. Sign in to the planner once in the same browser.
2. Turn on your VPN if you need one, and open the operator's website. Accept cookies and confirm your age, so the site is ready.
3. Click the scanner icon. The sections of the competitor review are ticked: Homepage and the site menu, Promotions, Deposit (logged in), Loyalty / VIP, Tournaments, Missions and Store. More sections (sign-up, welcome offer, bonus terms…) are under **More (optional)**. Your ticks are remembered.
   - **Blur on screenshots**: email addresses are blurred automatically; add your username or name so they're blurred too. They're blurred on the page before each screenshot is taken.
   - **Open every promotion** is off by default. Tick it only when you want each offer's terms for the Offer terms tab.
4. Click **Load unpacked** and choose the unzipped folder.
5. Click the puzzle icon in the toolbar and pin **CRM Studio Scanner**.

## Scan a site

1. Sign in to the planner once in the same browser.
2. Turn on your VPN if you need one, and open the operator's website. Accept cookies and confirm your age, so the site is ready.
3. Click the scanner icon. It shows a checklist of sections to find: sign-up, deposit, promotions, tournaments, VIP/loyalty, missions/shop, my bonuses, inbox, bonus terms, app and responsible gambling. Untick what you don't need; it remembers your choice.
   - **+ Add a section to my list** adds your own (for example "Daily wheel", with other names it may have). It's kept for every site.
   - **Also on this site** lists menu entries your sections don't cover. Tick any to scan them this time, or click **Keep** to add them to your list.
4. Check **Logged out** or **Logged in** at the top. It detects this from the page (Log in / Register buttons, or a balance, account button, Deposit button or Log out option) and says why; switch it if it got it wrong. The list only shows sections for that kind of run: sign-up on logged-out runs; deposit, my bonuses, inbox, account and withdrawal on logged-in runs. Then click **Scan**.
5. Leave the tab alone for a few minutes (click the extension to see progress; **Stop and keep what's done** sends the finished sections to the planner, **Cancel scan** throws it away). For each section it starts on the homepage and clicks around until it finds it: the page itself, the side menu, sub-menus, and (logged in) the account menu. Then it photographs the page or pop-up top to bottom, and on VIP, promotions and similar pages opens the details. Sections it can't find are listed as not found in the planner.
6. The planner opens with the scan. Choose the casino (or create a new one) and click **Import**. The screenshots go into the competitor review in their sections; Claude checks the sections and gives each screenshot a title.

For the logged-in run, log in to the site yourself first, then scan again and choose **Logged in**.

## What to scan

The website review (all sections in one scan) is switched off for now. Instead you scan one part at a time: choose it under **What to scan** at the top of the popup.

- **Promotions & terms**: every promotion with its terms (see below).
- **Loyalty / VIP**, **Missions**, **Deposit / cashier** (log in first), **Tournaments** (each tournament is opened), **Store**: that feature in depth, with its tabs, details and pop-ups.
- **Something else…**: a feature unique to the casino. Give its name (e.g. Wheel of Fortune) and other names it may have.

In the planner each part is written up per casino on the **Features** tab: what it is, where it lives, how it works, its key details and what stands out, with its screenshots.

## Scan only the promotions

Choose **Promotions & terms** at the top of the popup (it's remembered). The scanner finds the promotions page and opens every promotion one by one, up to 30: its pop-up or own page, More info or the ⓘ icon, and the terms inside. Tick **Also read the general bonus terms** to include the page most promotions refer to. In the planner the promotions appear under **Offer terms** as a list: what each one does, how it works, who can take part and its key terms, with the full text and screenshots. **Download list (CSV)** gives the list as a spreadsheet. Scanning again updates the promotions already in the list.

## Good to know

- Offers without their own page (like a welcome offer) are looked for in the homepage banners, clicking through the slides, and as a card on the promotions page, where it also opens the card's More info or terms. The homepage scan photographs every banner slide.
- If two sections lead to the same page (for example VIP and missions both on /rewards), it scans that page once.
- Apart from opening the sign-up and deposit pop-ups (without filling them in), it never clicks buttons that act on the account, such as Claim, Bet, Buy, Opt in or Log out, and never flips switches.
- Some sites block scrolling or change pages with scripts; if a page comes out empty, add it by hand.
- Cost: Claude sorts and reads every page, about 3 to 6 cents per page.
- To update the extension, download the zip again, replace the folder, and click the reload icon on the extension in `chrome://extensions`.
