# efros-and-leung-js

On the winter of 2015 I was a TA for CPSC 425, the computer vision course for undergrads at UBC. One of the assignments in the course is to implement a simplified version of the algorithm described in "Texture Synthesis by Non-parametric Sampling", by Efros and Leung from ICCV 1999 [[pdf](https://www.eecs.berkeley.edu/Research/Projects/CS/vision/papers/efros-iccv99.pdf)].

I thought it would help students if they could *see* how the algorithm works in real time, so I decided to implement the method and a visualization of it on javascript.

# Demo

The live demo of the method is on http://jltmtz.github.io/efros-and-leung-js/. For some reason it runs way faster on Firefox compared to Chrome.

# Installation

Before doing anything, go ahead and install [node-js](https://nodejs.org/).

Now clone the project

* `git clone git@github.com:jltmtz/efros-and-leung-js.git`
* `cd js`

Install the dependencies

* `npm install -i ndarray`
* `npm install -i raphael`

Finally, export it with [browserify](http://browserify.org/) to use the project in a web browser

* `npm install -g browserify`
* `browserify main.js -o bundle.js`

And you should be ready to go!
