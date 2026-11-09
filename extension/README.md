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
3. Click the scanner icon. It lists the relevant pages it found (promotions, tournaments, VIP, bonus terms, sign-up, app…). Untick anything you don't need, or paste extra links.
4. Choose **Logged out** or **Logged in**, then click **Scan**.
5. Leave the tab alone for a minute or two; it visits each page and takes screenshots while scrolling.
6. The planner opens with the scan. Choose the operator (or create a new one) and click **Import**. Cards appear as Claude reads each page.

For the logged-in run, log in to the site yourself first, then scan again and choose **Logged in**.

## Good to know

- Sign-up and deposit forms that open as a pop-up can't be scanned automatically. Add a screenshot of those in the planner by hand.
- Some sites block scrolling or change pages with scripts; if a page comes out empty, add it by hand.
- Cost: Claude sorts and reads every page, about 3 to 6 cents per page.
- To update the extension, download the zip again, replace the folder, and click the reload icon on the extension in `chrome://extensions`.
