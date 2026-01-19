const ndarray = require('ndarray');
const Raphael = require('raphael');

/**
 * Efros and Leung Texture Synthesis
 *
 * An interactive implementation of the texture synthesis algorithm from
 * "Texture Synthesis by Non-parametric Sampling" (ICCV 1999)
 */
class TextureSynthesizer {
  constructor(options = {}) {
    this.patchL = options.patchL || 7;
    this.patchSize = 2 * this.patchL + 1;
    this.animationId = null;
    this.stepsPerFrame = options.stepsPerFrame || 5;

    // Default texture region coordinates
    this.textureRegion = {
      x: 162,
      y: 112,
      w: 38,
      h: 73
    };

    // State
    this.donkeyImg = null;
    this.fillImg = null;
    this.donkeyCtx = null;
    this.fillCtx = null;
    this.donkeyImdata = null;
    this.fillImdata = null;
    this.donkeyPix = null;
    this.fillPix = null;
    this.fillMask = null;
    this.pixsToFill = 0;
    this.totalPix = 0;
    this.edge = null;
    this.edgeMask = null;
    this.textureValues = null;
    this.raphaelCanvas = null;
    this.shapes = [];
  }

  /**
   * Creates a 2D edge mask where 1 indicates pixels at the boundary
   * between filled and unfilled regions
   */
  getEdgeMask(wholeMask, w, h) {
    const edgeMask = new ndarray(new Uint8ClampedArray(h * w), [h, w]);

    for (let y = 4; y < h - 4; y++) {
      for (let x = 4; x < w - 4; x++) {
        if (wholeMask.get(y, x) !== 0) {
          if (wholeMask.get(y - 1, x) === 0 ||
              wholeMask.get(y + 1, x) === 0 ||
              wholeMask.get(y, x - 1) === 0 ||
              wholeMask.get(y, x + 1) === 0) {
            edgeMask.set(y, x, 1);
          }
        }
      }
    }
    return edgeMask;
  }

  /**
   * Count pixels that need to be filled
   */
  countPixToFill(toFill) {
    let pixCount = 0;
    for (let y = 0; y < toFill.shape[0]; y++) {
      for (let x = 0; x < toFill.shape[1]; x++) {
        if (toFill.get(y, x) !== 0) {
          pixCount++;
        }
      }
    }
    return pixCount;
  }

