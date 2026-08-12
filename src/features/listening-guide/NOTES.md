# Listening guide

Question: what is the simplest way for someone to choose the right local-listening instructions, and what page structure makes the instructions easiest to write and follow?

## Route model

The guide uses eight terminal routes. It does not let users combine arbitrary apps and devices, so unsupported combinations cannot be created.

- Spotify: computer, iPhone/iPad, Android
- Apple Music: Mac, Windows, iPhone/iPad with Sync Library, iPhone/iPad without a subscription
- Anywhere else: a generic MP3 transfer path that deliberately avoids naming a destination or physical medium

Mobile destinations use a computer-to-device handoff structure. Desktop destinations use a single-device structure.

## Selected structure

A — guided choice: app first, then only valid destinations.

The destination-board and two-pane variants were removed after hands-on review. The guided
flow keeps unsupported combinations out of view.

## Information-page structure

Every route has:

1. Intro
2. Before you start
3. Physical action steps
4. Check it worked
5. If it does not show up
6. Last verified date

Edit route labels, copy, steps, and troubleshooting text in `listeningGuideContent.ts`.

To add an image, put it in `public/listening-guide/`, then add an `image` object to the
relevant step:

```ts
image: {
  src: "/listening-guide/spotify-local-files.png",
  alt: "Spotify settings with local files enabled",
},
```

Steps without an image render normally without an empty placeholder.

## Verdict

The guided-choice structure is selected. Instructions, media, links, warnings, and tests can be
added route by route without changing the rendering component.
