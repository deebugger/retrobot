# Retrobot

A retrospective Slack bot for the 2020s.

#### Credit where credit is due

This is a [bolt-js](https://www.npmjs.com/package/@slack/bolt) port of [Remy's Retrobot](https://github.com/remy/retrobot), which was in turn inspired by [PebbleKat's Retrobot](https://github.com/PebbleKat/retrobot).

---

## Installing the bot

#### Create a new Slack app

For this to work, you'll need to [create a Slack bot](https://slack.com/intl/en-il/help/articles/115005265703-Create-a-bot-for-your-workspace).

##### Creating a Slack app from a manifest file

You can use the `resources/app-manifest.yml` file to quickly create a new Slack app in your workspace. Don't forget to update the `request_url` field with the URL of your deployed app (see below about deploying to Heroku).

Once you have created and installed the new app in your workspace, you should record its **bot token** (from the `OAuth & Permissions` page) and **signing secret** (from the `Basic Information` page).

##### Creating a Slack app from scratch

Follow these steps to manually create the app:

1.  Select to create a new Slack app from scratch
2.  Record the app's `Signing Secret` from the `Basic Information` page (this is your `SLACK_SIGNING_SECRET`)
3.  In the `OAuth & Permissions` page:
    1. Add the following scopes under the `Bot Token Scope` section:
       - app_mentions:read
       - channels:history
       - channels:read
       - chat:write
       - dnd:read
       - im:history
       - reactions:read
       - users:read
    2. Under the `OAuth Tokens for Your Workspace` section, click `Install to Workspace` (follow the instruction there)
    3. Record the `Bot User OAuth Token` that was created after the app insllation (this is your `SLACK_BOT_TOKEN`)
4.  In the `App Home` page, under the `Show Tabs` section, check the `Allow users to send Slash commands and messages from the messages tab` checkbox
5.  You can now deploy the app to Heroku using the two keys (see below about [deploying to Heroku](#deploy))
6.  In the `Event Subscriptions` page:
    1. Enable the events toggle; enter the URL of your bot's deployment and add `/slack/events` (e.g. `https://my-cool-retrobot.herokuapp.com/slack/events`)
    2. In the same page, subscribe to the following bot events:
       - app_mention
       - message.channels
       - message<span></span>.im
7.  You'll need to reinstall the app - do it now (in the `Install App` page)

#### <a name="deploy"></a>Deploy to Heroku (recommended)

It's best to just install Retrobot on Heroku, where it can live inside a free web dyno and woken up as required. You can do it with a single click on this button below (opens in the same tab, so Cmd/Shift-click it):

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/deebugger/retrobot)

You'll need to supply two env vars from your newly-created bot:

- SLACK_BOT_TOKEN
- SLACK_SIGNING_SECRET

#### Run locally (good for testing)

You can run this project locally and provide Slack with an external URL (use [ngrok](https://www.npmjs.com/package/ngrok)).

## Using Retrobot

### Prepare

1. Create a new **public** channel that will be dedicated to retrospectives
2. Invite everyone who should take part in these sessions
3. Add Retrobot (as an integration) to this channel

You're all set!

**Retrobot can manage multiple retro sessions, each from its own channel**.

**_Important:_** If a user is a member of two channels that are both running a session at the same time, this user's private interaction with Retrobot (giving feedback) will land randomly in either sessions. To avoid this embarrasing (if potentially funny) situation, that user can _leave_ the unwanted channel before the session starts (and come back to it later).

### Run a retro session

Retro sessions have three parts:

1. Gathering feedback from everyone
2. Up-voting the messages that everyone would like to discuss
3. List the top up-voted messages, opening up a way to start talking about the important issues

Appropriately, Retrobot has three phases:

1. Type `@retrobot start` to start gather feedback from everyone who is (1) a member of this channel; (2) isn't away; and (3) not in DnD (Do not Disturb) mode.

   - Everyone will get pinged by Retrobot in a DM
   - At this point, each person sends feedback privately (through direct message) to Retrobot

2. Type `@retrobot stop` after a short while (give everyone 5-10 minutes to give some prope) - this will print all the feedback from everyone, split into two lists: "Worked Well" and "Needs Work"

   - Now everyone should up-vote (👍) on the most important items they'd like to discuss

3. Once everyone has voted, type `@retrobot sum [N]` to print the first `[N]` messages (defaults to 3) that were up-voted.
   - The retro session is now finished
   - You can start discussing the items with the team, and sum up the discussions and any action items in each item's thread, for later follow-up

### Other useful commands

- `@retrobot help` will print a list of all the commands it supports
- `@retrobot wake up` just to ping Retrobot, in case it was sleeping (e.g. in a Heroku free dyno)
- `@retrobot status` will provide you with the status of the retro session in this channel, if any is running
- `@retrobot channels` will list all the channels where an active retro session is currently runnning
- `@retrobot terminate session` will unceremoniously end the current session, leaving nothing behind (dangerous, but useful for reseting a session without going through all the motions)
