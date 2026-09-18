# videocut

A browser-based video trimmer that runs entirely on your device. Choose a video file, set the in and out points, and export a trimmed WebM copy — no files are uploaded to any server.

Live demo: [paulkinlan.github.io/videocut](https://paulkinlan.github.io/videocut/)

## Features

- **Private & client-side**: All playback, trimming, and recording happens locally in the browser.
- **Format support**: Accepts any video format your browser can play (`.mp4`, `.webm`, `.mov`, `.ogv`, etc.).
- **Export**: Generates a trimmed WebM video using the browser's `MediaRecorder` API.
- **Offline support**: Service worker enabled for offline use and installable as a PWA.

## Usage

1. Open [paulkinlan.github.io/videocut](https://paulkinlan.github.io/videocut/).
2. Choose or drag in a video file.
3. Set your desired start and end times using the timecode inputs or scrubber.
4. Click **Trim Video** to record the selected range.
5. Click **Download WebM** to save the trimmed clip.

## License

Apache-2.0