# Portal UX guide

The portal should feel like a messaging app first and a control panel second. The main reference is
iMessage, with a few patterns borrowed from WhatsApp, Telegram and Slack where they fit a
bots-as-contacts product.

## Principles

1. **The thread is a conversation.** Only people and bots speak in bubbles. Everything else is a
   quiet, centered line, and it appears only when it needs the owner.
2. **Complexity is opt-in.** Simple view is the default. The **Details** switch in the sidebar footer
   reveals task records, room bookkeeping, and the runtime/budget/Mac/export panels. Anything the
   owner must act on (failures, "needs you", recovery, monitoring alerts) shows in both views.
3. **Motion confirms, never decorates.** Bubbles ease in, the typing dots pulse, and swipe-to-reply
   springs back. `prefers-reduced-motion` turns all of this off.

## Thread (iMessage)

- The owner's bubbles sit on the right in accent blue with white text. Bot bubbles sit on the left in
  soft grey with dark text. Bubbles are 18px-radius pills, at most 72% of the thread width.
- **Grouping:** consecutive messages from the same sender within 5 minutes stack 2px apart. Only the
  last bubble in a group has a tail and the sender's avatar.
- **Names:** shown above the first bubble of a bot group in rooms only. In a 1:1 chat the header
  already says who it is.
- **Time separators:** a centered "Today 2:22 PM" when 15+ minutes pass between messages. The exact
  time is in each bubble's tooltip.
- **Typing indicator:** three pulsing dots in a grey bubble while a bot is working on a reply. The
  bot's in-progress text appears there if the runtime streams a preview.
- **System lines:** small, centered and muted, like "Travel is replying…" or "Task failed · Retry".

## Replying (iMessage/WhatsApp)

- **Touch:** swipe a bubble to the right. It follows the finger up to 72px, a reply arrow fades in,
  and letting go past 56px starts a reply (with a short vibration where supported).
- **Pointer:** hover a bubble to reveal a ↩ button beside it. The same action is also available
  through keyboard focus.
- **Composer:** a "Replying to Name" bar above the input shows the quoted snippet and has ✕ to
  cancel. Esc also cancels.
- **Sent replies:** a small quoted card above the bubble. Tapping it scrolls to the original and
  briefly highlights it.
- **Backend:** `message.send.reply_to_event_id` must name a message in the same conversation. The bot
  receives the quote as a prefix to the owner's text.

## Bot-to-bot messages

- Room messages between members are always visible, because the owner is part of the room.
- When a bot consults a bot outside the conversation (`hehebot_ask_bot`), the question and answer
  fold into one small inline pill: "Chief of Staff → Travel · 2 bot messages". It is amber when the
  other bot failed, opens on tap, and is expanded by default in Details view.
- Pill messages never notify. The asking bot tells the owner the outcome in its own bubble.

## Composer (iMessage)

- A rounded pill input with a circular ↑ send button inside it. The button stays disabled until
  there is text.
- The input grows with the text up to about 8 lines.
- Enter sends and Shift+Enter adds a new line. On touch devices, Enter adds a new line.
- Send status ("Sending…", "Not delivered yet — retrying…") appears under the pending bubble, not in
  a footer.

## Chrome

- Sidebar: a Messages-style list with round avatars and a clear selected state. The sections are
  bots, rooms, then managed features.
- Header: a translucent bar with a blur, holding the conversation name and a subtle
  "bot" / "room · N members" subtitle.
- Workspace panel: cards with generous spacing. In simple view it shows only Routines, Memory and
  Notifications.
- System font stack (SF Pro on Apple devices), with 15-16px body text.

## Out of scope for now

- Reactions (tapbacks) and read receipts, which need new events.
- Dark mode: the dialogs and the skills screens aren't themed yet.
