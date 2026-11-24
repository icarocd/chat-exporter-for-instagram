# Chat Exporter for Instagram

Browser extension that adds an export button to Instagram web. It saves the open DM conversation (messages and images) to a `.zip` file. Videos and shared posts are saved as links.

Works in Chromium-based browsers (Chrome, Brave, Edge).

## Install

- Download this repository (`git clone` or "Code" > "Download ZIP" and extract it)
- Open `chrome://extensions` (in Brave, `brave://extensions`)
- Turn on "Developer mode"
- Click "Load unpacked" and select the repository folder
- Open or reload `https://www.instagram.com/direct/`

## Use

Open a DM conversation. An "⇩ Export" button shows in the bottom right corner, with these options:

- **Only what is on screen**: exports the messages already loaded
- **Last N scrolls...**: scrolls up N times, then exports
- **Whole conversation**: scrolls up to the start of the history, then exports
- **Download images**: checkbox to include or skip the images sent in the chat

During the export a counter shows the progress and the button changes to "✕ Cancel". Cancel saves what was already collected, marked as partial.

## Output

The `.zip` file goes to the browser download folder, named `instagram_<conversation>_<date>.zip`. It has:

- `conversation.txt`: the messages in order, with the time markers Instagram shows (like "7:22 AM"), author, text, image paths and links to videos and shared posts
- `conversation.html`: the same conversation for reading in a browser, with chat bubbles and images inline
- `media/`: images sent directly in the conversation

## How it works

- Reads only what Instagram already shows on the page, using the session open in the browser
- Does not call the Instagram API and does not send data to any other place
- Scrolls the conversation to load older messages, like a user would
- Finds the author by the side of the bubble: right is "You", left is the other person
- Downloads only images sent directly in the chat. Videos and shared posts or reels are kept as links, not downloaded
- Downloads images only from `*.cdninstagram.com` and `*.fbcdn.net`
- Runs only on `https://www.instagram.com/*`

## Limits

- Instagram uses random class names, so the extension finds the chat by layout. If Instagram changes its layout, the export may break until `content.js` is updated
- Instagram does not show the time of each message, only time markers between groups of messages. The export keeps these markers
- In group chats, all messages from other people are shown with the conversation name, not with each sender name
- Direct video links from the Instagram CDN expire after some time. Links to posts and reels do not
- Some videos (and voice messages) have no link the page can read, so they show as "video (no link available)"
- Reactions and replied-message previews come as plain text, when they come
- All data stays in memory until the zip is saved, so very large exports may be slow or fail

## Disclaimer

This software is provided "as is", without warranty of any kind, express or implied. Use it at your own risk.

The authors are not responsible for any damage, data loss, account action, bug, misuse, or any claim of any kind that comes from using this software.

This project is not affiliated with, endorsed by, or sponsored by Instagram or Meta Platforms, Inc. "Instagram" is a trademark of Meta Platforms, Inc.

You are the only one responsible for how you use this tool and the data you export, including following the Instagram Terms of Use, local laws, and the privacy of the people in the conversations.

## License

MIT. See `LICENSE`.
