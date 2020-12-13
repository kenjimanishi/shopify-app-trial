# Shopify App that displays a banner on the product page.
This is a Shopify application that displays the number of orders in the form of a banner on the product page.

# How to run
Just pushing to heroku with the following system variables is the easiest way to run, or npm start locally maybe.

SHOPIFY_API_KEY:        YOUR_API_KEY

SHOPIFY_API_PERMISSION: read_products,read_orders,read_script_tags,write_script_tags

SHOPIFY_API_SECRET:     YOUR_API_SECRET

SHOPIFY_API_VERSION:    2020-01

SHOPIFY_MONGO_DB_NAME:  YOUR_DB_NAME

SHOPIFY_MONGO_URL:      mongodb://YOUR_ID:YOUR_PASSWORD@YOUR_DOMAIN:YOUR_PORT/YOUR_DB_NAME

SHOPIFY_SALES_CHANNEL:     false

# Installation Endpoint
`https://YOUR_SHOP_DOAMIN/admin/oauth/authorize?client_id=YOUR_API_KEY&scope=read_products,read_orders,read_script_tags,write_script_tags&redirect_uri=https://YOUR_APP_DOMAIN_LIKE_HEROKU/callback&state=&grant_options[]=`
