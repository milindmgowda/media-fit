<p align="center"><img src="icon.svg" width="128" alt="Media Fit logo"></p>

# Media Fit

A Firefox extension that removes black bars built into web videos when you go fullscreen. The picture fills as much of your screen as it can, keeps its shape, and nothing is cut. It's made with widescreen and ultrawide monitors in mind.

## How it works

Media Fit samples frames while a fullscreen video plays and finds the rows and columns that are black in every sample. It then zooms the video so only those bars move off screen. Later frames can only make the zoom smaller, so picture is never kept off screen for long. Subtitles from the browser's text tracks are moved into the visible area.

Frames are analysed on your device. Media Fit collects no data.

## Limits

- Sites that protect or block access to their video frames, such as Netflix and Prime Video, can't be detected, so those videos stay as they are.
- A 16:9 video on an ultrawide screen keeps its side bars, because filling the screen would cut or stretch it.
- Bars are treated as equal on opposite sides, so a dark sky isn't mistaken for a bar.

## Try it

1. Open `about:debugging#/runtime/this-firefox` in Firefox 142 or newer.
2. Click **Load Temporary Add-on** and choose `manifest.json`.
3. Play a video with built-in black bars and go fullscreen.

Temporary add-ons are removed when Firefox closes.

## License

[MIT](LICENSE)
