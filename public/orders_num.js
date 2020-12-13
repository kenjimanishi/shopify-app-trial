(function(){
  /* Load Script function we may need to load jQuery from the Google's CDN */
  const loadScript = function(url, callback){
    var script = document.createElement("script");
    script.type = "text/javascript";

    if (script.readyState){
      // If the browser is Internet Explorer.
      script.onreadystatechange = function(){
        if (script.readyState == "loaded" || script.readyState == "complete"){
          script.onreadystatechange = null;
          callback();
        }
      };
    } else {
      // For any other browser.
      script.onload = function(){
        callback();
      };
    }

    script.src = url;
    document.getElementsByTagName("head")[0].appendChild(script);
  };

  const insertOrdersNumBanner = function($, pathName){
    $('body').prepend('<div class="banner-of-order-quantity">この商品は本日 <span id="sales-num"><img class="loading" alt="loading" width="15" height="15" style="margin-bottom: -1.4px;" src="https://arcane-oasis-29051.herokuapp.com/loading.gif" /></span> 件のご注文をいただいております</div>');
    $('head').prepend('<style>.banner-of-order-quantity { text-align: center; padding: 5px; background: #737373; color: #fff; } .content { padding: 16px; } .sticky { position: fixed; top: 0; width: 100%} .sticky + .content { padding-top: 102px; }</style>');

    const product_handle = pathName.replace(/\/products\//g, '');
    $.getJSON(`/apps/orders?product_handle=${encodeURI(product_handle)}`, function(){})
      .done(function(json) {
        $('#sales-num').html(json.order_count);
      })
      .fail(function() {
        $('#sales-num').html('？');
      });
  };

  const updateOrdersData = function($){
    $.getJSON('/apps/orders', function(){})
      .done(function(json) {
        //
      })
      .fail(function() {
        //
      });
  };

  const banner_visible = window.location.pathname.match('\/products/(?!/).*$');
  if ((typeof jQuery === 'undefined') || (parseFloat(jQuery.fn.jquery) < 1.7)) {
    loadScript('//ajax.googleapis.com/ajax/libs/jquery/1.9.1/jquery.min.js', function(){
      jQuery191 = jQuery.noConflict(true);
      if (banner_visible) {
        insertOrdersNumBanner(jQuery191, banner_visible);
      } else {
        updateOrdersData(jQuery191);
      }
    });
  } else {
    if (banner_visible) {
      insertOrdersNumBanner(jQuery, banner_visible);
    } else {
      updateOrdersData(jQuery);
    }
  }
})();
