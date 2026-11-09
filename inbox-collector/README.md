# Inbox collector

A small Google Apps Script that lets the planner read competitor emails from a research Gmail account. It's free and needs no server or domain.

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

In the planner, open **Competitor emails**, paste the web app URL and the token, and click **Connect**.

## 6. Register on competitor sites

A person on your team signs up on each competitor site with a tagged address, for example `yourbrand.research+luckynova@gmail.com`. Gmail delivers every `+tag` to the same inbox, and the planner uses the tag to tell competitors apart. If a site rejects the `+`, use the plain address; the planner can match that competitor by sender domain instead.

Tick the marketing-email opt-in when registering, otherwise you won't receive the cycle.

## Changing the code later

After editing `Code.gs`, use **Deploy → Manage deployments → Edit → Version: New version → Deploy**. The URL stays the same.

If the token ever leaks, run **resetToken** and paste the new token into the planner.
