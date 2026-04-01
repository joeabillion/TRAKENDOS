# Trakend OS Logo Files

Place your logo and icon files in this folder.

## Required Files

### `logo` (logo.png, logo.svg, or logo.jpg)
- **Used on:** Boot splash screen, Login page
- **Recommended size:** 512x512px or larger (will be scaled down)
- **Format:** PNG with transparency recommended, SVG also supported

### `icon` (icon.png, icon.svg, or icon.ico)
- **Used on:** Browser tab favicon, Sidebar navigation, Apple touch icon
- **Recommended size:** 256x256px or larger
- **Format:** PNG with transparency recommended, SVG also supported

## Where They Appear

| File   | Boot Screen | Login Page | Sidebar | Browser Tab |
|--------|-------------|------------|---------|-------------|
| logo   | Yes (large) | Yes (large)| -       | -           |
| icon   | -           | -          | Yes     | Yes         |

## Notes
- The app will try .png first, then .svg, then .jpg as fallbacks
- If no files are found, a styled "T" letter is shown as placeholder
- For best results, use PNG with transparent background on a dark theme
