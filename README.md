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
                ignore: [
                  '*://*.aliyuncs.com/*'  // url patterns
                ],
                resavePath: {
                  '/post/user/:id': {
                    method: 'post', // can be ignore
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

The `ignore` format can reference [url-match-patterns](https://github.com/nickclaw/url-match-patterns)

