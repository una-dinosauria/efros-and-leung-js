var ndarray = require('ndarray');
var raphael = require('raphael');
// var jquery  = require('jquery');

// === Some helper funcions
var get_edge_mask = function( whole_mask, w, h ) {
	// 
	// Creates a 2d mask where 1 means that this is an edge.
	// whole mask is an h-by-w array where 255 indicates a TODOregion

	// Initialize the mask to all zeros.
	var edge_mask = new ndarray( new Uint8ClampedArray(h*w), [h ,w] )

	for (var y=4; y<(h-4); y++) {
		for (var x=4; x<(w-4); x++) {
			if ( whole_mask.get(y,x) != 0 ) {
				if ( whole_mask.get(y-1,x) == 0 ||
					whole_mask.get(y+1,x) == 0 ||
					whole_mask.get(y,x-1) == 0 ||
					whole_mask.get(y,x+1) == 0 ) {
					edge_mask.set(y,x,1);
				}
			}
		}
	}
	return edge_mask;
};

// === Count the number of pixels that we will be filling.
var count_pix_to_fill = function( to_fill ) {
	// Input
	//   to_fill : 2d array. Truthy values indicate regions to fill.
	// Output
	//   pix_count : Integer. Number of pixels that have to be filled.
	pix_count = 0;
	for (var y=0; y<to_fill.shape[0]; y++) {
		for (var x=0; x<to_fill.shape[1]; x++) {
			if ( to_fill.get(y,x) != 0 ) {
				pix_count++;
			}
		}
	}
	return pix_count;
}

// === Get a random non-zero element of a matrix
var get_rand_non_zero = function( x, w, h ) {
	var nonzeros = [];
	for (var i=0; i<h; i++) {
		for (var j=0; j<w; j++) {
			if (x.get(i,j) != 0) {
				nonzeros.push({
					'y': i,
					'x': j
				});
			}
		}
	}
	var idx = Math.floor( (Math.random()*nonzeros.length) );
	return nonzeros[ idx ];
};

// === Compute the ssd of a small patch with a larger image region
var get_ssd = function( mask, patch, plen, region, rw, rh ) {
	// mask is a 2d array of size (2*plen)+1 by (2*plen)+1
	// path is an image array of the same dimensions as mask
	// region is an image array of of size rh by rw
	// Output: ssd is a rh-(2*plen) by rw-(2*plen)

	// Create an initialize the ssd output
	var ssd_w = rw - 2*plen;
	var ssd_h = rh - 2*plen;
	var ssd = ndarray( new Uint32Array(ssd_w * ssd_h), [ssd_h, ssd_w] );

	// Loop through the image region
	for ( var i=plen; i<rh-plen; i++ ) {
		for ( var j=plen; j<rw-plen; j++ ) {

			// Loop through patch
			for( var k=-plen; k<plen+1; k++ ) {
				for( var l=-plen; l<plen+1; l++ ) {

					// Check the mask
					if( mask.get( k+plen,l+plen ) == 0 ) {
						// Add to the squared differences -- r,g and b
						ssd.set( i-plen, j-plen, ssd.get( i-plen,j-plen ) + Math.pow( patch.get( k+plen,l+plen,0 ) - region.get( i+k,j+l,0 ), 2));
						ssd.set( i-plen, j-plen, ssd.get( i-plen,j-plen ) + Math.pow( patch.get( k+plen,l+plen,1 ) - region.get( i+k,j+l,1 ), 2));
						ssd.set( i-plen, j-plen, ssd.get( i-plen,j-plen ) + Math.pow( patch.get( k+plen,l+plen,2 ) - region.get( i+k,j+l,2 ), 2));
					}

				}
			} // End patch loop
		} // End second ssd loop
	} // End first ssd loop
	return ssd;
};

var donkey_img, fill_img, texture_img;
var donkey_ctx, fill_ctx, texture_ctx;
var donkey_imdata, fill_imdata, texture_imdata;
var donkey_pix, fill_pix, texture_pix;

var texture_canvas;
var texture_r; // raphael element on texture

