'use strict';

const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const koaRequest = require('koa-http-request');
const views = require('koa-views');
const serve = require('koa-static');

const crypto = require('crypto');

const fs = require('fs');

const mongo = require('mongodb');
const { forEach } = require('underscore');

const router = new Router();
const app = module.exports = new Koa();

app.use(bodyParser());

app.use(koaRequest({

}));

app.use(views(__dirname + '/views', {
  map: {
    html: 'underscore'
  }
}));

app.use(serve(__dirname + '/public'));

const API_KEY = `${process.env.SHOPIFY_API_KEY}`;
const API_SECRET = `${process.env.SHOPIFY_API_SECRET}`;
const API_PERMISSION = `${process.env.SHOPIFY_API_PERMISSION}`;
const API_VERSION = `${process.env.SHOPIFY_API_VERSION}`

const CONTENT_TYPE_JSON = 'application/json';
const CONTENT_TYPE_FORM = 'application/x-www-form-urlencoded';

const GRAPHQL_PATH_ADMIN = `admin/api/${API_VERSION}/graphql.json`;
const RESTAPI_PATH_ADMIN = `admin/api/${API_VERSION}`;
const GRAPHQL_PATH_STOREFRONT = `api/${API_VERSION}/graphql.json`;

const UNDEFINED = 'undefined';

const HMAC_SECRET = API_SECRET;

// Mongo URL and DB name for date store
const MONGO_URL = `${process.env.SHOPIFY_MONGO_URL}`;
const MONGO_DB_NAME = `${process.env.SHOPIFY_MONGO_DB_NAME}`;
const MONGO_COLLECTION = 'shops';

// Sales channel and storefront API
const SALES_CHANNEL = `${process.env.SHOPIFY_SALES_CHANNEL}`;

// Set Timezone Japan
//process.env.TZ = 'Asia/Tokyo';

/*
 *
 * --- Auth by frontend App Bridge ---
 *
*/
router.get('/auth',  async (ctx, next) => {
  console.log('============== Auth ==========================================');
  let shop = ctx.request.query.shop;
  let locale = ctx.request.query.locale;
  await ctx.render('auth', {
    api_key: API_KEY,
    api_permission: API_PERMISSION,
    callback: `https://${ctx.request.hostname}/callback`,
    shop: shop,
    locale: locale
  });
});

/*
 *
 * --- Top ---
 *
*/
router.get('/',  async (ctx, next) => {
  console.log('============== Admin Home ==========================================');
  if (!checkSignature(ctx.request.query)) {
    ctx.status = 400;
    return;
  }

  let shop = ctx.request.query.shop;
  let locale = ctx.request.query.locale;

  var shop_data = await(getDB(shop));
  if (shop_data == null) {
    ctx.body = "No shop data";
  } else {
    let api_res = await(callRESTAPI(ctx, shop, 'script_tags', null, 'GET'));
    let script_tags_flg = false;
    const src_url = `https://${ctx.request.hostname}/orders_num.js`;
    api_res.script_tags.forEach(script_tag => {
      script_tags_flg = (script_tag.src === src_url) ? true : false;
    });

    await ctx.render('top', {
      shop: shop,
      locale: locale,
      api_key: API_KEY,
      id: ctx.request.query.id,
      script_tags_flg: script_tags_flg,
    });
  }
});