  /**
   * Get a random non-zero element from a 2D matrix
   */
  getRandNonZero(matrix, w, h) {
    const nonzeros = [];
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        if (matrix.get(i, j) !== 0) {
          nonzeros.push({ y: i, x: j });
        }
      }
    }
    if (nonzeros.length === 0) return null;
    const idx = Math.floor(Math.random() * nonzeros.length);
    return nonzeros[idx];
  }

  /**
   * Compute the Sum of Squared Differences between a patch and image region
   */
  getSSD(mask, patch, plen, region, rw, rh) {
    const ssdW = rw - 2 * plen;
    const ssdH = rh - 2 * plen;
    const ssd = ndarray(new Uint32Array(ssdW * ssdH), [ssdH, ssdW]);

    for (let i = plen; i < rh - plen; i++) {
      for (let j = plen; j < rw - plen; j++) {
        for (let k = -plen; k < plen + 1; k++) {
          for (let l = -plen; l < plen + 1; l++) {
            if (mask.get(k + plen, l + plen) === 0) {
              const rDiff = patch.get(k + plen, l + plen, 0) - region.get(i + k, j + l, 0);
              const gDiff = patch.get(k + plen, l + plen, 1) - region.get(i + k, j + l, 1);
              const bDiff = patch.get(k + plen, l + plen, 2) - region.get(i + k, j + l, 2);
              ssd.set(i - plen, j - plen, ssd.get(i - plen, j - plen) + rDiff * rDiff + gDiff * gDiff + bDiff * bDiff);
            }
          }
        }
      }
    }
    return ssd;
  }

  /**
   * Load an image with error handling
   */
  loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      img.src = src;
    });
  }

  /**
   * Update progress bar
   */
  updateProgress(value) {
    const progressBar = document.querySelector('.progress-bar');
    if (progressBar) {
      progressBar.style.width = `${value}%`;
      progressBar.setAttribute('aria-valuenow', value);
      progressBar.textContent = `${value}%`;
      if (value >= 100) {
        progressBar.classList.remove('active');
      } else {
        progressBar.classList.add('active');
      }
    }
  }

  /**
   * Stop any running synthesis
   */
  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * Run one step of the synthesis algorithm
   */
  synthesisStep() {
    if (this.pixsToFill <= 1) {
      this.updateProgress(100);
      return false;
    }

    const progress = 100 - Math.round(this.pixsToFill / this.totalPix * 100);
    this.updateProgress(progress);

    this.pixsToFill--;

    // Extract patch around edge pixel
    const patchImdata = this.donkeyCtx.getImageData(
      this.edge.x - this.patchL,
      this.edge.y - this.patchL,
      this.patchSize,
      this.patchSize
    );
    const patchPix = ndarray(patchImdata.data, [this.patchSize, this.patchSize, 4]);
    const patchMask = this.fillMask
      .lo(this.edge.y - this.patchL, this.edge.x - this.patchL)
      .hi(this.patchSize, this.patchSize);

    const ssd = this.getSSD(
      patchMask,
      patchPix,
      this.patchL,
      this.textureValues,
      this.textureRegion.w,
      this.textureRegion.h
    );

    // Sort SSD values
    const ssdCopy = Array.from(new Uint32Array(ssd.data)).sort((a, b) => a - b);

    // Sample from gaussian using Box-Muller transform
    const r = Math.sqrt(-2 * Math.log(Math.random()));
    const theta = 2 * Math.PI * Math.random();
    const randX = r * Math.cos(theta);

    // Pick index with some randomness
    const idx = Math.min(Math.round(Math.abs(randX)), ssdCopy.length - 1);
    const ssdValue = ssdCopy[idx];

    // Find matching location
    let matchX = 0, matchY = 0;
    outer:
    for (let i = 0; i < ssd.shape[0]; i++) {
      for (let j = 0; j < ssd.shape[1]; j++) {
        if (ssd.get(i, j) === ssdValue) {
          matchY = i;
          matchX = j;
          break outer;
        }
      }
    }

    // Copy texture pixel to fill location
    this.fillPix.set(this.edge.y, this.edge.x, 0, this.textureValues.get(matchY + this.patchL, matchX + this.patchL, 0));
    this.fillPix.set(this.edge.y, this.edge.x, 1, this.textureValues.get(matchY + this.patchL, matchX + this.patchL, 1));
    this.fillPix.set(this.edge.y, this.edge.x, 2, this.textureValues.get(matchY + this.patchL, matchX + this.patchL, 2));

    // Update display
    this.fillCtx.putImageData(this.fillImdata, 0, 0);

    // Update mask
    this.fillMask.set(this.edge.y, this.edge.x, 0);

    // Find next edge pixel
    this.edgeMask = this.getEdgeMask(this.fillMask, this.fillImg.width, this.fillImg.height);
    this.edge = this.getRandNonZero(this.edgeMask, this.fillImg.width, this.fillImg.height);

    return this.edge !== null;
  }

  /**
   * Animation loop using requestAnimationFrame
   */
  animate() {
    for (let i = 0; i < this.stepsPerFrame; i++) {
      if (!this.synthesisStep()) {
        return;
      }
    }

    this.animationId = requestAnimationFrame(() => this.animate());
  }

  /**
   * Set the speed (pixels per frame)
   */
  setSpeed(stepsPerFrame) {
    this.stepsPerFrame = Math.max(1, Math.min(50, stepsPerFrame));
  }

  /**
   * Run the Efros and Leung synthesis algorithm
   */
  run(textX, textY, textW, textH) {
    this.stop();

    this.textureRegion = { x: textX, y: textY, w: textW, h: textH };

    // Draw fill image
    this.fillCtx.drawImage(this.fillImg, 0, 0);
    this.fillImdata = this.fillCtx.getImageData(0, 0, this.fillImg.width, this.fillImg.height);
    this.fillPix = ndarray(this.fillImdata.data, [this.fillImg.height, this.fillImg.width, 4]);

    // Create fill mask from red channel
    this.fillMask = ndarray(new Uint8ClampedArray(this.fillPix.data), this.fillPix.shape);
    this.fillMask = this.fillMask.pick(null, null, 0);

    // Paint source image into non-masked region
    for (let y = 0; y < this.fillImg.height; y++) {
      for (let x = 0; x < this.fillImg.width; x++) {
        if (this.fillMask.get(y, x) === 0) {
          this.fillPix.set(y, x, 0, this.donkeyPix.get(y, x, 0));
          this.fillPix.set(y, x, 1, this.donkeyPix.get(y, x, 1));
          this.fillPix.set(y, x, 2, this.donkeyPix.get(y, x, 2));
        } else {
          this.fillPix.set(y, x, 0, 0);
          this.fillPix.set(y, x, 1, 0);
          this.fillPix.set(y, x, 2, 0);
        }
      }
    }
    this.fillCtx.putImageData(this.fillImdata, 0, 0);

    // Extract texture region
    const textureData = this.donkeyCtx.getImageData(textX, textY, textW, textH).data;
    this.textureValues = ndarray(textureData, [textH, textW, 4]);

    // Count pixels to fill
    this.totalPix = this.countPixToFill(this.fillMask);
    this.pixsToFill = this.totalPix;

    // Find initial edge
    this.edgeMask = this.getEdgeMask(this.fillMask, this.fillImg.width, this.fillImg.height);
    this.edge = this.getRandNonZero(this.edgeMask, this.fillImg.width, this.fillImg.height);

    // Start animation
    this.updateProgress(0);
    this.animate();
  }

  /**
   * Create the interactive texture selection interface
   */
  createTextureInterface(container, sourceImg) {
    const { x: textX, y: textY, w: textW, h: textH } = this.textureRegion;

    this.raphaelCanvas = Raphael(container, sourceImg.width, sourceImg.height);
    this.raphaelCanvas.image(sourceImg.src, 0, 0, sourceImg.width, sourceImg.height);

    // Main selection rectangle
    this.shapes = this.raphaelCanvas.add([{
      type: 'rect',
      x: textX,
      y: textY,
      width: textW,
      height: textH,
      fill: '#fff',
      'fill-opacity': 0,
      stroke: '#beaed4',
      'stroke-width': 3
    }]);

    const rect = this.shapes[0];

    // Drag handlers
    const dragStart = function() {
      this.ox = this.attr('x');
      this.oy = this.attr('y');
      this.ow = this.attr('width');
      this.oh = this.attr('height');
      this.dragging = true;
    };

    const dragMove = (dx, dy) => {
      const cursor = rect.attr('cursor');

      switch (cursor) {
        case 'nw-resize':
          rect.attr({
            x: rect.ox + dx,
            y: rect.oy + dy,
            width: rect.ow - dx,
            height: rect.oh - dy
          });
          break;
        case 'ne-resize':
          rect.attr({
            y: rect.oy + dy,
            width: rect.ow + dx,
            height: rect.oh - dy
          });
          this.updateOverlays(rect, sourceImg);
          this.run(rect.ox, rect.oy + dy, rect.ow + dx, rect.oh - dy);
          break;
        case 'se-resize':
          rect.attr({
            width: rect.ow + dx,
            height: rect.oh + dy
          });
          this.updateOverlays(rect, sourceImg);
          this.run(rect.ox, rect.oy, rect.ow + dx, rect.oh + dy);
          break;
        case 'sw-resize':
          rect.attr({
            x: rect.ox + dx,
            width: rect.ow - dx,
            height: rect.oh + dy
          });
          break;
        default: // move
          rect.attr({
            x: rect.ox + dx,
            y: rect.oy + dy
          });
          this.updateOverlays(rect, sourceImg);
          this.run(rect.ox + dx, rect.oy + dy, rect.ow, rect.oh);
          break;
      }
    };

    const dragEnd = function() {
      this.dragging = false;
    };

    const changeCursor = function(e, mouseX, mouseY) {
      if (this.dragging) return;

      const container = document.getElementById('texture_holder');
      const relativeX = mouseX - container.offsetLeft - this.attr('x');
      const relativeY = mouseY - container.offsetTop - this.attr('y');
      const shapeWidth = this.attr('width');
      const shapeHeight = this.attr('height');
      const resizeBorder = 10;

      if (relativeX < resizeBorder && relativeY < resizeBorder) {
        this.attr('cursor', 'nw-resize');
      } else if (relativeX > shapeWidth - resizeBorder && relativeY < resizeBorder) {
        this.attr('cursor', 'ne-resize');
      } else if (relativeX > shapeWidth - resizeBorder && relativeY > shapeHeight - resizeBorder) {
        this.attr('cursor', 'se-resize');
      } else if (relativeX < resizeBorder && relativeY > shapeHeight - resizeBorder) {
        this.attr('cursor', 'sw-resize');
      } else {
        this.attr('cursor', 'move');
      }
    };

    rect.mousemove(changeCursor);
    rect.drag(dragMove, dragStart, dragEnd);

    // Create overlay shapes
    this.shapes[1] = this.raphaelCanvas.rect(0, 0, sourceImg.width, textY)
      .attr({ fill: '#000', opacity: 0.5 });
    this.shapes[2] = this.raphaelCanvas.rect(0, textY + 1, textX, sourceImg.height - textY)
      .attr({ fill: '#000', opacity: 0.5 });
    this.shapes[3] = this.raphaelCanvas.rect(textX + textW, textY + 1, sourceImg.width - (textX + textW), textH)
      .attr({ fill: '#000', opacity: 0.5 });
    this.shapes[4] = this.raphaelCanvas.rect(textX + 1, textY + textH + 2, sourceImg.width - textX, sourceImg.height - (textY + textH))
      .attr({ fill: '#000', opacity: 0.5 });
  }

  /**
   * Update overlay rectangles when selection changes
   */
  updateOverlays(rect, sourceImg) {
    const x = rect.attr('x');
    const y = rect.attr('y');
    const w = rect.attr('width');
    const h = rect.attr('height');

    this.shapes[1].attr({ height: y });
    this.shapes[2].attr({ y: y + 1, width: x, height: sourceImg.height - y });
    this.shapes[3].attr({ x: x + w, y: y + 1, width: sourceImg.width - (x + w), height: h });
    this.shapes[4].attr({ x: x + 1, y: y + h + 2, width: sourceImg.width - x, height: sourceImg.height - (y + h) });
  }

  /**
   * Show error message to user
   */
  showError(message) {
    const errorDiv = document.getElementById('error-message');
    if (errorDiv) {
      errorDiv.textContent = message;
      errorDiv.style.display = 'block';
      setTimeout(() => {
        errorDiv.style.display = 'none';
      }, 5000);
    } else {
      alert(message);
    }
  }

  /**
   * Initialize the application
   */
  async init() {
    try {
      // Load source image
      this.donkeyImg = await this.loadImage('imgs/donkey.jpg');

      this.donkeyCtx = document.getElementById('original_canvas').getContext('2d');
      this.donkeyCtx.drawImage(this.donkeyImg, 0, 0);
      this.donkeyImdata = this.donkeyCtx.getImageData(0, 0, this.donkeyImg.width, this.donkeyImg.height);
      this.donkeyPix = ndarray(this.donkeyImdata.data, [this.donkeyImg.height, this.donkeyImg.width, 4]);

      // Load fill mask
      this.fillImg = await this.loadImage('imgs/fill_region.png');
      this.fillCtx = document.getElementById('fill_canvas').getContext('2d');

      // Setup texture interface
      this.createTextureInterface('texture_holder', this.donkeyImg);

      // Setup speed slider
      this.setupSpeedSlider();

      // Run initial synthesis
      const { x, y, w, h } = this.textureRegion;
      this.run(x, y, w, h);

    } catch (error) {
      console.error('Initialization error:', error);
      this.showError(`Failed to initialize: ${error.message}`);
    }
  }

  /**
   * Setup speed slider control
   */
  setupSpeedSlider() {
    const slider = document.getElementById('speed-slider');
    const valueDisplay = document.getElementById('speed-value');

    if (!slider || !valueDisplay) return;

    slider.addEventListener('input', (e) => {
      const speed = parseInt(e.target.value, 10);
      this.setSpeed(speed);
      valueDisplay.textContent = `${speed} pixels/frame`;
    });
  }
}

// Initialize when DOM is ready
if (typeof document !== 'undefined') {
  const synthesizer = new TextureSynthesizer();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => synthesizer.init());
  } else {
    synthesizer.init();
  }

  // Export for external use
  window.TextureSynthesizer = TextureSynthesizer;
  window.synthesizer = synthesizer;
}

module.exports = TextureSynthesizer;
