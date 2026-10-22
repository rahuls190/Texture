# HueScript 🎨

> **Free, open-source pattern & texture generator for students and designers.**
> Create speaker grilles, ventilation holes, halftone textures and vector backgrounds — then export as SVG, DXF and STEP in one click.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Open Source](https://img.shields.io/badge/Open%20Source-Yes-brightgreen.svg)]()
[![Free to Use](https://img.shields.io/badge/Free-100%25-blue.svg)]()

---

## ✨ What is HueScript?

HueScript is a **browser-based parametric pattern generator** — no install, no account, no cost.

Drop gradient controllers onto the canvas and watch your pattern update in real time. Switch between 9 layout modes, import photos for halftone effects, and export to professional CAD formats.

**Live site:** [texture.huescript.com](https://texture.huescript.com)

---

## 🎓 For Students

HueScript is completely free and open source — built to help students learn and create:

- **Design students** — Generate unique vector patterns for print, fabric, and digital work
- **Engineering students** — Export STEP files for SolidWorks, Fusion 360, CATIA and more
- **Web / frontend students** — Explore the codebase, learn how a real static site is built
- **Art students** — Create halftone portraits, flow-line art, and generative textures

No login. No subscription. No export limits. Just open it and start designing.

---

## 🚀 Features

| Feature | Description |
|---|---|
| **9 Layout Modes** | Grid, scatter, spiral, Fibonacci, concentric, path, cross-hatch, Voronoi, flow lines |
| **Gradient Controllers** | Drop point, line or curve controllers — size, spacing & rotation follow them |
| **Image as Controller** | Upload a photo → brightness drives the pattern (halftone mode) |
| **SVG Export** | For Illustrator, Figma, laser cutting, print |
| **DXF Export** | For AutoCAD and CNC cutting |
| **STEP Export** | For SolidWorks, Fusion 360, CATIA, Inventor, Rhino |
| **STP Split** | Splits dense models into smaller blocks for smoother CAD performance |
| **HueScript Wrap** *(Beta)* | Wrap a flat pattern onto a curved 3D surface |
| **AI Design** *(Beta)* | AI-assisted pattern generation |
| **12 Preset Patterns** | Ready-to-use patterns in the Explore gallery |
| **Fully Free** | No limits, no account, no payment |

---

## 📁 Project Structure

```
HueScript/
├── index.html                        ← Homepage
├── app/                              ← The pattern generator app
├── wrap/                             ← HueScript Wrap app (Vite build)
│
├── ── Pages ──
├── about/index.html
├── ai/index.html                     ← AI Design feature page
├── changelog/index.html
├── explore/index.html                ← Pattern library
├── faq/index.html
├── feedback/index.html
├── tutorial/index.html
│
├── ── Generator Landing Pages ──
├── halftone-pattern-generator/
├── speaker-grille-pattern-generator/
├── ventilation-hole-pattern-generator/
│
├── ── Guides ──
├── guides/
│   ├── export-step-to-cad/
│   ├── ipad/
│   ├── photo-to-halftone/
│   ├── speaker-grille-design/
│   └── wrap/
│
├── ── Pattern Deep-links ──
├── patterns/
│   ├── diamond-halftone-pattern-012/
│   ├── dot-vortex-ring-pattern-050/
│   └── ... (10 patterns)
│
├── ── Static Assets ──
├── assets/                           ← Compiled CSS + main JS bundle
├── fonts/                            ← Self-hosted Inter font (woff2)
├── showcase/                         ← Pattern preset preview images
├── tutorial-thumbs/                  ← Tutorial thumbnail images
│
├── ── Root Files ──
├── site-*.js                         ← Lightweight site interaction scripts
├── ga-init.js                        ← Google Analytics (CSP-safe)
├── favicon.svg
└── og-image.jpg
```

---

## 🛠️ Running Locally

HueScript is a **fully static site** — no build step needed for the marketing pages.

### Option 1 — Open directly in browser
Just open `index.html` in your browser.

> ⚠️ Some features (video demos, CDN-hosted assets) require an internet connection as they load from `cdn.texture.huescript.com`.

### Option 2 — Serve with a local dev server (recommended)

Using Python:
```bash
cd HueScript
python -m http.server 8080
# Open http://localhost:8080
```

Using Node.js (`npx serve`):
```bash
cd HueScript
npx serve .
# Open http://localhost:3000
```

Using VS Code:
- Install the **Live Server** extension
- Right-click `index.html` → **Open with Live Server**

---

## 🤝 Contributing

Contributions are welcome! Since this is meant for students, good first contributions include:

- 🐛 Fixing broken links or typos
- 🌍 Adding new language translations
- 📖 Improving the guides and tutorials
- 🎨 Adding new pattern preset pages
- ♿ Improving accessibility

### How to contribute

1. Fork this repository
2. Create a branch: `git checkout -b fix/your-fix-name`
3. Make your changes
4. Open a Pull Request with a clear description

---

## 🗺️ Roadmap

- [ ] Add more pattern presets to the Explore gallery
- [ ] Translate remaining guides to all supported languages
- [ ] Add a contribution guide for pattern submissions
- [ ] Improve mobile experience
- [ ] Add a `CONTRIBUTING.md` with detailed guidelines

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

This means you can:
- ✅ Use it for any project (personal, academic, commercial)
- ✅ Modify and distribute it
- ✅ Use it in your own open source projects
- ✅ Use it privately

---

## 🙌 Credits

- Concept and design by [HueScript](https://texture.huescript.com), open-sourced for the student community
- Font: [Inter](https://rsms.me/inter/) by Rasmus Andersson (SIL Open Font License)
- Styling: [Tailwind CSS](https://tailwindcss.com/)

---

*Made with ❤️ for students everywhere.*
