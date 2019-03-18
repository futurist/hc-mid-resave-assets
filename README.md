# hc-mid-resave-assets

[honeycomb hc-bee](https://github.com/node-honeycomb/hc-bee) middleware to resave assets in UGC.


### install

```sh
npm i -S hc-mid-resave-assets
```

### usage

In file `config/config_default.js`

```js
{
    ...
    middleware:{
        resaveAssets:{
            config: {
                resavePath: {
                  '/post/user/:id': {
                    md: [],
                    rich: []
                  }
                },
                oss: {
                  protocol: 'https:',
                  dir: 'public/assets',
                  region: 'oss-cn-shanghai',
                  bucket: 'myfiles',
                  accessKeyId: 'xxxx',
                  accessKeySecret: 'xxxx',
                }
            }
        }
    }
}

```

Also set `req.headers['x-resave-path']` to override `req.resavePath[path]`, the header value should be object which will be passed into `qs.stringify`, like below:

```json
{
  "md": ["path1", "path2"],
  "rich": ["path1", "path2"]
}
```