/*
 *
 * --- Callback endpoint during the installation ---
 *
*/
router.get('/callback',  async (ctx, next) => {
  console.log('============== callback ==========================================');
  if (!checkSignature(ctx.request.query)) {
    ctx.status = 400;
    return;
  }
  let req = {};
  req.client_id = API_KEY;
  req.client_secret = API_SECRET;
  req.code = ctx.request.query.code;

  let shop = ctx.request.query.shop;

  let res = await(accessEndpoint(ctx, `https://${shop}/admin/oauth/access_token`, req, null, CONTENT_TYPE_FORM));
  if (typeof res.access_token !== UNDEFINED) {
    var shop_data = await(getDB(shop));
    if (shop_data == null) {
      await(insertDB(shop, res));
    } else {
      await(setDB(shop, res));
    }

    // If sales channel, get storefront access token
    if (SALES_CHANNEL == "true") {
      let storefront_res = await(callRESTAPI(ctx, shop, `storefront_access_tokens`, {
        "storefront_access_token": {
          "title": "My Storefront Token"
        }
      }));
      if (typeof storefront_res.storefront_access_token.access_token !== UNDEFINED) {
        res.storefront_access_token = storefront_res.storefront_access_token.access_token;
        await(setDB(shop, res));
      }
    }

    // Get app handle by GraphQL
    let api_res = await(callGraphql(ctx, shop, `{
      app {
        handle
      }
    }`));
    const redirect_url = `https://${shop}/admin/apps/${api_res.data.app.handle}`;
    const src_url = `https://${ctx.request.hostname}/orders_num.js`;

    // Get and delete the current my own JavaScript by REST API
    api_res = await(callRESTAPI(ctx, shop, 'script_tags', null, 'GET'));
    if (typeof api_res.script_tags !== UNDEFINED) {
      let size = api_res.script_tags.length;
      for (let i=0; i<size; i++) {
        if (api_res.script_tags[i].src === src_url) await(callRESTAPI(ctx, shop, `script_tags/${api_res.script_tags[i].id}`, null, 'DELETE'));
      }
    }

    api_res = await(callRESTAPI(ctx, shop, 'script_tags', {
      "script_tag": {
        "event": "onload",
        "src": src_url
      }
    }));

    const latest_order_res = await(callGraphql(ctx, shop, `
    {
      orders(first: 1, reverse:true, sortKey:CREATED_AT) {
        edges {
          node {
            name
          }
        }
      }
    }`));
    res.orders_date = getToday();
    res.order_name_lastest = latest_order_res.data.orders.edges.length > 0 ? latest_order_res.data.orders.edges[0].node.name : '';
    res.orders = {};
    await getOrdersPerProduct(ctx, shop, res);

    ctx.redirect(redirect_url);
  } else {
    ctx.status = 500;
  }
});

/*
 *
 * --- App proxy  ---
 *
*/
router.get('/proxy',  async (ctx, next) => {
  console.log('============== Proxy ==========================================');
  if (!checkAppProxySignature(ctx.request.query)) {
    ctx.status = 400;
    return;
  }

  const shop = ctx.request.query.shop;
  const product_handle = decodeURI(ctx.request.query.product_handle);
  const res = {};
  const today = getToday();
  const shop_data = await(getDB(shop));
  if (shop_data == null) {
    ctx.body = "No shop data";
    ctx.status = 400;
    return;
  }

  console.log('shop_data.orders_date: ', shop_data.orders_date)
  console.log('shop_data.order_name_lastest: ', shop_data.order_name_lastest)

  const graphql_more_latest_order_res = await(callGraphql(ctx, shop, `
  {
    orders(first: 1, reverse:true, sortKey:CREATED_AT) {
      edges {
        node {
          name
        }
      }
    }
  }`));
  const order_name_lastest = graphql_more_latest_order_res.data.orders.edges[0].node.name;
  console.log('order_name_lastest: ', order_name_lastest);

  if (
      shop_data.orders_date === today &&
      order_name_lastest === shop_data.order_name_lastest
  ) {
    console.log('GET ORDERS NUM FROM mongoDB ==============================');
    if (product_handle !== UNDEFINED) {
      res.order_count = shop_data.orders.hasOwnProperty(product_handle) ? shop_data.orders[product_handle] : 0
    }
  } else {
    console.log('GET ORDERS NUM FROM GraphQL ==============================');
    shop_data.orders_date = today;
    shop_data.order_name_lastest = order_name_lastest;
    shop_data.orders = {};
    const orders_per_product_res = await getOrdersPerProduct(ctx, shop, shop_data);
    console.log('========= orders_per_product_res: ', orders_per_product_res);
    if (product_handle !== UNDEFINED) {
      res.order_count = orders_per_product_res.orders.hasOwnProperty(product_handle) ? orders_per_product_res.orders[product_handle] : 0
    }
  }

  ctx.body = res;
  ctx.status = 200;
});

/*
 *
 * --- Webhook  ---
 *
*/
router.post('/webhook', async (ctx, next) => {
  console.log('============== Webhook ==========================================');
  console.log(JSON.stringify(ctx.request.body));
  console.log('ctx.headers["x-shopify-hmac-sha256"]: ', ctx.headers["x-shopify-hmac-sha256"])
  /* Check the signature */
  let valid = await(checkWebhookSignature(ctx, "90080e2cfea407f84638e88e47319a71fa6ae1592da662ffd5d5fc2dcd3f87fd"));
  if (!valid) {
    ctx.status = 200;
    return;
  }

  // Do Something...

  ctx.status = 200;
});

