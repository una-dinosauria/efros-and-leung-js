# Efros and Leung Texture Synthesis in JavaScript

An interactive, browser-based implementation of the texture synthesis algorithm from ["Texture Synthesis by Non-parametric Sampling"](https://www.eecs.berkeley.edu/Research/Projects/CS/vision/papers/efros-iccv99.pdf) by Efros and Leung (ICCV 1999).

Originally created as a teaching visualization tool for CPSC 425 (Computer Vision) at UBC.

## Demo

**[Live Demo](http://una-dinosauria.github.io/efros-and-leung-js/)**

## Features

- Real-time texture synthesis visualization
- Interactive texture region selection (drag and resize)
- Responsive design that works on desktop and mobile
- No jQuery dependency (uses modern vanilla JavaScript)

## How It Works

The algorithm fills a target region by finding similar patches from a source texture:

1. Find pixels at the edge of the filled region
2. For each edge pixel, extract the surrounding context (patch)
3. Search the texture region for the best matching patch using Sum of Squared Differences (SSD)
4. Sample from the best matches with some randomness to avoid repetitive patterns
5. Repeat until the entire region is filled

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or later recommended)

### Setup

```bash
# Clone the repository
git clone https://github.com/una-dinosauria/efros-and-leung-js.git
cd efros-and-leung-js

# Install dependencies
npm install

# Build the bundle
npm run build

# Start a local server
npm run serve
```

Then open http://localhost:3000 in your browser.

### Development

For development with auto-rebuild on changes:

```bash
npm run watch
```

In another terminal:

```bash
npm run serve
```

## Project Structure

```
efros-and-leung-js/
├── index.html          # Main HTML file
├── package.json        # Project dependencies and scripts
├── js/
│   ├── main.js        # Source code (ES6+ class-based)
│   └── bundled.js     # Built bundle for browser
└── imgs/
    ├── donkey.jpg     # Sample source image
    └── fill_region.png # Mask defining the fill region
```

## API

The synthesizer is exposed globally and can be controlled programmatically:

```javascript
// Access the synthesizer instance
window.synthesizer

// Stop the current synthesis
synthesizer.stop()

// Run synthesis with custom texture region
synthesizer.run(x, y, width, height)
```

## Configuration

The `TextureSynthesizer` class accepts options:

```javascript
const synthesizer = new TextureSynthesizer({
  patchL: 7  // Patch radius (default: 7, gives 15x15 patches)
})
```

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## License

MIT

## Acknowledgments

- Alexei Efros and Thomas Leung for the original algorithm
- CPSC 425 at UBC for inspiring this visualization
