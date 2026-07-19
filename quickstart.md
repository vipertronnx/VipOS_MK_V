# Before you start:
#### You'll want to get a few ducks in a row to make setup easier.

&#129414; Install Node.js 18 or newer.<br>
&#129414; Make sure you have 2FA enabled on your main [Twitch](https://twitch.tv) account, and log in.<br>
&#129414; Log in to [Twitch Developer](https://dev.twitch.tv) and register your bot as an app.<br>
- Set the OAuth Redirect URL to `http://localhost`<br>

&#129414; Obtain and save your `CLIENT_ID` and `CLIENT_SECRET` into a notepad document.<br>
&#129414; Log in to [Twitch](https://twitch.tv) on your chatbot's account, and authorize your new Twitch Dev bot.<br>
- `https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=CLIENT_ID&redirect_uri=http://localhost&scope=user:read:chat+user:write:chat&force_verify=true`<br>
- Replace YOUR_CLIENT_ID with the one you saved earlier.<br>
- You'll land on an error page, but that's ok. Find the part of the url that reads "code=AUTH_CODE" and copy `AUTH_CODE` to your notepad doc.<br>

&#129414; Obtain your bot's `ACCESS_TOKEN` and `REFRESH_TOKEN`<br>
- Open a terminal and use the following command to get your tokens. Make sure your swap out the default values with your codes.<br>

```
curl.exe -X POST "https://id.twitch.tv/oauth2/token" \ -H "Content-Type: application/x-www-form-urlencoded" \ -d "client_id=CLIENT_ID" \ -d "client_secret=CLIENT_SECRET" \ -d "code=AUTH_CODE" \ -d "grant_type=authorization_code" \ -d "redirect_uri=http://localhost"
```
<br>
&#129414; In OBS, navigate to `Tools > WebSocket Server Settings` and enable the WebSocket Server.<br>
&#129414; Under `Server Settings`, generate a password and then click `Show Connect Info`. Copy and paste the password into your notepad doc.<br><br>

# Getting started:
## Step 1.
#### Clone the repo:<br>
`git clone https://github.com/vipertronnx/VipOS_MK_V`

## Step 2.
#### Install NPM dependancies:<br>
`npm install`

## Step 3.
#### Set up .env file<br>
Copy and paste the contents of `.env.example` into a new `.env` file. Replace the values of the following with your info:<br>

>- OBS_PASSWORD
>- TWITCH_CLIENT_ID
>- TWITCH_CLIENT_SECRET
>- TWITCH_BOT_ACCESS_TOKEN
>- TWITCH_BOT_REFRESH_TOKEN
>- TWITCH_BOT_USER_ID (optional)
>- TWITCH_BOT_USERNAME (optional)
>- TWITCH_CHANNEL
>- TWITCH_CHANNEL_ID

## Step 4.
#### Configure your commands, greetings, etc.<br>
Create new `.json` files in `/config` for commands, greetings, TV Guide settings, etc. You can use the templates in `/config/examples`.

## Step 5.
#### Add Overlay Browser Sources to OBS Scenes<br>

- Alerts (including sound alerts): `http://localhost:5000/overlay/alerts`
- News Chyron: `http://localhost:5000/overlay/news-chyron`
- Stream Border: `http://localhost:5000/overlay/stream-border`
- Venom Coin: `http://localhost:5000/overlay/venom-coin`
- TV Guide: `http://localhost:5000/overlay/tv-guide`

## Step 6.
#### Running the bot.<br>
1. Start the bot with npm first:<br>
`npm run start`<br>
2. Go to `http://localhost:5000/control` in your browser.
3. Navigate to the `Sound` and `Chat` sections of the control panel. Use these to test that your bot can type in chat, and sound alerts are working &#128077;
