# Setup

Everything runs locally on your Mac. Your links and passwords stay in a `.env` file on your machine and are
only ever sent to the service they belong to (Canvas, Google, Gmail).

## 1. Install and start

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
git clone <this repo> EasyAccess && cd EasyAccess
npm install
cp .env.example .env     # then fill in what you use (step 2)
npm start                # → http://localhost:3000
```

Until you add any links you'll see sample data, so you can try it straight away.
`Start Dashboard.command` does the same as `npm start` and opens the browser for you. Double-click it in Finder.

### Optional: the Mac app

```bash
./desktop/build.sh       # builds EasyAccess.app in this folder (needs Xcode Command Line Tools)
```

Double-click **EasyAccess.app** (or drag it to your Dock). It starts the dashboard and shows it in its own
window, opens links in your normal browser, turns alerts into Mac notifications, and stops the dashboard when
you quit (⌘Q). ⌘R refreshes, and ⌘+ / ⌘− zoom. If it can't start, details are in `~/Library/Logs/EasyAccess.log`.
The app remembers where this folder is, so re-run `build.sh` if you move it.

## 2. Link your accounts

Open `.env` in any text editor, fill in the lines below, then restart the dashboard.
Every source is optional.

### Canvas
1. In Canvas, open **Calendar** (left sidebar).
2. Bottom right, click **Calendar Feed** and copy the link into `CANVAS_ICS=`.

If your school lets students create API tokens (Account → Settings → **New Access Token**), also set `CANVAS_URL`
(e.g. `https://yourschool.instructure.com`) and `CANVAS_TOKEN`. That adds missing-work flags, and assignments
you've submitted get checked off automatically. Many schools disable tokens; the calendar feed works fine without one.

### Google Calendar
1. Open <https://calendar.google.com> on a computer → ⚙ **Settings**.
2. Under *Settings for my calendars*, click your calendar.
3. Scroll to **Integrate calendar** and copy **Secret address in iCal format** into `GOOGLE_ICS=`.
   It looks like `.../calendar/ical/.../private-abc123.../basic.ics`. The *Public address* (with `/public/`)
   gives a 404 unless your calendar is public, and the *embed* link doesn't work at all.
4. More than one calendar? Separate the links with commas.

### Email (via Gmail)
The Inbox panel reads a Gmail account over IMAP, **read-only**, so nothing gets marked as read.
It shows mail from the last 3 days (read mail dimmed, starred mail tagged). **Focused** hides newsletters
and mailing lists, and alerts only fire for Focused, starred or high-importance mail.

**School or work email in Outlook?** Many schools don't let outside apps read Outlook mail, so forward it to Gmail:
1. Go to <https://outlook.office.com> → ⚙ **Settings → Mail → Forwarding** → turn on **Enable forwarding**.
2. Enter the Gmail address, tick **Keep a copy of forwarded messages** → **Save**.
3. Test it by emailing your school address from another account. A bounce saying *"Your organization does not
   allow external forwarding"* means your school blocks this.

Use the **Forwarding** setting, not an inbox rule that "forwards": it keeps the original sender.

**Then let the dashboard read that Gmail:**
1. The Google account needs **2-Step Verification** on (<https://myaccount.google.com/security>).
   Without it, the app-password page says *"The setting you are looking for is not available for your account."*
2. Go to <https://myaccount.google.com/apppasswords>, name it `EasyAccess` → **Create**.
3. In `.env`: set `GMAIL_USER=` to the Gmail address and `GMAIL_APP_PASSWORD=` to the 16-letter password
   Google shows (spaces are fine).
4. Using your everyday Gmail? Narrow it to school mail with a Gmail search, e.g.
   `GMAIL_FILTER={from:myschool.edu to:myschool.edu}`. Don't use `from:<your school address>`, because that only
   matches mail you sent yourself.

To disconnect, delete the app password on that Google page and clear the two lines in `.env`.

## 3. Restarting (after editing `.env`)
- **Mac app:** quit with ⌘Q and open it again.
- **Browser:** press **Ctrl + C** in the Terminal window running it, then `npm start` again.

The page refreshes itself every 2 minutes, so you only need to restart after changing `.env`.

## 4. YouTube panel
Shows the 4 newest full-length videos (no Shorts) from each of a set of fitness and tech channels, with
topic tabs. New videos are fetched every time you open or reload the dashboard. YouTube doesn't let apps see
your recommendations, so add channels you like instead:

```
YOUTUBE_CHANNELS=fitness:@SomeLifter,tech:@SomeCoder,music:@SomeArtist
```

The part before the colon becomes a tab. Copy the `@handle` from the channel's YouTube page.
Set `YOUTUBE_DEFAULTS=off` to drop the built-in picks.

**Watch later:** hit **Later** on any video to move it to the **Watch later** tab. It stays there, even
after it drops off the channel's latest list, until you click **Saved** to remove it.

## 5. Sports (scroll down)
Every game in the next 7 days for your chosen leagues, with live and final scores, plus ESPN headlines.
- `SPORTS_LEAGUES=nba,nfl` (also `wnba`, `mlb`, `nhl`).
- `SPORTS_TEAMS=ORL,MIA` stars those teams' games (ESPN abbreviations) and adds a **My teams** tab.

**Where to watch**, for each game:
- **Grey chips** are national TV or streaming (ESPN, Prime Video, CBS, NBC…).
- **Stream** names the app that carries that channel: CBS → Paramount+, NBC → Peacock, FOX → FOX One,
  ESPN/ABC → ESPN app, NFL Network → NFL+.
- **NBA games with no national channel** only air on the teams' local channels. Out of market, that means
  **NBA League Pass**, which blacks out local teams.
- **NFL Sunday-afternoon games on CBS/FOX** are **regional**: only the game picked for your area airs near
  you. Others are on **NFL Sunday Ticket**.

## 6. Assignments and gym tracker
- **Assignments:** tick the box next to anything in the *Due* column to cross it off. It drops out of the
  counts and the countdown. Tick again to undo.
- **Gym:** set your weekly routine, Sunday → Saturday, in `.env` (the default is a push/pull/legs split):
  ```
  GYM_ROUTINE=Rest,Push,Pull,Legs,Push,Pull,Legs
  ```
  Hit the button once you've trained. Forgot a day? Click it in the week strip to log or un-log it.
- **Streak** = days in a row you've stuck to the routine. Rest days count, and today's workout doesn't break
  the streak until the day is over. Tracking starts the first day you open the dashboard.
- These, and your Watch later list, are saved in `data/state.json`. Back it up if you care about your streak.

## 7. Tips
- Click **Alerts off** once to get a notification 10 minutes before events and when something new shows up.
- The dots at the top right show each source's status. A hollow dot means not linked, and a red ring means
  it stopped loading (hover to see why). The banner explains how to fix it.
- Google Calendar feeds can lag by up to a few hours on Google's end.