var fill_mask;
var pixs_to_fill;

var patchL    = 7; //10
var patchSize = 2*patchL + 1;
var randomPatchSD = 1;

var refreshIntervalId;

var text_y = 112;
var text_x = 162;
var text_w = 203 - 165;
var text_h = 185 - 112;

// Load donkey image on main canvas
donkey_img 		= new Image();
donkey_img.src 	= 'imgs/donkey.jpg';
donkey_img.onload = function() {
	donkey_ctx = $('#original_canvas')[0].getContext('2d');
	donkey_ctx.drawImage( donkey_img, 0, 0 ); // draw the donkey on the main canvas
	donkey_imdata = donkey_ctx.getImageData(0,0,donkey_img.width,donkey_img.height);
	donkey_pix = ndarray( donkey_imdata.data, [donkey_img.height, donkey_img.width,4] );

	// Load the fill image
	fill_img = new Image();
	fill_img.src = 'imgs/fill_region.png';
	fill_img.onload = function() {
		
		fill_ctx = $('#fill_canvas')[0].getContext('2d');
		
		// === Actual Efros and Leung loop
		var efros_and_leung = function ( text_x, text_y, text_w, text_h ) {

			fill_ctx.drawImage( fill_img, 0, 0 ); // draw the fill region on the fill canvas
			fill_imdata = fill_ctx.getImageData(0,0,fill_img.width,fill_img.height);

			// convert fill_pix to an nd-array
			fill_pix = ndarray( fill_imdata.data, [fill_img.height, fill_img.width, 4] );

			// make a copy to the whole mask, and then wrap it with an ndarray
			fill_mask = ndarray( new Uint8ClampedArray( fill_pix.data ), fill_pix.shape );
			// Keeping just the red channel is enough.
			fill_mask = fill_mask.pick(null, null, 0);

			// Paint the donkey in the fill region
			for (var y=0; y<fill_img.height; y++) {
				for (var x=0; x<fill_img.width; x++) {
					if (fill_mask.get( y, x ) == 0 ) {
						fill_pix.set( y, x, 0, donkey_pix.get(y,x,0) );
						fill_pix.set( y, x, 1, donkey_pix.get(y,x,1) );
						fill_pix.set( y, x, 2, donkey_pix.get(y,x,2) );
					} else {
						fill_pix.set( y, x, 0, 0 );
						fill_pix.set( y, x, 1, 0 );
						fill_pix.set( y, x, 2, 0 );
					}
				}
			}
			fill_ctx.putImageData( fill_imdata, 0, 0);

			// Crop the texture from the donkey image.
			var texture_values = donkey_ctx.getImageData( text_x, text_y, text_w, text_h ).data;
			texture_values     = ndarray( texture_values, [text_h, text_w, 4] );

			// === Count how many pixels we will fill
			total_pix = count_pix_to_fill( fill_mask );
			pixs_to_fill = total_pix;

			// Find if there are still holes to fill
			edge_mask = get_edge_mask( fill_mask, fill_img.width, fill_img.height );
			edge      = get_rand_non_zero( edge_mask, fill_img.width, fill_img.height );
			
			refreshIntervalId = setInterval(function(){

				valeur = 100 - Math.round( pixs_to_fill / total_pix * 100 );
				$('.progress-bar').css('width', valeur+'%').attr('aria-valuenow', valeur); 
				$('.progress-bar').text( valeur+'%' );

			 	// Stop if there are no more pixels to fill
			 	if (pixs_to_fill == 1) {
			 		$('.progress-bar').removeClass('active');
			 		clearInterval( refreshIntervalId );
			 	}
			 	// Reduce the pixel counter
			 	pixs_to_fill--;
				
				// Crop the image region around the edge
				patch_imdata = donkey_ctx.getImageData( edge.x-patchL, edge.y-patchL, patchSize, patchSize );
				patch_pix    = ndarray( patch_imdata.data, [patchSize, patchSize, 4] );
				patch_mask   = fill_mask.lo( edge.y - patchL, edge.x - patchL ).hi( patchSize, patchSize );

				ssd = get_ssd( patch_mask, patch_pix, patchL, texture_values, text_w, text_h );

				// Sort works in place so we have to make a new array.
				ssd_copy = new Uint32Array( ssd.data );
				ssd_copy = Array.prototype.sort.call( ssd_copy , function(a, b) { return a - b; });

				// Sample from a gaussian using the box-muller transform
				var r = Math.sqrt(-2 * Math.log( Math.random() ));
				var theta  = 2 * Math.PI * Math.random();
				var rand_x = r * Math.cos( theta );
				// var rand_y = r * Math.Sin( theta );

				// Pick the index from there
				idx = Math.min( Math.round(Math.abs( rand_x )), ssd_copy.length-1 );

				ssd_value = ssd_copy[ idx ];
				outer:
				for(i=0; i<ssd.shape[0]; i++) {
					for(j=0; j<ssd.shape[1]; j++) {
						if (ssd.get(i,j) == ssd_value ) { 
							y=i; x=j;
							break outer;
						}
					}
				}
				fill_pix.set( edge.y, edge.x, 0, texture_values.get(y+patchL, x+patchL, 0) );
				fill_pix.set( edge.y, edge.x, 1, texture_values.get(y+patchL, x+patchL, 1) );
				fill_pix.set( edge.y, edge.x, 2, texture_values.get(y+patchL, x+patchL, 2) );

				if(pixs_to_fill % 1 == 0 ){ 
					// Actually very fast on firefox.
					fill_ctx.putImageData( fill_imdata, 0, 0);
				}
					
				// Update the mask
				fill_mask.set( edge.y, edge.x, 0 );

				// Find another edge
				edge_mask = get_edge_mask( fill_mask, fill_img.width, fill_img.height );
				edge      = get_rand_non_zero( edge_mask, fill_img.width, fill_img.height );

			}, 1); // ms to refresh the canvas
		}; // end efros and leung function

		// Texture interface function
		texture_interface = function() {

			var dragStart = function() {
				// Save some starting values
				this.ox = this.attr('x');
				this.oy = this.attr('y');
				this.ow = this.attr('width');
				this.oh = this.attr('height');
				this.dragging = true;
			};
				 

			var dragMove = function(dx, dy) {
			 
				// Inspect cursor to determine which resize/move process to use
				switch (this.attr('cursor')) {
			 
					case 'nw-resize' :
					this.attr({
						x: this.ox + dx,
						y: this.oy + dy,
						width: this.ow - dx,
						height: this.oh - dy
					}); break;
 
					case 'ne-resize' :
					this.attr({
						y: this.oy + dy ,
						width: this.ow + dx,
						height: this.oh - dy
					});
					shapes[1].attr({
						height : this.oy + dy
					});
					shapes[2].attr({
						y: this.oy + dy + 1,
						height : donkey_img.height-(this.oy + dy)
					});
					shapes[3].attr({
						x: this.ox + this.ow + dx,
						y: this.oy + dy + 1,
						width:  donkey_img.width-(this.ox + this.ow + dx),
						height: this.oh - dy
					});
					clearInterval( refreshIntervalId );
					efros_and_leung( this.ox, this.oy + dy, this.ow + dx, this.oh - dy);
					break;
					 
					case 'se-resize' :
					this.attr({
						width: this.ow + dx,
						height: this.oh + dy
					});
					shapes[3].attr({
						x : this.ox + dx + this.ow,
						width  : donkey_img.width-( this.ox + dx + this.ow ),
						height : this.oh + dy
					});
					shapes[4].attr({
						y : this.oy + dy + this.oh + 2,
						height : donkey_img.height-( this.oy + dy + this.oh )
					});
					clearInterval( refreshIntervalId );
					efros_and_leung( this.ox, this.oy, this.ow+dx, this.oh+dy );
					break;
					 
					case 'sw-resize' :
					this.attr({
						x: this.ox + dx,
						width: this.ow - dx,
						height: this.oh + dy
					}); break;
					 
					default :
					this.attr({
						x: this.ox + dx,
						y: this.oy + dy
					});
					shapes[1].attr({
						height: this.oy + dy
					});
					shapes[2].attr({
						y : this.oy + dy+1,
						width : this.ox + dx,
						height : donkey_img.height - (this.oy + dy+1)
					});
					shapes[3].attr({
						x : this.ox + dx + this.ow,
						y : this.oy + dy + 1,
						width : donkey_img.width-( this.ox + dx + this.ow )
					});
					shapes[4].attr({
						x : this.ox + dx + 1,
						y : this.oy + dy + this.oh + 2,
						width  : donkey_img.width-( this.ox + dx ),
						height : donkey_img.height-( this.oy + dy + this.oh )
					});
					clearInterval( refreshIntervalId );
					efros_and_leung( this.ox+dx, this.oy+dy, this.ow, this.oh );
					break;
				}
			};

			var dragEnd = function() {
				this.dragging = false;
			};
			 
			var changeCursor = function(e, mouseX, mouseY) {

				// Don't change cursor during a drag operation
				if (this.dragging === true) {
					return;
				}
										 
				// X,Y Coordinates relative to shape's orgin
				var relativeX = mouseX - $('#texture_holder').offset().left - this.attr('x');
				var relativeY = mouseY - $('#texture_holder').offset().top - this.attr('y');
				 
				var shapeWidth = this.attr('width');
				var shapeHeight = this.attr('height');
				 
				var resizeBorder = 10;
				 
				// Change cursor
				if (relativeX < resizeBorder && relativeY < resizeBorder) {
					this.attr('cursor', 'nw-resize');
				} else if (relativeX > shapeWidth-resizeBorder && relativeY < resizeBorder) {
					this.attr('cursor', 'ne-resize');
				} else if (relativeX > shapeWidth-resizeBorder && relativeY > shapeHeight-resizeBorder) {
					this.attr('cursor', 'se-resize');
				} else if (relativeX < resizeBorder && relativeY > shapeHeight-resizeBorder) {
					this.attr('cursor', 'sw-resize');
				} else {
					this.attr('cursor', 'move');
				}
			};

			var texture_r = Raphael('texture_holder', donkey_img.width, donkey_img.height);
			texture_r.image( donkey_img.src, 0,0, donkey_img.width, donkey_img.height);

			// Add a rectangle
			var shapes = texture_r.add([{
				'type' : 'rect',
				'x' : text_x,
				'y' : text_y,
				'width'  : text_w,
				'height' : text_h,
				'fill' : '#fff',
				'fill-opacity': 0,
				'stroke' : '#beaed4',
				'stroke-width' : 3
			}]);
			 
			shapes[0].mousemove(changeCursor);
			shapes[0].drag(dragMove, dragStart, dragEnd);

			shapes[1] = texture_r.add([{
				'type' : 'rect',
				'x' : 0,
				'y' : 0,
				'width' : donkey_img.width,
				'height' : text_y,
				'fill' : '#000',
				'opacity' : .5
			}]);
			shapes[2] = texture_r.add([{
				'type' : 'rect',
				'x' : 0,
				'y' : text_y+1,
				'width' : text_x,
				'height' : donkey_img.height-text_y,
				'fill' : '#000',
				'opacity' : .5
			}]);
			shapes[3] = texture_r.add([{
				'type' : 'rect',
				'x' : text_x+text_w,
				'y' : text_y+1,
				'width' : donkey_img.width-(text_x+text_w),
				'height' : text_h,
				'fill' : '#000',
				'opacity' : .5
			}]);
			shapes[4] = texture_r.add([{
				'type' : 'rect',
				'x' : text_x+1,
				'y' : text_y+text_h+2,
				'width' : donkey_img.width-(text_x),
				'height' : donkey_img.height-(text_y+text_h),
				'fill' : '#000',
				'opacity' : .5
			}]);

		}();

		// === Now call the efros and leung loop.
		efros_and_leung( text_x, text_y, text_w, text_h );

	}; // end fill onload
}; // end donkey onload