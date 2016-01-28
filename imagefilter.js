
//TODO: pause histogram generaiton when disabled
//TODO: clean up filters when they're not needed

function ImageFilterer() {
	this.animationUpdateFrequency = 1000;
	//this.golayMeritThreshold = 0.08;

	this.finder = new ImageFinder();
	this.images = [];
	this.uidNext = 0;
	this.histograms = {};
	this.animatedHistograms = {};
	this.svgFilters = {};
	this.onlyPictures = true;

	this.customValueCache = {V1:0.5, V2:0.5, V3:0.5};

	var that = this;
	this.start = this.finder.start.bind(this.finder);
	this.finder.sourceAdded = this.sourceAdded.bind(this);
	this.finder.sourceRemoved = this.sourceRemoved.bind(this);
	this.finder.imageAdded = this.imageAdded.bind(this);
	this.finder.imageRemoved = this.imageRemoved.bind(this);

	this.nextOverrideID = 0;
	this.defaultFilter = null;
	this.filters = {};
	this.filterOverrides = {};
	this.filterSources = [
		'<feComponentTransfer in="SourceGraphic" result="Current"><feFuncR type="table" tableValues="%HR"/> <feFuncG type="table" tableValues="%HG"/> <feFuncB type="table" tableValues="%HB"/></feComponentTransfer>'
		+ '<feComponentTransfer in="SourceGraphic" result="Last"><feFuncR type="table" tableValues="%LHR"/> <feFuncG type="table" tableValues="%LHG"/> <feFuncB type="table" tableValues="%LHB"/> </feComponentTransfer>'
		+ '<feComposite in="Last" in2="Current" operator="arithmetic" k1="0" k2="1" k3="0" k4="0"> <animate attributeName="k2" from="1" to="0" dur="1s" /> <animate attributeName="k3" from="0" to="1" dur="1s" /> </feComposite>'
		,
		'<feComponentTransfer in="SourceGraphic" result="A"> <feFuncR type="table" tableValues="%HR"/> <feFuncG type="table" tableValues="%HG"/> <feFuncB type="table" tableValues="%HB"/> </feComponentTransfer>'
		,
		'<feColorMatrix in="SourceGraphic" type="matrix" values="-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0"/>'
	];
}

//an element to put debug info into the document
ImageFilterer.debugInfo = null;
ImageFilterer.enableDebug = false;

ImageFilterer.prototype.isPicture = function(image, histogram) {
	var w = $(image).width();
	var h = $(image).height();
	if (w * h < 128 * 128)
		return false;

	if (histogram.success)
	{
		//var merit = histogram.getGolayMerit();
		//if (merit < this.golayMeritThreshold)
		//	return false;
		var peakArea = histogram.getPeakArea(0.02);
		if (peakArea > 0.1)
			return false;
	}

	return true;
};

ImageFilterer.prototype.setOnlyPictures = function(enabled) {
	this.onlyPictures = enabled;
	//update filter class for every image currently being filtered
	for (var i in this.images)
	{
		var image = $(this.images[i]);

		//don't filter images with filtered children
		if (image.data('imagefilter-haschild'))
			continue;

		var filteredClass = image.data('imagefilter-class');
		var apply = true;
		if (this.onlyPictures && image.nodeName !== 'VIDEO')
		{
			var url = image.attr('data-imagefilter-src');
			//if (image.nodeName == 'VIDEO') //not a video, so don't need to check
			//	histogram = this.animatedHistograms[image.data('imagefilter-histogram-id')];
			//else
			histogram = this.histograms[url];
			if (!this.isPicture(image, histogram))
				apply = false;
		}
		image.toggleClass(filteredClass, apply);
	}
};

ImageFilterer.prototype.setCustomValue = function(key, value) {
	this.customValueCache[key] = value;
	if (this.defaultFilter)
		this.defaultFilter.setCustomValue(key, value);
	for (var k in this.filters)
		this.filters[k].setCustomValue(key, value);
};

ImageFilterer.prototype.setFilterSources = function(sources) {
	this.filterSources = sources;
	if (this.defaultFilter)
		this.defaultFilter.update(sources);
	for (var key in this.filters)
		this.filters[key].update(sources);
};

ImageFilterer.prototype.enable = function(enabled) {
	this.enabled = enabled;
	if (this.defaultFilter)
		this.defaultFilter.enable(enabled);
	for (var key in this.filters)
		this.filters[key].enable(enabled);
};

ImageFilterer.prototype.chooseFilter = function(img, histogram) {
	if (histogram.success)
	{
		if (!(histogram.id in this.filters))
			this.filters[histogram.id] = new ImageFilter(this.filterSources, this.enabled, this.customValueCache, histogram);
		return this.filters[histogram.id];
	}
	else
	{
		if (!this.defaultFilter)
			this.defaultFilter = new ImageFilter(this.filterSources, this.enabled, this.customValueCache);
		return this.defaultFilter;
	}
};