/*
 *
 * --- Ajax from admin home ---
 *
*/
router.post('/ajax',  async (ctx, next) => {
  console.log('============== Ajax ==========================================');
  const shop = ctx.request.body.shop;
  const action = ctx.request.body.action;
  const src_url = `https://${ctx.request.hostname}/orders_num.js`;

  if (action === 'insert') {
    console.log('============= INSERT script-tag');
    await(callRESTAPI(ctx, shop, 'script_tags', {
      "script_tag": {
        "event": "onload",
        "src": src_url
      }
    }));
  }
  if (action === 'delete') {
    console.log('============= DELETE script-tag');
    const api_res = await(callRESTAPI(ctx, shop, 'script_tags', null, 'GET'));
    if (typeof api_res.script_tags !== UNDEFINED) {
      let size = api_res.script_tags.length;
      for (let i=0; i<size; i++) {
        if (api_res.script_tags[i].src === src_url) await(callRESTAPI(ctx, shop, `script_tags/${api_res.script_tags[i].id}`, null, 'DELETE'));
      }
    }
  }

  let res = {result: "ok"};
  ctx.body = res;
  ctx.status = 200;
});

/* --- Check if the given signature is correct or not --- */
const checkSignature = function(json) {
  let temp = JSON.parse(JSON.stringify(json));
  // console.log(`checkSignature ${JSON.stringify(temp)}`);
  if (typeof temp.hmac === UNDEFINED) return false;
  let sig = temp.hmac;
  delete temp.hmac;
  let msg = Object.entries(temp).sort().map(e => e.join('=')).join('&');
  //console.log(`checkSignature ${msg}`);
  const hmac = crypto.createHmac('sha256', HMAC_SECRET);
  hmac.update(msg);
  let signarure =  hmac.digest('hex');
  //console.log(`checkSignature ${signarure}`);
  return signarure === sig ? true : false;
};

const checkAppProxySignature = function(json) {
  let temp = JSON.parse(JSON.stringify(json));
  // console.log(`checkAppProxySignature ${JSON.stringify(temp)}`);
  if (typeof temp.signature === UNDEFINED) return false;
  let sig = temp.signature;
  delete temp.signature;
  let msg = Object.entries(temp).sort().map(e => e.join('=')).join('');
  //console.log(`checkAppProxySignature ${msg}`);
  const hmac = crypto.createHmac('sha256', HMAC_SECRET);
  hmac.update(msg);
  let signarure = hmac.digest('hex');
  //console.log(`checkAppProxySignature ${signarure}`);
  return signarure === sig ? true : false;
};

/* --- Check if the given signarure is corect or not for Webhook --- */
const checkWebhookSignature = function(ctx, secret) {
  return new Promise(function (resolve, reject) {
    // console.log(`checkWebhookSignature Headers ${ctx.headers}`);
    let receivedSig = ctx.headers["x-shopify-hmac-sha256"];
    console.log(`checkWebhookSignature Given ${receivedSig}`);
    if (receivedSig == null) return resolve(false);
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(Buffer.from(ctx.request.rawBody, 'utf8').toString('utf8'));
    let signarure = hmac.digest('base64');
    console.log(`checkWebhookSignature Created: ${signarure}`);
    return resolve(receivedSig === signarure ? true : false);
  });
};

/* --- --- */
const callGraphql = function(ctx, shop, ql, token = null, path = GRAPHQL_PATH_ADMIN, vars = null) {
  return new Promise(function (resolve, reject) {
    let api_req = {};
    // Set Gqphql string into query field of the JSON  as string
    api_req.query = ql.replace(/\n/g, '');
    if (vars != null) {
      api_req.variables = vars;
    }
    var access_token = token;
    var storefront = false;
    if (path == GRAPHQL_PATH_STOREFRONT) storefront = true;
    if (access_token == null) {
      getDB(shop).then(function(shop_data){
        if (shop_data == null) return resolve(null);
        access_token = shop_data.access_token;
        if (storefront) access_token = shop_data.storefront_access_token;
        accessEndpoint(ctx, `https://${shop}/${path}`, api_req, access_token, CONTENT_TYPE_JSON, 'POST', storefront).then(function(api_res){
          return resolve(api_res);
        }).catch(function(e){
          console.log(`callGraphql1 ${e}`);
          return reject(e);
        });
      }).catch(function(e){
        console.log(`callGraphql2 ${e}`);
        return reject(e);
      });
    } else {
      accessEndpoint(ctx, `https://${shop}/${path}`, api_req, access_token, CONTENT_TYPE_JSON, 'POST', storefront).then(function(api_res){
        return resolve(api_res);
      }).catch(function(e){
        console.log(`callGraphql3 ${e}`);
        return reject(e);
      });
    }
  });
};

