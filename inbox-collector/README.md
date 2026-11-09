# Google script: inbox and AI

A small Google Apps Script that does two things for the planner:

- shares competitor emails from a research Gmail account
- runs the AI features (reading offer screenshots, summarising competitor emails) with your Anthropic API key

The key is stored in the script's settings in your Google account. It never appears in the website or anyone's browser. It's free and needs no server or domain.

## 1. Create a research Gmail account

Create a new Gmail account used only for this, for example `yourbrand.research@gmail.com`. Don't use a personal or work mailbox: the planner can read everything in it.

## 2. Add the script

1. Signed in as the research account, go to <https://script.google.com> and click **New project**.
2. Name it "Cycle planner inbox".
3. Delete the sample code and paste in everything from [`Code.gs`](Code.gs).
4. Click **Save**.

## 3. Create your token

1. In the function menu at the top, choose **setup** and click **Run**.
2. Google asks for permission to read the mailbox. Click **Review permissions**, choose the research account, then **Advanced → Go to Cycle planner inbox → Allow**. The warning appears because it's your own unpublished script.
3. Open **Execution log**. Copy the token it prints.

## 4. Publish it as a web app

1. Click **Deploy → New deployment**.
2. Under **Select type**, choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**. Access is still protected by the token.
4. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

## 5. Connect the planner

If you sign in to the planner, don't paste anything into it: follow step 8 so the URL and token stay on the server.

(Only when the planner runs without login: open **Competitor emails**, paste the web app URL and the token, and click **Connect**.)

## 6. Register on competitor sites

A person on your team signs up on each competitor site with a tagged address, for example `yourbrand.research+luckynova@gmail.com`. Gmail delivers every `+tag` to the same inbox, and the planner uses the tag to tell competitors apart. If a site rejects the `+`, use the plain address; the planner can match that competitor by sender domain instead.

Tick the marketing-email opt-in when registering, otherwise you won't receive the cycle.

## 7. Turn on the AI features

1. In the Apps Script editor, click the gear icon (**Project Settings**) in the left sidebar.
2. Scroll to **Script properties** and click **Add script property**.
3. Property: `ANTHROPIC_API_KEY`. Value: your Anthropic key (it starts with `sk-ant-`). Click **Save script properties**.
4. Run **setup** once more. If Google asks for permission again (to connect to an external service), allow it. The log should say "Anthropic key found".
5. In the planner, open **Competitor offers** and click **Check again**. The box turns green: "AI is on".

Set a monthly spend limit on the key at platform.claude.com. Anyone with the web app URL and token can use the two AI features (not the key itself), so the limit caps the cost if they ever leak.

## 8. Keep the token on the server (signed-in planner)

The signed-in planner never sees the script's URL or token. A small Supabase function holds them and checks that each request comes from a signed-in member of the workspace.

1. In Supabase, open **Edge Functions** and click **Deploy a new function → Via Editor**.
2. Name it exactly `planner-proxy`.
3. Delete the sample code, paste everything from [`supabase/functions/planner-proxy/index.ts`](../supabase/functions/planner-proxy/index.ts), and click **Deploy function**. Leave **Verify JWT** switched on.
4. Open **Edge Functions → Secrets** (sometimes under **Project Settings → Edge Functions**) and add two secrets:
   - `SCRIPT_URL`: the web app URL from step 4
   - `SCRIPT_TOKEN`: the token from step 3
5. In the planner, open **Competitor emails** and click **Check again**. It should say "Connected".

Only workspace owners can sync emails into a workspace; every member can use the AI features in their own workspace.

## Changing the code later

After editing `Code.gs`, use **Deploy → Manage deployments → Edit → Version: New version → Deploy**. The URL stays the same.

If the token ever leaks, run **resetToken** and paste the new token into the planner.
