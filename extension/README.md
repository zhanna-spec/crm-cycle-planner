# Site scanner extension

Scans a competitor's website in your own browser and sends the screenshots to the Conversion Cycle Planner. Claude then sorts every page into offers (welcome, 2nd deposit, reload…), tournaments and website content (homepage, registration, promotions, VIP…) and reads them, creating the cards for you.

Because it runs in your browser, it sees what you see: your VPN's country, and your login when you run it logged in. Nothing is sent anywhere except to the planner.

Works in Chrome, Edge and Brave. Only people who run scans need it; everyone in the workspace sees the results.

## Install (2 minutes)

1. Download **[scanner-extension.zip](https://zhanna-spec.github.io/crm-cycle-planner/scanner-extension.zip)** and unzip it. Keep the folder somewhere permanent, for example in Documents; the browser loads it from there.
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Switch on **Developer mode** (top right in Chrome, left side in Edge).
4. Click **Load unpacked** and choose the unzipped folder.
5. Click the puzzle icon in the toolbar and pin **Cycle Planner Site Scanner**.

## Scan a site

1. Sign in to the planner once in the same browser.
2. Turn on your VPN if you need one, and open the operator's website. Accept cookies and confirm your age, so the site is ready.
3. Click the scanner icon. It shows a checklist of sections to find: sign-up, deposit, promotions, tournaments, VIP/loyalty, missions/shop, my bonuses, inbox, bonus terms, app and responsible gambling. Untick what you don't need; it remembers your choice.
   - **+ Add a section to my list** adds your own (for example "Daily wheel", with other names it may have). It's kept for every site.
   - **Also on this site** lists menu entries your sections don't cover. Tick any to scan them this time, or click **Keep** to add them to your list.
4. Check **Logged out** or **Logged in** at the top. It detects this from the page (Log in / Register buttons, or a balance, account button, Deposit button or Log out option) and says why; switch it if it got it wrong. The list only shows sections for that kind of run: sign-up on logged-out runs; deposit, my bonuses, inbox, account and withdrawal on logged-in runs. Then click **Scan**.
5. Leave the tab alone for a few minutes. For each section it starts on the homepage and clicks around until it finds it: the page itself, the side menu, sub-menus, and (logged in) the account menu. Then it photographs the page or pop-up top to bottom, and on VIP, promotions and similar pages opens the details. Sections it can't find are listed as not found in the planner.
6. The planner opens with the scan. Choose the operator (or create a new one) and click **Import**. Cards appear as Claude reads each page.

For the logged-in run, log in to the site yourself first, then scan again and choose **Logged in**.

## Good to know

- If two sections lead to the same page (for example VIP and missions both on /rewards), it scans that page once.
- Apart from opening the sign-up and deposit pop-ups (without filling them in), it never clicks buttons that act on the account, such as Claim, Bet, Buy, Opt in or Log out, and never flips switches.
- Some sites block scrolling or change pages with scripts; if a page comes out empty, add it by hand.
- Cost: Claude sorts and reads every page, about 3 to 6 cents per page.
- To update the extension, download the zip again, replace the folder, and click the reload icon on the extension in `chrome://extensions`.
