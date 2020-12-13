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

  const insertOrdersNumBanner = function($, product_handle){
    $('body').prepend('<div class="banner-of-order-quantity">この商品は本日 <span id="sales-num"><img class="loading" alt="loading" width="15" height="15" style="margin-bottom: -1.4px;" src="https://arcane-oasis-29051.herokuapp.com/loading.gif" /></span> 件のご注文をいただいております</div>');
    $('head').prepend('<style>.banner-of-order-quantity { text-align: center; padding: 5px; background: #737373; color: #fff; } .content { padding: 16px; } .sticky { position: fixed; top: 0; width: 100%} .sticky + .content { padding-top: 102px; }</style>');

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

  let product_handle = ''
  const banner_visible = window.location.pathname.match('\/products/(?!/).*$');
  if (banner_visible) {
    product_handle = banner_visible[0].replace(/\/products\//g, '');
  }

  if ((typeof jQuery === 'undefined') || (parseFloat(jQuery.fn.jquery) < 1.7)) {
    loadScript('//ajax.googleapis.com/ajax/libs/jquery/1.9.1/jquery.min.js', function(){
      jQuery191 = jQuery.noConflict(true);
      if (product_handle !== '') {
        insertOrdersNumBanner(jQuery191, product_handle);
      } else {
        updateOrdersData(jQuery191);
      }
    });
  } else {
    if (product_handle !== '') {
      insertOrdersNumBanner(jQuery, product_handle);
    } else {
      updateOrdersData(jQuery);
    }
  }
})();