/* --- --- */
const callRESTAPI = function(ctx, shop, sub_path, json, method = 'POST', token = null, path = RESTAPI_PATH_ADMIN) {
  return new Promise(function (resolve, reject) {
    var access_token = token;
    if (access_token == null) {
      getDB(shop).then(function(shop_data){
        if (shop_data == null) return resolve(null);
        access_token = shop_data.access_token;
        console.log(`1 accessEndpoint: https://${shop}/${path}/${sub_path}.json`);
        accessEndpoint(ctx, `https://${shop}/${path}/${sub_path}.json`, json, access_token, CONTENT_TYPE_JSON, method).then(function(api_res){
          return resolve(api_res);
        }).catch(function(e){
          console.log(`1 callRESTAPI ${e}`);
          return reject(e);
        });
      }).catch(function(e){
        console.log(`2 callRESTAPI ${e}`);
        return reject(e);
      });
    } else {
      console.log(`3 accessEndpoint: https://${shop}/${path}/${sub_path}.json`)
      accessEndpoint(ctx, `https://${shop}/${path}/${sub_path}.json`, json, access_token, CONTENT_TYPE_JSON, method).then(function(api_res){
        return resolve(api_res);
      }).catch(function(e){
        console.log(`3 callRESTAPI ${e}`);
        return reject(e);
      });
    }
  });
};

/* ---  --- */
const accessEndpoint = function(ctx, endpoint, req, token = null, content_type = CONTENT_TYPE_JSON, method = 'POST', storefront = false) {
  var token_header = 'X-Shopify-Access-Token';
  if (storefront) token_header = 'X-Shopify-Storefront-Access-Token';
  console.log(`accessEndpoint　${endpoint} ${JSON.stringify(req)} ${token_header} ${token} ${content_type} ${method}`);
  return new Promise(function(resolve, reject) {
    // Success callback
    var then_func = function(res){
      console.log(`accessEndpoint Success: ${res}`);
      return resolve(JSON.parse(res));
    };
    // Failure callback
    var catch_func = function(e){
      console.log(`accessEndpoint Error: ${e}`);
      return resolve(e);
    };
    let headers = {};
    headers['Content-Type'] = content_type;
    if (token != null) {
      headers[token_header] = token;
    }
    if (method == 'GET') {
      ctx.get(endpoint, req, headers).then(then_func).catch(catch_func);
    } else if (method == 'PATCH') {
      ctx.patch(endpoint, req, headers).then(then_func).catch(catch_func);
    } else if (method == 'PUT') {
      ctx.put(endpoint, req, headers).then(then_func).catch(catch_func);
    } else if (method == 'DELETE') {
      ctx.delete(endpoint, req, headers).then(then_func).catch(catch_func);
    } else { // Default POST
      ctx.post(endpoint, req, headers).then(then_func).catch(catch_func);
    }
  });
};

/* ---  --- */
const insertDB = function(key, data) {
  return new Promise(function (resolve, reject) { mongo.MongoClient.connect(MONGO_URL).then(function(db){
    //console.log(`insertDB Connected: ${MONGO_URL}`);
    var dbo = db.db(MONGO_DB_NAME);
    //console.log(`insertDB Used: ${MONGO_DB_NAME}`);
    console.log(`insertDB insertOne, _id:${key}`);
    dbo.collection(MONGO_COLLECTION).insertOne({"_id": key, "data": data}).then(function(res){
      db.close();
      return resolve(0);
    }).catch(function(e){
      console.log(`insertDB Error ${e}`);
    });
  }).catch(function(e){
    console.log(`insertDB Error ${e}`);
  });});
};