//override a filter already applied to an image
ImageFilterer.prototype.applyManually = function(image, sources) {
	image = $(image);

	if (!$.inArray(image, this.images))
	{
		console.log('Cannot apply filter, image ' + image + " hasn\'t been added yet.");
		return;
	}

	var url = image.attr('data-imagefilter-src');

	var histogram;
	if (this.nodeName == 'VIDEO')
		histogram = this.animatedHistograms[$(image).data('imagefilter-histogram-id')];
	else
		histogram = this.histograms[url];

	var filterID = image.data('imagefilter-override');
	if (filterID)
	{
		filter = this.filterOverrides[filterID];
		filter.release();
		delete this.filterOverrides[filterID];
	}
	else
	{
		filterID = this.nextOverrideID++;
		image.data('imagefilter-override', filterID);
	}

	if (sources === null)
	{
		image.removeData('imagefilter-override');
		this.applyFilterToImage([image], histogram);
	}
	else
	{
		var filter = new ImageFilter(sources, true, this.customValueCache, histogram);
		this.filterOverrides[filterID] = filter;

		//remove old css class
		image.removeClass(image.data('imagefilter-class'));

		//add the new one
		image.addClass(filter.styleName);

		//store the class name as a backup
		image.data('imagefilter-class', filter.styleName);
	}
};

ImageFilterer.prototype.applyFilterToImage = function(images, histogram) {
	var filteredImages = [];
	for (var i in images)
	{
		var apply = true;
		if ($(images[i]).data('imagefilter-haschild'))
			apply = false;
		if (apply)
		{
			var filter = this.chooseFilter(images[i], histogram);

			var ancestors = $(images[i]).parents();
			ancestors.each(function(){
				//remove any filters applied to ancestors
				var filtered = $(this).data('imagefilter-class');
				if (filtered)
					$(this).removeClass(filtered);

				//don't allow future filtering of ancestors
				$(this).data('imagefilter-haschild', ($(this).data('imagefilter-haschild') || 0) + 1);
			});

			//actually apply the filter by adding a class to the element
			if (!this.onlyPictures || images[i].nodeName == 'VIDEO' || this.isPicture(images[i], histogram))
				$(images[i]).addClass(filter.styleName);

			//store the class name as a backup, even if it wasn't applied
			$(images[i]).data('imagefilter-class', filter.styleName);

			filteredImages.push(images[i]);
		}
	}
	$.merge(this.images, filteredImages);
};

ImageFilterer.prototype.updateFilter = function(histogram) {
	if (histogram.success)
	{
		this.filters[histogram.id].update();

		//update the debug histogram if it exists
		if (ImageFilterer.debugInfo && ImageFilterer.debugInfo.data('imagefilter-src') == histogram.src)
		{
			ImageFilterer.debugInfo.find('#imagefilter-histogram').replaceWith($(histogram.createGraph()).attr('id', 'imagefilter-histogram').css('border', '1px solid black'));
			ImageFilterer.debugInfo.find('#imagefilter-filterinfo').html(this.filters[histogram.id].getInfo());
		}
	}
};

ImageFilterer.prototype.removeFilter = function(histogram) {
	if (histogram.success)
		this.filters[histogram.id].remove();
};

ImageFilterer.prototype.sourceAdded = function(src, firstElement) {
	if (src && firstElement.nodeName != 'VIDEO')
	{
		console.log("Added " + src);
		this.histograms[src] = new Histogram(src, firstElement, 0);
		this.histograms[src].onload = this.histogramReady.bind(this);
		this.histograms[src].onerror = this.histogramReady.bind(this);
	}
};

ImageFilterer.prototype.sourceRemoved = function(src) {
	if (src in this.histograms)
	{
		console.log("Removed " + src);
		this.removeFilter(this.histograms[src]);
		this.histograms[src].stop();
		delete this.histograms[src];
	}
};

