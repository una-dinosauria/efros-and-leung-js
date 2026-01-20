import ndarray from 'https://esm.sh/ndarray@1.0.19';
import Raphael from 'https://esm.sh/raphael@2.3.0';

/**
 * Efros and Leung Texture Synthesis
 *
 * An interactive implementation of the texture synthesis algorithm from
 * "Texture Synthesis by Non-parametric Sampling" (ICCV 1999)
 */
export class TextureSynthesizer {
  constructor(options = {}) {
    this.patchL = options.patchL || 7;
    this.patchSize = 2 * this.patchL + 1;
    this.animationId = null;
    this.stepsPerFrame = options.stepsPerFrame || 5;
    this.isPaused = false;
    this.isComplete = false;

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

    // Priority queue for edge pixels (pixels with most known neighbors first)
    this.edgeQueue = [];
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
    const data = toFill.data;
    const len = data.length;
    for (let i = 0; i < len; i++) {
      if (data[i] !== 0) {
        pixCount++;
      }
    }
    return pixCount;
  }

  /**
   * Compute SSD using optimized direct array access
   */
  getSSD(mask, patch, plen, region, rw, rh) {
    const ssdW = rw - 2 * plen;
    const ssdH = rh - 2 * plen;
    const ssd = new Uint32Array(ssdW * ssdH);

    const maskData = mask.data;
    const maskStride0 = mask.stride[0];
    const maskStride1 = mask.stride[1];
    const maskOffset = mask.offset;

    const patchData = patch.data;
    const patchStride0 = patch.stride[0];
    const patchStride1 = patch.stride[1];
    const patchStride2 = patch.stride[2];
    const patchOffset = patch.offset;

    const regionData = region.data;
    const regionStride0 = region.stride[0];
    const regionStride1 = region.stride[1];
    const regionStride2 = region.stride[2];
    const regionOffset = region.offset;

    const patchSize = 2 * plen + 1;

    for (let i = plen; i < rh - plen; i++) {
      for (let j = plen; j < rw - plen; j++) {
        let sum = 0;

        for (let k = -plen; k <= plen; k++) {
          for (let l = -plen; l <= plen; l++) {
            const maskIdx = maskOffset + (k + plen) * maskStride0 + (l + plen) * maskStride1;

            if (maskData[maskIdx] === 0) {
              const patchIdx = patchOffset + (k + plen) * patchStride0 + (l + plen) * patchStride1;
              const regionIdx = regionOffset + (i + k) * regionStride0 + (j + l) * regionStride1;

              const rDiff = patchData[patchIdx] - regionData[regionIdx];
              const gDiff = patchData[patchIdx + patchStride2] - regionData[regionIdx + regionStride2];
              const bDiff = patchData[patchIdx + 2 * patchStride2] - regionData[regionIdx + 2 * regionStride2];

              sum += rDiff * rDiff + gDiff * gDiff + bDiff * bDiff;
            }
          }
        }

        ssd[(i - plen) * ssdW + (j - plen)] = sum;
      }
    }

    return { data: ssd, width: ssdW, height: ssdH };
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
        progressBar.classList.remove('progress-bar-animated');
      } else {
        progressBar.classList.add('progress-bar-animated');
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
   * Pause synthesis
   */
  pause() {
    this.isPaused = true;
    this.stop();
    this.updatePauseButton();
  }

  /**
   * Resume synthesis
   */
  resume() {
    if (this.isComplete) return;
    this.isPaused = false;
    this.updatePauseButton();
    this.animate();
  }

  /**
   * Toggle pause/resume
   */
  togglePause() {
    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  /**
   * Update pause button text
   */
  updatePauseButton() {
    const pauseIcon = document.getElementById('pause-icon');
    const pauseText = document.getElementById('pause-text');
    if (pauseIcon && pauseText) {
      if (this.isPaused) {
        pauseIcon.textContent = '▶';
        pauseText.textContent = 'Resume';
      } else {
        pauseIcon.textContent = '⏸';
        pauseText.textContent = 'Pause';
      }
    }
  }

  /**
   * Reset and restart synthesis
   */
  reset() {
    this.stop();
    this.isPaused = false;
    this.isComplete = false;
    this.updatePauseButton();
    const { x, y, w, h } = this.textureRegion;
    this.run(x, y, w, h);
  }

  /**
   * Download the current result as PNG
   */
  download() {
    const canvas = document.getElementById('fill_canvas');
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = 'texture-synthesis-result.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  /**
   * Run one step of the synthesis algorithm
   */
  synthesisStep() {
    if (this.pixsToFill <= 1 || !this.edge) {
      this.updateProgress(100);
      this.isComplete = true;
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
    const ssdCopy = Array.from(ssd.data).sort((a, b) => a - b);

    // Sample from gaussian using Box-Muller transform
    const r = Math.sqrt(-2 * Math.log(Math.random()));
    const theta = 2 * Math.PI * Math.random();
    const randX = r * Math.cos(theta);

    // Pick index with some randomness
    const idx = Math.min(Math.round(Math.abs(randX)), ssdCopy.length - 1);
    const ssdValue = ssdCopy[idx];

    // Find matching location
    let matchX = 0, matchY = 0;
    for (let i = 0; i < ssd.height; i++) {
      for (let j = 0; j < ssd.width; j++) {
        if (ssd.data[i * ssd.width + j] === ssdValue) {
          matchY = i;
          matchX = j;
          i = ssd.height; // break outer
          break;
        }
      }
    }

    // Copy texture pixel to fill location
    const srcY = matchY + this.patchL;
    const srcX = matchX + this.patchL;
    this.fillPix.set(this.edge.y, this.edge.x, 0, this.textureValues.get(srcY, srcX, 0));
    this.fillPix.set(this.edge.y, this.edge.x, 1, this.textureValues.get(srcY, srcX, 1));
    this.fillPix.set(this.edge.y, this.edge.x, 2, this.textureValues.get(srcY, srcX, 2));

    // Update display
    this.fillCtx.putImageData(this.fillImdata, 0, 0);

    // Update mask
    this.fillMask.set(this.edge.y, this.edge.x, 0);

    // Find next edge pixel (random selection)
    this.edgeMask = this.getEdgeMask(this.fillMask, this.fillImg.width, this.fillImg.height);
    this.edge = this.getRandNonZero(this.edgeMask, this.fillImg.width, this.fillImg.height);

    return this.edge !== null;
  }

  /**
   * Animation loop using requestAnimationFrame
   */
  animate() {
    if (this.isPaused) return;

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
    this.isComplete = false;
    this.isPaused = false;
    this.updatePauseButton();

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

    // Find initial edge pixel (random selection)
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

      // Setup controls
      this.setupSpeedSlider();
      this.setupControlButtons();

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

  /**
   * Setup control buttons (pause, reset, download)
   */
  setupControlButtons() {
    const pauseBtn = document.getElementById('pause-btn');
    const resetBtn = document.getElementById('reset-btn');
    const downloadBtn = document.getElementById('download-btn');

    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => this.togglePause());
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.reset());
    }
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => this.download());
    }
  }
}

// Initialize when DOM is ready
const synthesizer = new TextureSynthesizer();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => synthesizer.init());
} else {
  synthesizer.init();
}

// Export for external use
window.TextureSynthesizer = TextureSynthesizer;
window.synthesizer = synthesizer;
