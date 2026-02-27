# WASM File Converter (GitHub Pages Ready)

Client-side file conversion with:
- FFmpeg.wasm for audio/video and general media conversions
- ImageMagick WASM for image conversions

## Run locally

Because browsers block some WASM/module features on `file://`, run a local server:

```bash
python -m http.server 8080
```

Then open: `http://localhost:8080`

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Go to `Settings` -> `Pages`.
3. Set source to `Deploy from a branch`.
4. Choose `main` branch and `/ (root)` folder.
5. Save and wait for publish.

## Notes

- Conversion happens in the browser; no upload backend is required.
- First conversion can take time because WASM binaries are loaded.