ImageFilterer.prototype.imageAdded = function(img, url) {
	if (img.nodeName == 'VIDEO')
	{
		var id = this.uidNext++;
		$(img).data('imagefilter-histogram-id', id);
		this.animatedHistograms[id] = new Histogram(url, img, this.animationUpdateFrequency);
		this.animatedHistograms[id].onload = this.histogramReady.bind(this);
		this.animatedHistograms[id].onupdate = this.updateFilter.bind(this);
	}
	else
	{
		if (url in this.histograms && this.histograms[url].ready)
			this.applyFilterToImage([img], this.histograms[url]);
	}

	var that = this;
	$(img).on('mouseover', function(e){
		e.stopPropagation();

		if (!ImageFilterer.enableDebug)
			return;

		//shouldn't need ImageFilterer.debugInfo.id == 'imagefilter-debug' but something weird is making it point to random elements
		if (ImageFilterer.debugInfo && ImageFilterer.debugInfo.data('imagefilter-stay'))
		{
			if (ImageFilterer.debugInfo.attr('id') == 'imagefilter-debug')
				return;
			else
				debugger;
		}
		if (ImageFilterer.timeout)
			window.clearTimeout(ImageFilterer.timeout);
		ImageFilterer.timeout = window.setTimeout(function(){
			$(ImageFilterer.debugInfo).css('pointer-events', 'auto').css('opacity', '1').data('imagefilter-stay', true)
		}, 2000);
		if (ImageFilterer.debugInfo)
			ImageFilterer.debugInfo.remove();
		ImageFilterer.debugInfo = $('<div id="imagefilter-debug" style="opacity: 0.5; pointer-events: none; z-index: 19999999999; position:fixed; top:0px; left:0px; right:0px; background: white; font-size: 14px; border-bottom: 2px solid black;" data-imagefilter-haschild="1"></div>');
		$(document.body).append(ImageFilterer.debugInfo);
		ImageFilterer.debugInfo.on('click', function(){
			ImageFilterer.debugInfo.remove();
			ImageFilterer.debugInfo = null;
		});

		var histogram;
		if (this.nodeName == 'VIDEO')
			histogram = that.animatedHistograms[$(this).data('imagefilter-histogram-id')];
		else
			histogram = that.histograms[url];

		var info = $('<div><div style="background:rgba(255,255,255,0.5);">URL: <a href="' + url + '">' + url + '</a></div></div>');
		ImageFilterer.debugInfo.append(info);

		if (histogram)
		{
			ImageFilterer.debugInfo.data('imagefilter-src', histogram.src);
			if (histogram.success)
			{
				ImageFilterer.debugInfo.append($(histogram.createGraph()).attr('id', 'imagefilter-histogram').css('border', '1px solid black'));
				info.css('position', 'absolute');
			}
			else
				info.append($('<div>Histogram status: '+histogram.status+'</div>'));
		}

		if (url && this.nodeName != 'VIDEO')
			ImageFilterer.debugInfo.append($('<img data-imagefilter-haschild="1" style="border:1px solid black; max-height: 128px;" alt="debugimg" src="' + url + '"/>'));

		var textInfo = $('<div style="display: inline-block" id="imagefilter-info"><div id="imagefilter-filterinfo"></div></div>');
		ImageFilterer.debugInfo.append(textInfo);
		if (this.nodeName != 'VIDEO')
		{
			var filteredClass = $(this).data('imagefilter-class');
			textInfo.prepend('<div>Class Applied: ' + $(this).hasClass(filteredClass) + '</div>');
			textInfo.prepend('<div>Child Counter: ' + $(this).data('imagefilter-haschild') + '</div>');
			if (histogram.id in that.filters)
				textInfo.find('#imagefilter-filterinfo').html(that.filters[histogram.id].getInfo());
		}

	}).on('mouseout', function(){
		if (ImageFilterer.debugInfo && !ImageFilterer.debugInfo.data('imagefilter-stay'))
		{
			ImageFilterer.debugInfo.remove();
			ImageFilterer.debugInfo = null;
		}
		if (typeof ImageFilterer.timeout !== 'undefined')
		{
			window.clearTimeout(ImageFilterer.timeout);
			ImageFilterer.timeout = null;
		}
	});
};

ImageFilterer.prototype.imageRemoved = function(img, url) {
	if (img.nodeName == 'VIDEO')
	{
		var id = $(img).data('imagefilter-histogram-id');
		this.removeFilter(this.animatedHistograms[id]);
		this.animatedHistograms[id].stop();
		delete this.animatedHistograms[id];
	}

	//remove css class that applies the filter
	$(img).removeClass($(img).data('imagefilter-class'));
	$(img).removeData('imagefilter-class');

	//remove image from list of filtered images if it exists
	var index = $.inArray(img, this.images);
	if (index)
		this.images.splice(index, 1);

	var ancestors = $(img).parents();

	//remove data-imagefilter-haschild contributions
	ancestors.each(function(){
		var val = $(this).data('imagefilter-haschild');
		if (val > 1)
			$(this).data('imagefilter-haschild', val-1);
		else
			$(this).removeData('imagefilter-haschild');
	});

	//check if an ancestor can now be filtered, since this has been removed
	//FIXME: not sure if this works as it's jquery data
	var next = ancestors.filter('[data-imagefilter-class]').first().not('[data-imagefilter-haschild]');
	if (next.length)
		this.imageAdded(next, next.attr('data-imagefilter-src'));
};

ImageFilterer.prototype.histogramReady = function(histogram) {
	var images = this.finder.sources[histogram.src];
	this.applyFilterToImage(images, histogram);
};