/* ---  --- */
const getDB = function(key) {
  return new Promise(function(resolve, reject) { mongo.MongoClient.connect(MONGO_URL).then(function(db){
    //console.log(`getDB Connected ${MONGO_URL}`);
    var dbo = db.db(MONGO_DB_NAME);
    //console.log(`getDB Used ${MONGO_DB_NAME}`);
    console.log(`getDB findOne, _id:${key}`);
    dbo.collection(MONGO_COLLECTION).findOne({"_id": `${key}`}).then(function(res){
      db.close();
      if (res == null) return resolve(null);
      return resolve(res.data);
    }).catch(function(e){
      console.log(`getDB Error ${e}`);
    });
  }).catch(function(e){
    console.log(`getDB Error ${e}`);
  });});
};

/* ---  --- */
const setDB = function(key, data) {
  return new Promise(function(resolve, reject) { mongo.MongoClient.connect(MONGO_URL).then(function(db){
    //console.log(`setDB Connected ${MONGO_URL}`);
    var dbo = db.db(MONGO_DB_NAME);
    //console.log(`setDB Used ${MONGO_DB_NAME}`);
    console.log(`setDB findOneAndUpdate, _id:${key}`);
    dbo.collection(MONGO_COLLECTION).findOneAndUpdate({"_id": `${key}`}, {$set: {"data": data}}, {new: true}).then(function(res){
      db.close();
      return resolve(res);
    }).catch(function(e){
      console.log(`setDB Error ${e}`);
    });
  }).catch(function(e){
    console.log(`setDB Error ${e}`);
  });});
};

const getOrdersPerProduct = async function(ctx, shop, shop_data) {
  const today = getToday();
  console.log('today: ', today);
  // const today = '2020-12-01';

  const graphql_bulk_create_res = await(callGraphql(ctx, shop, `
  mutation {
    bulkOperationRunQuery (
      query: """
        {
          orders(query: "created_at:>${today} status:any") {
            edges {
              node {
                id
                name
                lineItems {
                  edges {
                    node {
                      id
                      product {
                        handle
                      }
                    }
                  }
                }
              }
            }
          }
        }
      """
    ) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }`));
  const bulk_id = graphql_bulk_create_res.data.bulkOperationRunQuery.bulkOperation.id
  await sleep(2000);

  let polling_status = "NOT_YET"
  let graphql_bulk_polling_res = {}
  while (polling_status !== "COMPLETED") {
    graphql_bulk_polling_res = await(callGraphql(ctx, shop, `
    {
      node(id: "${bulk_id}") {
        ... on BulkOperation {
          id
          status
          errorCode
          createdAt
          completedAt
          objectCount
          fileSize
          url
          partialDataUrl
        }
      }
    }`));
    polling_status = graphql_bulk_polling_res.data.node.status
    await sleep(1000);
  }

  if (graphql_bulk_polling_res.data.node.url !== null) {
    const orders_info = await fetchBulkJson(graphql_bulk_polling_res.data.node.url);
    const orders_infos = orders_info.split(/\r\n|\n/);
    orders_infos.forEach(orders_info => {
      if (orders_info !== "") {
        const orders_json = JSON.parse(orders_info);
        if (orders_json.id.match(/LineItem/)) {
          console.log('orders_json.product.handle: ', orders_json.product.handle);
          shop_data.orders[orders_json.product.handle] = shop_data.orders.hasOwnProperty(orders_json.product.handle) ? shop_data.orders[orders_json.product.handle] + 1 : 1;
        } else {
          console.log('orders_json.name: ', orders_json.name);
          shop_data.order_name_lastest = orders_json.name;
        }
      }
    });
  }
  await(setDB(shop, shop_data));
  return shop_data;
}

const getToday = function() {
  const now = new Date();
  const jstOffset = 9 * 60;
  const offset = now.getTimezoneOffset() + jstOffset;
  now.setTime(now.getTime() + offset * 60 * 1000);

  const y = now.getFullYear();
  const m = ("00" + (now.getMonth() + 1)).slice(-2);
  const d = ("00" + now.getDate()).slice(-2);

  return y + "-" + m + "-" + d;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const https = require('https');
const fetchBulkJson = function(options) {
  console.log('============= fetchBulkJson ==================')
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        resolve(responseBody);
      });
    });
    req.on('error', (err) => {
      reject(err);
    });
    req.end();
  });
}

app.use(router.routes());
app.use(router.allowedMethods());

if (!module.parent) app.listen(process.env.PORT || 3000);